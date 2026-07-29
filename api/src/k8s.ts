import {
  ApiException,
  AppsV1Api,
  BatchV1Api,
  CoreV1Api,
  CustomObjectsApi,
  KubeConfig,
  Metrics,
  NetworkingV1Api,
  type V1Deployment,
  type V1Ingress,
  type V1Job,
  type V1Namespace,
  type V1Pod,
  type V1Service,
} from '@kubernetes/client-node';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  REAL_SERVICES,
  SERVICE_CATALOG,
  type RealServiceId,
  type RealServiceInfo,
  type RealServiceStatus,
} from './services.ts';

const MANAGED_BY = 'floci-cloud';
const NS_PREFIX = 'floci-i-';
const PULL_SECRET_NAME = 'acr-pull';
const OWN_NAMESPACE = process.env.POD_NAMESPACE ?? 'floci-cloud';
const INSTANCE_LABEL = 'floci.cloud/instance';
const SERVICE_LABEL = 'floci.cloud/service';
const CREATED_AT_ANNOTATION = 'floci.cloud/created-at';
const EXPIRES_AT_ANNOTATION = 'floci.cloud/expires-at';
const AGENT_LABEL = 'floci.cloud/agent';
const AGENT_REPO_ANNOTATION = 'floci.cloud/agent-repo';
const AGENT_MODEL_ANNOTATION = 'floci.cloud/agent-model';
const AGENT_SCRIPT_CONFIGMAP = 'otel-agent-script';

const POD_FAILURE_REASONS = new Set([
  'CrashLoopBackOff',
  'ImagePullBackOff',
  'ErrImagePull',
  'CreateContainerConfigError',
  'CreateContainerError',
  'OOMKilled',
]);

function podFailureReason(pod: V1Pod): string | null {
  for (const containerStatus of pod.status?.containerStatuses ?? []) {
    const waiting = containerStatus.state?.waiting?.reason;
    if (waiting && POD_FAILURE_REASONS.has(waiting)) {
      return waiting;
    }
    const terminated = containerStatus.lastState?.terminated?.reason;
    if (terminated && POD_FAILURE_REASONS.has(terminated)) {
      return terminated;
    }
  }
  return null;
}

export type InstanceStatus = 'provisioning' | 'running' | 'error' | 'deleting';

export interface InstanceInfo {
  name: string;
  status: InstanceStatus;
  statusDetail: string | null;
  host: string;
  endpoint: string;
  createdAt: string | null;
  expiresAt: string | null;
  image: string;
  readyReplicas: number;
}

export interface ProvisionerOptions {
  instanceDomain: string;
  flociImage: string;
  ingressClass: string;
  tls: boolean;
  clusterIssuer: string;
  /** when set, expose hosts via Gateway API HTTPRoutes attached to this Gateway instead of Ingress */
  gatewayName?: string;
  gatewayNamespace?: string;
}

function statusCodeOf(err: unknown): number | undefined {
  if (err instanceof ApiException) {
    return err.code;
  }
  const candidate = err as { code?: unknown; statusCode?: unknown };
  if (typeof candidate?.code === 'number') {
    return candidate.code;
  }
  if (typeof candidate?.statusCode === 'number') {
    return candidate.statusCode;
  }
  return undefined;
}

export function isNotFound(err: unknown): boolean {
  return statusCodeOf(err) === 404;
}

export function isConflict(err: unknown): boolean {
  return statusCodeOf(err) === 409;
}

export type OtelAgentRunStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface OtelAgentRun {
  id: string;
  status: OtelAgentRunStatus;
  repoUrl: string;
  model: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface OtelAgentOptions {
  repoUrl: string;
  githubToken: string;
  model?: string;
  baseBranch?: string;
  maxFiles?: number;
}

export interface ServiceMetrics {
  service: string;
  cpuMilli: number;
  memoryBytes: number;
  pods: number;
}

export interface InstanceMetrics {
  instance: string;
  sampledAt: string;
  services: ServiceMetrics[];
}

const MEMORY_MULTIPLIERS: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
};

function parseCpuQuantity(quantity: string): number {
  if (quantity.endsWith('n')) return Number(quantity.slice(0, -1)) / 1e6;
  if (quantity.endsWith('u')) return Number(quantity.slice(0, -1)) / 1e3;
  if (quantity.endsWith('m')) return Number(quantity.slice(0, -1));
  return Number(quantity) * 1000;
}

function parseMemoryQuantity(quantity: string): number {
  const match = quantity.match(/^([0-9.]+)([A-Za-z]*)$/);
  if (!match) return 0;
  const value = Number(match[1]);
  return value * (MEMORY_MULTIPLIERS[match[2]] ?? 1);
}

function describeAgentJob(job: V1Job): OtelAgentRun {
  let status: OtelAgentRunStatus = 'pending';
  if ((job.status?.succeeded ?? 0) > 0) {
    status = 'succeeded';
  } else if ((job.status?.failed ?? 0) > 0) {
    status = 'failed';
  } else if ((job.status?.active ?? 0) > 0) {
    status = 'running';
  }
  return {
    id: job.metadata?.name ?? '',
    status,
    repoUrl: job.metadata?.annotations?.[AGENT_REPO_ANNOTATION] ?? '',
    model: job.metadata?.annotations?.[AGENT_MODEL_ANNOTATION] ?? '',
    startedAt: job.status?.startTime?.toISOString() ?? null,
    completedAt: job.status?.completionTime?.toISOString() ?? null,
  };
}

export class Provisioner {
  private core: CoreV1Api;
  private apps: AppsV1Api;
  private net: NetworkingV1Api;
  private batch: BatchV1Api;
  private custom: CustomObjectsApi;
  private metrics: Metrics;
  private opts: ProvisionerOptions;

  constructor(opts: ProvisionerOptions) {
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromDefault();
    this.core = kubeConfig.makeApiClient(CoreV1Api);
    this.apps = kubeConfig.makeApiClient(AppsV1Api);
    this.net = kubeConfig.makeApiClient(NetworkingV1Api);
    this.batch = kubeConfig.makeApiClient(BatchV1Api);
    this.custom = kubeConfig.makeApiClient(CustomObjectsApi);
    this.metrics = new Metrics(kubeConfig);
    this.opts = opts;
  }

  private get gatewayMode(): boolean {
    return Boolean(this.opts.gatewayName && this.opts.gatewayNamespace);
  }

  /** Creates a Gateway API HTTPRoute exposing `service:port` at `host`. */
  private async createHttpRoute(args: {
    namespace: string;
    routeName: string;
    host: string;
    service: string;
    port: number;
    labels: Record<string, string>;
  }): Promise<void> {
    const body = {
      apiVersion: 'gateway.networking.k8s.io/v1',
      kind: 'HTTPRoute',
      metadata: { name: args.routeName, namespace: args.namespace, labels: args.labels },
      spec: {
        parentRefs: [
          { name: this.opts.gatewayName, namespace: this.opts.gatewayNamespace },
        ],
        hostnames: [args.host],
        rules: [
          {
            backendRefs: [{ name: args.service, port: args.port }],
          },
        ],
      },
    };
    try {
      await this.custom.createNamespacedCustomObject({
        group: 'gateway.networking.k8s.io',
        version: 'v1',
        plural: 'httproutes',
        namespace: args.namespace,
        body,
      });
    } catch (err) {
      if (!isConflict(err)) {
        throw err;
      }
    }
  }

  private async deleteHttpRoute(namespace: string, routeName: string): Promise<void> {
    try {
      await this.custom.deleteNamespacedCustomObject({
        group: 'gateway.networking.k8s.io',
        version: 'v1',
        plural: 'httproutes',
        namespace,
        name: routeName,
      });
    } catch (err) {
      if (!isNotFound(err)) {
        throw err;
      }
    }
  }

  hostFor(name: string): string {
    return `${name}.${this.opts.instanceDomain}`;
  }

  scheme(): string {
    return this.opts.tls ? 'https' : 'http';
  }

  namespaceFor(name: string): string {
    return NS_PREFIX + name;
  }

  /** Copies the ACR pull secret into an instance namespace so private floci images can be pulled. */
  private async replicatePullSecret(namespace: string): Promise<boolean> {
    try {
      const source = await this.core.readNamespacedSecret({
        name: PULL_SECRET_NAME,
        namespace: OWN_NAMESPACE,
      });
      await this.core.createNamespacedSecret({
        namespace,
        body: {
          metadata: { name: PULL_SECRET_NAME, namespace },
          type: source.type,
          data: source.data,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<InstanceInfo[]> {
    const namespaces = await this.core.listNamespace({
      labelSelector: `app.kubernetes.io/managed-by=${MANAGED_BY}`,
    });
    const described = await Promise.all(
      (namespaces.items ?? []).map((ns) => this.describeNamespace(ns)),
    );
    return described.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }

  async get(name: string): Promise<InstanceInfo | null> {
    let ns: V1Namespace;
    try {
      ns = await this.core.readNamespace({ name: this.namespaceFor(name) });
    } catch (err) {
      if (isNotFound(err)) {
        return null;
      }
      throw err;
    }
    if (ns.metadata?.labels?.['app.kubernetes.io/managed-by'] !== MANAGED_BY) {
      return null;
    }
    return this.describeNamespace(ns);
  }

  async create(name: string, ttlHours: number | null): Promise<InstanceInfo> {
    const namespace = this.namespaceFor(name);
    const host = this.hostFor(name);
    const now = new Date();
    const annotations: Record<string, string> = {
      [CREATED_AT_ANNOTATION]: now.toISOString(),
    };
    if (ttlHours !== null) {
      annotations[EXPIRES_AT_ANNOTATION] = new Date(
        now.getTime() + ttlHours * 3_600_000,
      ).toISOString();
    }
    const labels = {
      'app.kubernetes.io/managed-by': MANAGED_BY,
      [INSTANCE_LABEL]: name,
    };

    await this.core.createNamespace({
      body: { metadata: { name: namespace, labels, annotations } },
    });
    const hasPullSecret = await this.replicatePullSecret(namespace);

    const deployment: V1Deployment = {
      metadata: { name: 'floci', namespace, labels },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: 'floci' } },
        template: {
          metadata: { labels: { app: 'floci' } },
          spec: {
            enableServiceLinks: false,
            ...(hasPullSecret ? { imagePullSecrets: [{ name: PULL_SECRET_NAME }] } : {}),
            containers: [
              {
                name: 'floci',
                image: this.opts.flociImage,
                ports: [{ containerPort: 4566 }],
                env: [
                  { name: 'FLOCI_BASE_URL', value: `${this.scheme()}://${host}` },
                  { name: 'DOCKER_HOST', value: 'tcp://localhost:2375' },
                ],
                readinessProbe: {
                  httpGet: { path: '/_floci/health', port: 4566 },
                  initialDelaySeconds: 5,
                  periodSeconds: 5,
                  failureThreshold: 36,
                },
                livenessProbe: {
                  httpGet: { path: '/_floci/health', port: 4566 },
                  initialDelaySeconds: 90,
                  periodSeconds: 20,
                },
                resources: {
                  requests: { cpu: '200m', memory: '512Mi' },
                  limits: { cpu: '1', memory: '1536Mi' },
                },
              },
              {
                name: 'dind',
                image: 'docker:27-dind',
                args: ['--host=tcp://0.0.0.0:2375', '--tls=false'],
                env: [{ name: 'DOCKER_TLS_CERTDIR', value: '' }],
                securityContext: { privileged: true },
                resources: {
                  requests: { cpu: '100m', memory: '256Mi' },
                  limits: { cpu: '1', memory: '1Gi' },
                },
              },
            ],
          },
        },
      },
    };
    await this.apps.createNamespacedDeployment({ namespace, body: deployment });

    const service: V1Service = {
      metadata: { name: 'floci', namespace, labels },
      spec: {
        selector: { app: 'floci' },
        ports: [{ port: 4566, targetPort: 4566 }],
      },
    };
    await this.core.createNamespacedService({ namespace, body: service });

    if (this.gatewayMode) {
      await this.createHttpRoute({
        namespace,
        routeName: 'floci',
        host,
        service: 'floci',
        port: 4566,
        labels,
      });
    } else {
      const ingressAnnotations: Record<string, string> = {
        'nginx.ingress.kubernetes.io/proxy-body-size': '0',
        'nginx.ingress.kubernetes.io/proxy-read-timeout': '300',
        'nginx.ingress.kubernetes.io/proxy-send-timeout': '300',
      };
      if (this.opts.tls) {
        ingressAnnotations['cert-manager.io/cluster-issuer'] = this.opts.clusterIssuer;
      }
      const ingress: V1Ingress = {
        metadata: {
          name: 'floci',
          namespace,
          labels,
          annotations: ingressAnnotations,
        },
        spec: {
          ingressClassName: this.opts.ingressClass,
          ...(this.opts.tls ? { tls: [{ hosts: [host], secretName: 'floci-tls' }] } : {}),
          rules: [
            {
              host,
              http: {
                paths: [
                  {
                    path: '/',
                    pathType: 'Prefix',
                    backend: { service: { name: 'floci', port: { number: 4566 } } },
                  },
                ],
              },
            },
          ],
        },
      };
      await this.net.createNamespacedIngress({ namespace, body: ingress });
    }

    const created = await this.get(name);
    if (!created) {
      throw new Error(`instance ${name} vanished right after creation`);
    }
    return created;
  }

  async delete(name: string): Promise<boolean> {
    const namespace = this.namespaceFor(name);
    let ns: V1Namespace;
    try {
      ns = await this.core.readNamespace({ name: namespace });
    } catch (err) {
      if (isNotFound(err)) {
        return false;
      }
      throw err;
    }
    if (ns.metadata?.labels?.['app.kubernetes.io/managed-by'] !== MANAGED_BY) {
      return false;
    }
    await this.core.deleteNamespace({ name: namespace });
    return true;
  }

  async logs(name: string, tailLines: number): Promise<string> {
    const namespace = this.namespaceFor(name);
    const pods = await this.core.listNamespacedPod({
      namespace,
      labelSelector: 'app=floci',
    });
    const newest = (pods.items ?? []).sort((a, b) =>
      (b.metadata?.creationTimestamp?.toISOString() ?? '').localeCompare(
        a.metadata?.creationTimestamp?.toISOString() ?? '',
      ),
    )[0];
    if (!newest?.metadata?.name) {
      return '';
    }
    try {
      return await this.core.readNamespacedPodLog({
        name: newest.metadata.name,
        namespace,
        tailLines,
      });
    } catch (err) {
      if (statusCodeOf(err) === 400) {
        return 'container is still starting, logs are not available yet';
      }
      throw err;
    }
  }

  async reapExpired(): Promise<string[]> {
    const instances = await this.list();
    const now = Date.now();
    const reaped: string[] = [];
    for (const instance of instances) {
      if (
        instance.status !== 'deleting' &&
        instance.expiresAt &&
        Date.parse(instance.expiresAt) < now
      ) {
        await this.delete(instance.name);
        reaped.push(instance.name);
      }
    }
    return reaped;
  }

  private async describeNamespace(ns: V1Namespace): Promise<InstanceInfo> {
    const nsName = ns.metadata?.name ?? '';
    const name = ns.metadata?.labels?.[INSTANCE_LABEL] ?? nsName.slice(NS_PREFIX.length);
    const host = this.hostFor(name);
    const info: InstanceInfo = {
      name,
      status: 'provisioning',
      statusDetail: null,
      host,
      endpoint: `${this.scheme()}://${host}`,
      createdAt:
        ns.metadata?.annotations?.[CREATED_AT_ANNOTATION] ??
        ns.metadata?.creationTimestamp?.toISOString() ??
        null,
      expiresAt: ns.metadata?.annotations?.[EXPIRES_AT_ANNOTATION] ?? null,
      image: this.opts.flociImage,
      readyReplicas: 0,
    };

    if (ns.status?.phase === 'Terminating') {
      info.status = 'deleting';
      return info;
    }

    try {
      const deployment = await this.apps.readNamespacedDeployment({
        name: 'floci',
        namespace: nsName,
      });
      info.readyReplicas = deployment.status?.readyReplicas ?? 0;
      info.image = deployment.spec?.template?.spec?.containers?.[0]?.image ?? info.image;
    } catch (err) {
      if (!isNotFound(err)) {
        throw err;
      }
      info.status = 'error';
      info.statusDetail = 'deployment is missing';
      return info;
    }

    if (info.readyReplicas > 0) {
      info.status = 'running';
      return info;
    }

    const failureReason = await this.findPodFailure(nsName);
    if (failureReason) {
      info.status = 'error';
      info.statusDetail = failureReason;
    }
    return info;
  }

  private async findPodFailure(namespace: string): Promise<string | null> {
    const pods = await this.core.listNamespacedPod({
      namespace,
      labelSelector: 'app=floci',
    });
    for (const pod of pods.items ?? []) {
      const reason = podFailureReason(pod);
      if (reason) {
        return reason;
      }
    }
    return null;
  }

  private serviceWorkloadName(service: RealServiceId): string {
    return `svc-${service}`;
  }

  serviceHostFor(name: string, service: RealServiceId): string {
    return `${this.serviceWorkloadName(service)}.${this.namespaceFor(name)}.svc.cluster.local`;
  }

  serviceExternalHostFor(name: string, service: RealServiceId): string {
    return `${name}-${service}.${this.opts.instanceDomain}`;
  }

  async listServices(name: string): Promise<RealServiceInfo[]> {
    const namespace = this.namespaceFor(name);
    const [deployments, pods] = await Promise.all([
      this.apps.listNamespacedDeployment({ namespace, labelSelector: SERVICE_LABEL }),
      this.core.listNamespacedPod({ namespace, labelSelector: SERVICE_LABEL }),
    ]);
    const deploymentsById = new Map<string, V1Deployment>();
    for (const deployment of deployments.items ?? []) {
      const id = deployment.metadata?.labels?.[SERVICE_LABEL];
      if (id) {
        deploymentsById.set(id, deployment);
      }
    }
    const failuresById = new Map<string, string>();
    for (const pod of pods.items ?? []) {
      const id = pod.metadata?.labels?.[SERVICE_LABEL];
      if (!id || failuresById.has(id)) {
        continue;
      }
      const reason = podFailureReason(pod);
      if (reason) {
        failuresById.set(id, reason);
      }
    }
    return REAL_SERVICES.map((service) =>
      this.describeService(name, service, deploymentsById.get(service) ?? null, failuresById.get(service) ?? null),
    );
  }

  async getService(name: string, service: RealServiceId): Promise<RealServiceInfo> {
    const services = await this.listServices(name);
    const found = services.find((info) => info.id === service);
    if (!found) {
      throw new Error(`service ${service} is not in the catalog`);
    }
    return found;
  }

  async serviceLogs(name: string, service: RealServiceId, tailLines: number): Promise<string> {
    const namespace = this.namespaceFor(name);
    const pods = await this.core.listNamespacedPod({
      namespace,
      labelSelector: `${SERVICE_LABEL}=${service}`,
    });
    const newest = (pods.items ?? []).sort((a, b) =>
      (b.metadata?.creationTimestamp?.toISOString() ?? '').localeCompare(
        a.metadata?.creationTimestamp?.toISOString() ?? '',
      ),
    )[0];
    if (!newest?.metadata?.name) {
      return '';
    }
    try {
      return await this.core.readNamespacedPodLog({
        name: newest.metadata.name,
        namespace,
        container: service,
        tailLines,
      });
    } catch (err) {
      if (statusCodeOf(err) === 400) {
        return 'container is still starting, logs are not available yet';
      }
      throw err;
    }
  }

  async startService(name: string, service: RealServiceId): Promise<void> {
    const namespace = this.namespaceFor(name);
    const spec = SERVICE_CATALOG[service];
    const workload = this.serviceWorkloadName(service);
    const labels = {
      'app.kubernetes.io/managed-by': MANAGED_BY,
      [INSTANCE_LABEL]: name,
      [SERVICE_LABEL]: service,
    };
    const serviceHost = this.serviceHostFor(name, service);

    const deployment: V1Deployment = {
      metadata: { name: workload, namespace, labels },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: workload } },
        strategy: { type: 'Recreate' },
        template: {
          metadata: { labels: { app: workload, [SERVICE_LABEL]: service } },
          spec: {
            enableServiceLinks: false,
            ...(spec.volumes?.length
              ? {
                  volumes: spec.volumes.map((vol) => ({
                    name: vol.name,
                    emptyDir: vol.sizeLimit ? { sizeLimit: vol.sizeLimit } : {},
                  })),
                }
              : {}),
            containers: [
              {
                name: service,
                image: spec.image,
                ...(spec.command ? { command: spec.command } : {}),
                ...(spec.args ? { args: spec.args } : {}),
                ports: spec.ports.map((port) => ({ name: port.name, containerPort: port.port })),
                env: spec.env({ serviceHost, externalHost: this.serviceExternalHostFor(name, service) }),
                ...(spec.volumes?.length
                  ? {
                      volumeMounts: spec.volumes.map((vol) => ({
                        name: vol.name,
                        mountPath: vol.mountPath,
                      })),
                    }
                  : {}),
                readinessProbe: {
                  tcpSocket: { port: spec.probePort },
                  initialDelaySeconds: 10,
                  periodSeconds: 5,
                  failureThreshold: Math.ceil(spec.startupSeconds / 5),
                },
                livenessProbe: {
                  tcpSocket: { port: spec.probePort },
                  initialDelaySeconds: spec.startupSeconds,
                  periodSeconds: 20,
                  failureThreshold: 3,
                },
                resources: spec.resources,
              },
              ...(spec.sidecars ?? []).map((sidecar) => ({
                name: sidecar.name,
                image: sidecar.image ?? spec.image,
                ...(sidecar.command ? { command: sidecar.command } : {}),
                ...(sidecar.args ? { args: sidecar.args } : {}),
                ...(sidecar.env ? { env: sidecar.env } : {}),
                resources: sidecar.resources,
              })),
            ],
          },
        },
      },
    };
    try {
      await this.apps.createNamespacedDeployment({ namespace, body: deployment });
    } catch (err) {
      if (!isConflict(err)) {
        throw err;
      }
    }

    const clusterService: V1Service = {
      metadata: { name: workload, namespace, labels },
      spec: {
        selector: { app: workload },
        ports: spec.ports.map((port) => ({ name: port.name, port: port.port, targetPort: port.port })),
      },
    };
    try {
      await this.core.createNamespacedService({ namespace, body: clusterService });
    } catch (err) {
      if (!isConflict(err)) {
        throw err;
      }
    }

    if (spec.httpIngressPort) {
      const host = this.serviceExternalHostFor(name, service);
      if (this.gatewayMode) {
        await this.createHttpRoute({
          namespace,
          routeName: workload,
          host,
          service: workload,
          port: spec.httpIngressPort,
          labels,
        });
      } else {
        const ingressAnnotations: Record<string, string> = {
          'nginx.ingress.kubernetes.io/proxy-body-size': '0',
          'nginx.ingress.kubernetes.io/proxy-read-timeout': '300',
          'nginx.ingress.kubernetes.io/proxy-send-timeout': '300',
        };
        if (spec.ingressBackendProtocol) {
          ingressAnnotations['nginx.ingress.kubernetes.io/backend-protocol'] = spec.ingressBackendProtocol;
        }
        if (this.opts.tls) {
          ingressAnnotations['cert-manager.io/cluster-issuer'] = this.opts.clusterIssuer;
        }
        const ingress: V1Ingress = {
          metadata: { name: workload, namespace, labels, annotations: ingressAnnotations },
          spec: {
            ingressClassName: this.opts.ingressClass,
            ...(this.opts.tls ? { tls: [{ hosts: [host], secretName: `${workload}-tls` }] } : {}),
            rules: [
              {
                host,
                http: {
                  paths: [
                    {
                      path: '/',
                      pathType: 'Prefix',
                      backend: {
                        service: { name: workload, port: { number: spec.httpIngressPort } },
                      },
                    },
                  ],
                },
              },
            ],
          },
        };
        try {
          await this.net.createNamespacedIngress({ namespace, body: ingress });
        } catch (err) {
          if (!isConflict(err)) {
            throw err;
          }
        }
      }
    }
  }

  async stopService(name: string, service: RealServiceId): Promise<void> {
    const namespace = this.namespaceFor(name);
    const workload = this.serviceWorkloadName(service);
    const ignoreNotFound = async (op: () => Promise<unknown>) => {
      try {
        await op();
      } catch (err) {
        if (!isNotFound(err)) {
          throw err;
        }
      }
    };
    await ignoreNotFound(() => this.apps.deleteNamespacedDeployment({ name: workload, namespace }));
    await ignoreNotFound(() => this.core.deleteNamespacedService({ name: workload, namespace }));
    if (SERVICE_CATALOG[service].httpIngressPort) {
      await ignoreNotFound(() => this.net.deleteNamespacedIngress({ name: workload, namespace }));
      await this.deleteHttpRoute(namespace, workload);
    }
  }

  async instanceMetrics(name: string): Promise<InstanceMetrics> {
    const namespace = this.namespaceFor(name);
    const [podList, podMetrics] = await Promise.all([
      this.core.listNamespacedPod({ namespace }),
      this.metrics.getPodMetrics(namespace).catch(() => ({ items: [] })),
    ]);
    const podService = new Map<string, string>();
    for (const pod of podList.items) {
      const labels = pod.metadata?.labels ?? {};
      const service = labels[SERVICE_LABEL] ?? (labels.app === 'floci' ? 'floci' : null);
      if (pod.metadata?.name && service) podService.set(pod.metadata.name, service);
    }
    const byService = new Map<string, { cpuMilli: number; memoryBytes: number; pods: number }>();
    for (const item of podMetrics.items) {
      const service = podService.get(item.metadata?.name ?? '');
      if (!service) continue;
      let cpuMilli = 0;
      let memoryBytes = 0;
      for (const container of item.containers ?? []) {
        cpuMilli += parseCpuQuantity(container.usage?.cpu ?? '0');
        memoryBytes += parseMemoryQuantity(container.usage?.memory ?? '0');
      }
      const entry = byService.get(service) ?? { cpuMilli: 0, memoryBytes: 0, pods: 0 };
      entry.cpuMilli += cpuMilli;
      entry.memoryBytes += memoryBytes;
      entry.pods += 1;
      byService.set(service, entry);
    }
    const services = [...byService.entries()]
      .map(([service, usage]) => ({ service, ...usage, cpuMilli: Math.round(usage.cpuMilli) }))
      .sort((a, b) => a.service.localeCompare(b.service));
    return { instance: name, sampledAt: new Date().toISOString(), services };
  }

  async runOtelAgent(name: string, options: OtelAgentOptions): Promise<OtelAgentRun> {
    const namespace = this.namespaceFor(name);
    const script = readFileSync(
      path.join(import.meta.dirname, 'agent', 'otel-agent.mjs'),
      'utf8',
    );
    const configMap = {
      metadata: { name: AGENT_SCRIPT_CONFIGMAP, namespace },
      data: { 'otel-agent.mjs': script },
    };
    try {
      await this.core.createNamespacedConfigMap({ namespace, body: configMap });
    } catch (err) {
      if (!isConflict(err)) {
        throw err;
      }
      await this.core.replaceNamespacedConfigMap({
        name: AGENT_SCRIPT_CONFIGMAP,
        namespace,
        body: configMap,
      });
    }

    const id = `otel-pr-${Date.now().toString(36)}`;
    const model = options.model || 'gemma3n:e4b';
    const ollamaUrl = `http://${this.serviceHostFor(name, 'ollama')}:11434`;
    const job: V1Job = {
      metadata: {
        name: id,
        namespace,
        labels: { [AGENT_LABEL]: 'otel-pr', [INSTANCE_LABEL]: name },
        annotations: {
          [AGENT_REPO_ANNOTATION]: options.repoUrl,
          [AGENT_MODEL_ANNOTATION]: model,
        },
      },
      spec: {
        backoffLimit: 0,
        ttlSecondsAfterFinished: 172800,
        activeDeadlineSeconds: 3600,
        template: {
          metadata: { labels: { [AGENT_LABEL]: 'otel-pr' } },
          spec: {
            restartPolicy: 'Never',
            containers: [
              {
                name: 'agent',
                image: 'node:24-bookworm',
                command: ['node', '/agent/otel-agent.mjs'],
                env: [
                  { name: 'REPO_URL', value: options.repoUrl },
                  { name: 'GITHUB_TOKEN', value: options.githubToken },
                  { name: 'OLLAMA_URL', value: ollamaUrl },
                  { name: 'MODEL', value: model },
                  { name: 'BASE_BRANCH', value: options.baseBranch ?? '' },
                  { name: 'MAX_FILES', value: String(options.maxFiles ?? 4) },
                  { name: 'HOME', value: '/work' },
                ],
                resources: {
                  requests: { cpu: '100m', memory: '256Mi' },
                  limits: { cpu: '1', memory: '1Gi' },
                },
                volumeMounts: [
                  { name: 'script', mountPath: '/agent' },
                  { name: 'work', mountPath: '/work' },
                ],
              },
            ],
            volumes: [
              { name: 'script', configMap: { name: AGENT_SCRIPT_CONFIGMAP } },
              { name: 'work', emptyDir: {} },
            ],
          },
        },
      },
    };
    const created = await this.batch.createNamespacedJob({ namespace, body: job });
    return describeAgentJob(created);
  }

  async listOtelAgentRuns(name: string): Promise<OtelAgentRun[]> {
    const namespace = this.namespaceFor(name);
    const jobs = await this.batch.listNamespacedJob({
      namespace,
      labelSelector: `${AGENT_LABEL}=otel-pr`,
    });
    return (jobs.items ?? [])
      .map(describeAgentJob)
      .sort((a, b) => (b.id ?? '').localeCompare(a.id ?? ''));
  }

  async otelAgentLogs(name: string, runId: string, tailLines: number): Promise<string> {
    const namespace = this.namespaceFor(name);
    const pods = await this.core.listNamespacedPod({
      namespace,
      labelSelector: `job-name=${runId}`,
    });
    const newest = (pods.items ?? []).sort((a, b) =>
      (b.metadata?.creationTimestamp?.toISOString() ?? '').localeCompare(
        a.metadata?.creationTimestamp?.toISOString() ?? '',
      ),
    )[0];
    if (!newest?.metadata?.name) {
      return '';
    }
    try {
      return await this.core.readNamespacedPodLog({
        name: newest.metadata.name,
        namespace,
        container: 'agent',
        tailLines,
      });
    } catch (err) {
      if (statusCodeOf(err) === 400) {
        return 'agent container is still starting, logs are not available yet';
      }
      throw err;
    }
  }

  private describeService(
    name: string,
    service: RealServiceId,
    deployment: V1Deployment | null,
    failure: string | null,
  ): RealServiceInfo {
    const spec = SERVICE_CATALOG[service];
    let status: RealServiceStatus = 'stopped';
    let statusDetail: string | null = null;
    if (deployment) {
      if ((deployment.status?.readyReplicas ?? 0) > 0) {
        status = 'running';
      } else if (failure) {
        status = 'error';
        statusDetail = failure;
      } else {
        status = 'starting';
      }
    }
    const serviceHost = this.serviceHostFor(name, service);
    const externalUrl = spec.httpIngressPort
      ? `${this.scheme()}://${this.serviceExternalHostFor(name, service)}`
      : null;
    return {
      id: service,
      label: spec.label,
      description: spec.description,
      image: spec.image,
      category: spec.category,
      status,
      statusDetail,
      endpoints: spec.endpoints({ serviceHost, externalUrl }),
    };
  }
}
