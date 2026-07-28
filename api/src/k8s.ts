import {
  ApiException,
  AppsV1Api,
  CoreV1Api,
  KubeConfig,
  NetworkingV1Api,
  type V1Deployment,
  type V1Ingress,
  type V1Namespace,
  type V1Service,
} from '@kubernetes/client-node';

const MANAGED_BY = 'floci-cloud';
const NS_PREFIX = 'floci-i-';
const INSTANCE_LABEL = 'floci.cloud/instance';
const CREATED_AT_ANNOTATION = 'floci.cloud/created-at';
const EXPIRES_AT_ANNOTATION = 'floci.cloud/expires-at';

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

export class Provisioner {
  private core: CoreV1Api;
  private apps: AppsV1Api;
  private net: NetworkingV1Api;
  private opts: ProvisionerOptions;

  constructor(opts: ProvisionerOptions) {
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromDefault();
    this.core = kubeConfig.makeApiClient(CoreV1Api);
    this.apps = kubeConfig.makeApiClient(AppsV1Api);
    this.net = kubeConfig.makeApiClient(NetworkingV1Api);
    this.opts = opts;
  }

  hostFor(name: string): string {
    return `${name}.${this.opts.instanceDomain}`;
  }

  namespaceFor(name: string): string {
    return NS_PREFIX + name;
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

    const deployment: V1Deployment = {
      metadata: { name: 'floci', namespace, labels },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: 'floci' } },
        template: {
          metadata: { labels: { app: 'floci' } },
          spec: {
            enableServiceLinks: false,
            containers: [
              {
                name: 'floci',
                image: this.opts.flociImage,
                ports: [{ containerPort: 4566 }],
                env: [
                  { name: 'FLOCI_BASE_URL', value: `http://${host}` },
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

    const ingress: V1Ingress = {
      metadata: {
        name: 'floci',
        namespace,
        labels,
        annotations: {
          'nginx.ingress.kubernetes.io/proxy-body-size': '0',
          'nginx.ingress.kubernetes.io/proxy-read-timeout': '300',
          'nginx.ingress.kubernetes.io/proxy-send-timeout': '300',
        },
      },
      spec: {
        ingressClassName: this.opts.ingressClass,
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
      endpoint: `http://${host}`,
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
    const failureReasons = new Set([
      'CrashLoopBackOff',
      'ImagePullBackOff',
      'ErrImagePull',
      'CreateContainerConfigError',
      'CreateContainerError',
      'OOMKilled',
    ]);
    const pods = await this.core.listNamespacedPod({
      namespace,
      labelSelector: 'app=floci',
    });
    for (const pod of pods.items ?? []) {
      for (const containerStatus of pod.status?.containerStatuses ?? []) {
        const waiting = containerStatus.state?.waiting?.reason;
        if (waiting && failureReasons.has(waiting)) {
          return waiting;
        }
        const terminated = containerStatus.lastState?.terminated?.reason;
        if (terminated && failureReasons.has(terminated)) {
          return terminated;
        }
      }
    }
    return null;
  }
}
