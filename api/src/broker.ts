// BrokerManager — Sm4rt Message Broker: one real RabbitMQ (management image)
// per workspace. AMQP is published on a cluster port from the broker range
// (17000-17999) so any client can connect with amqp://; the management UI is
// exposed at mq.<ws>.<domain> through caddy. Queue introspection uses the
// management HTTP API — the same one rabbitmqadmin talks to.
import type Docker from 'dockerode';
import {
  BROKER_PORT_RANGE,
  SM4RT_KIND_LABEL,
  SM4RT_NAME_LABEL,
  SM4RT_WS_LABEL,
  allocatePort,
  randomSecret,
} from './compute-templates.ts';
import { ComputeError, type ComputeManager } from './compute.ts';

const NETWORK_NAME = process.env.SWARM_NETWORK ?? 'floci-net';

interface BrokerSecrets {
  user: string;
  pass: string;
  amqpPort: number;
}

export interface BrokerStatus {
  enabled: boolean;
  state: string;
  host: string | null;
  managementUrl: string | null;
  amqpUrl: string | null;
  user: string | null;
  password: string | null;
}

export interface QueueInfo {
  name: string;
  vhost: string;
  messages: number | null;
  consumers: number | null;
  state: string | null;
}

/** RabbitMQ queue names: printable, no control chars, <=255 bytes. */
export function isValidQueueName(name: string): boolean {
  return /^[\x21-\x7e]{1,255}$/.test(name) && !name.startsWith('amq.');
}

function cpusToNano(c: number): number {
  return Math.round(c * 1e9);
}
function mbToBytes(mb: number): number {
  return Math.round(mb * 1024 ** 2);
}
function isNotFoundErr(err: unknown): boolean {
  return (err as { statusCode?: number })?.statusCode === 404;
}

export class BrokerManager {
  private docker: Docker;
  private compute: ComputeManager;
  private tls: boolean;

  constructor(compute: ComputeManager) {
    this.compute = compute;
    this.docker = compute.dockerClient;
    this.tls = compute.options.tls;
  }

  private scheme(): string {
    return this.tls ? 'https' : 'http';
  }
  private serviceName(ws: string) {
    return `sm4rt-mq-${ws}`;
  }
  private secretsConfig(ws: string) {
    return `sm4rt-mq-${ws}-secrets`;
  }
  private host(ws: string) {
    return this.compute.hostFor(ws, 'mq');
  }
  /** the AMQP endpoint host: the workspace domain's root (cluster public IP behind it) */
  private amqpHost(ws: string) {
    return this.host(ws);
  }

  // — docker config KV —
  private async readConfig<T>(name: string): Promise<T | null> {
    try {
      const configs = (await this.docker.listConfigs({
        filters: JSON.stringify({ name: [name] }),
      })) as Array<{ ID: string; Spec?: { Name?: string } }>;
      const found = configs.find((c) => c.Spec?.Name === name);
      if (!found) return null;
      const inspected = (await this.docker.getConfig(found.ID).inspect()) as {
        Spec?: { Data?: string };
      };
      const data = inspected.Spec?.Data;
      if (!data) return null;
      return JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as T;
    } catch (err) {
      if (isNotFoundErr(err)) return null;
      throw err;
    }
  }

  private async writeConfig(name: string, value: unknown): Promise<void> {
    try {
      const configs = (await this.docker.listConfigs({
        filters: JSON.stringify({ name: [name] }),
      })) as Array<{ ID: string; Spec?: { Name?: string } }>;
      const found = configs.find((c) => c.Spec?.Name === name);
      if (found) await this.docker.getConfig(found.ID).remove();
    } catch {
      // ignore
    }
    await this.docker.createConfig({
      Name: name,
      Data: Buffer.from(JSON.stringify(value), 'utf8').toString('base64'),
      Labels: { [SM4RT_KIND_LABEL]: 'broker-state' },
    });
  }

  private async removeConfigsByPrefix(prefix: string): Promise<void> {
    try {
      const configs = (await this.docker.listConfigs({})) as Array<{
        ID: string;
        Spec?: { Name?: string };
      }>;
      for (const c of configs) {
        const n = c.Spec?.Name ?? '';
        if (n === prefix || n.startsWith(`${prefix}-`)) {
          try {
            await this.docker.getConfig(c.ID).remove();
          } catch {
            // best effort
          }
        }
      }
    } catch {
      // ignore
    }
  }

  private async getServiceRaw(name: string): Promise<Record<string, any> | null> {
    try {
      return (await this.docker.getService(name).inspect()) as Record<string, any>;
    } catch (err) {
      if (isNotFoundErr(err)) return null;
      throw err;
    }
  }

  private async serviceRunning(name: string): Promise<boolean> {
    try {
      const tasks = (await this.docker.listTasks({
        filters: JSON.stringify({ service: [name] }),
      })) as Array<Record<string, any>>;
      return tasks.some((t) => t.Status?.State === 'running' && t.DesiredState === 'running');
    } catch {
      return false;
    }
  }

  private async usedPublishedPorts(): Promise<Set<number>> {
    const used = new Set<number>();
    const services = (await this.docker.listServices({})) as Array<{
      Spec?: { EndpointSpec?: { Ports?: Array<{ PublishedPort?: number }> } };
      Endpoint?: { Ports?: Array<{ PublishedPort?: number }> };
    }>;
    for (const s of services) {
      for (const p of s.Spec?.EndpointSpec?.Ports ?? []) {
        if (p.PublishedPort) used.add(p.PublishedPort);
      }
      for (const p of s.Endpoint?.Ports ?? []) {
        if (p.PublishedPort) used.add(p.PublishedPort);
      }
    }
    return used;
  }

  // ————————————————— enable / status / disable —————————————————

  async status(ws: string): Promise<BrokerStatus> {
    const svc = await this.getServiceRaw(this.serviceName(ws));
    if (!svc) {
      return {
        enabled: false,
        state: 'disabled',
        host: null,
        managementUrl: null,
        amqpUrl: null,
        user: null,
        password: null,
      };
    }
    const secrets = await this.readConfig<BrokerSecrets>(this.secretsConfig(ws));
    const up = await this.serviceRunning(this.serviceName(ws));
    const host = this.host(ws);
    return {
      enabled: true,
      state: up ? 'running' : 'starting',
      host,
      managementUrl: `${this.scheme()}://${host}`,
      amqpUrl: secrets
        ? `amqp://${secrets.user}:${secrets.pass}@${this.amqpHost(ws)}:${secrets.amqpPort}`
        : null,
      user: secrets?.user ?? null,
      password: secrets?.pass ?? null,
    };
  }

  async enable(ws: string): Promise<BrokerStatus> {
    await this.compute.ensureNet();
    if (await this.getServiceRaw(this.serviceName(ws))) {
      throw new ComputeError(409, 'broker already enabled');
    }
    const amqpPort = allocatePort(await this.usedPublishedPorts(), BROKER_PORT_RANGE);
    if (!amqpPort) throw new ComputeError(503, 'no free broker ports left on the cluster');
    const secrets: BrokerSecrets = { user: `${ws}-admin`, pass: randomSecret(20), amqpPort };
    await this.writeConfig(this.secretsConfig(ws), secrets);
    const name = this.serviceName(ws);
    const host = this.host(ws);
    await this.docker.createService({
      Name: name,
      Labels: {
        [SM4RT_KIND_LABEL]: 'broker',
        [SM4RT_WS_LABEL]: ws,
        [SM4RT_NAME_LABEL]: 'mq',
        // self-register with the workspace observability stack at birth
        'sm4rt.metrics': JSON.stringify({ port: 15692, path: '/metrics' }),
        ...this.compute.caddyLabelsFor(host, 15672),
      },
      TaskTemplate: {
        ContainerSpec: {
          Image: 'rabbitmq:3-management',
          Env: [
            `RABBITMQ_DEFAULT_USER=${secrets.user}`,
            `RABBITMQ_DEFAULT_PASS=${secrets.pass}`,
          ],
          Labels: { [SM4RT_WS_LABEL]: ws, [SM4RT_KIND_LABEL]: 'broker', [SM4RT_NAME_LABEL]: 'mq' },
          Mounts: [
            {
              Type: 'volume',
              Source: `${name}-data`,
              Target: '/var/lib/rabbitmq',
              VolumeOptions: { Labels: { [SM4RT_WS_LABEL]: ws } },
            } as unknown as Docker.MountSettings,
          ],
        },
        Resources: { Limits: { NanoCPUs: cpusToNano(1), MemoryBytes: mbToBytes(768) } },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
        Networks: [{ Target: NETWORK_NAME, Aliases: [name] }],
      },
      Mode: { Replicated: { Replicas: 1 } },
      EndpointSpec: {
        // AMQP over the swarm ingress mesh; management goes through caddy (dnsrr-style vip is fine)
        Ports: [{ Protocol: 'tcp', TargetPort: 5672, PublishedPort: amqpPort }],
      },
    } as Docker.CreateServiceOptions);
    return this.status(ws);
  }

  async disable(ws: string): Promise<void> {
    const name = this.serviceName(ws);
    const svc = await this.getServiceRaw(name);
    if (svc) {
      await this.docker.getService(name).remove();
    }
    await this.removeConfigsByPrefix(this.secretsConfig(ws));
    try {
      await this.docker.getVolume(`${name}-data`).remove();
    } catch {
      // best effort
    }
    if (!svc) throw new ComputeError(404, 'broker not enabled');
  }

  // ————————————————— queues (management HTTP API) —————————————————

  private async mgmt(
    ws: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const secrets = await this.readConfig<BrokerSecrets>(this.secretsConfig(ws));
    if (!secrets) throw new ComputeError(503, 'broker secrets not found');
    const auth = `Basic ${Buffer.from(`${secrets.user}:${secrets.pass}`).toString('base64')}`;
    const init: RequestInit = {
      method,
      headers: {
        authorization: auth,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    };
    const parse = async (res: Response) => {
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }
      return { status: res.status, json };
    };
    try {
      return await parse(await fetch(`http://${this.serviceName(ws)}:15672/api${path}`, init));
    } catch {
      try {
        return await parse(await fetch(`${this.scheme()}://${this.host(ws)}/api${path}`, init));
      } catch (err) {
        throw new ComputeError(502, `broker unreachable: ${(err as Error).message}`);
      }
    }
  }

  async listQueues(ws: string): Promise<QueueInfo[]> {
    const { status, json } = await this.mgmt(ws, 'GET', '/queues?page=1&page_size=100');
    if (status !== 200) throw new ComputeError(502, `broker queues returned ${status}`);
    const items = Array.isArray(json)
      ? (json as Array<Record<string, unknown>>)
      : ((json as { items?: Array<Record<string, unknown>> })?.items ?? []);
    return items.map((q) => ({
      name: String(q.name ?? ''),
      vhost: String(q.vhost ?? '/'),
      messages: typeof q.messages === 'number' ? q.messages : null,
      consumers: typeof q.consumers === 'number' ? q.consumers : null,
      state: typeof q.state === 'string' ? q.state : null,
    }));
  }

  async createQueue(ws: string, queue: string): Promise<void> {
    if (!isValidQueueName(queue)) throw new ComputeError(400, 'invalid queue name');
    const { status } = await this.mgmt(ws, 'PUT', `/queues/%2f/${encodeURIComponent(queue)}`, {
      durable: true,
    });
    if (status !== 201 && status !== 204) {
      throw new ComputeError(502, `queue create returned ${status}`);
    }
  }

  async deleteQueue(ws: string, queue: string): Promise<void> {
    if (!isValidQueueName(queue)) throw new ComputeError(400, 'invalid queue name');
    const { status } = await this.mgmt(ws, 'DELETE', `/queues/%2f/${encodeURIComponent(queue)}`);
    if (status === 404) throw new ComputeError(404, `queue ${queue} not found`);
    if (status !== 204) throw new ComputeError(502, `queue delete returned ${status}`);
  }
}
