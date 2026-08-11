// ObjectStoreManager — Sm4rt Object Store: one real Garage (Rust, by
// deuxfleurs) per workspace, published over HTTPS via caddy-docker-proxy at
// s3.<ws>.<domain>, speaking the genuine S3 API so aws cli / SDKs work
// unchanged (path-style). Chosen over MinIO (license concerns) and
// SeaweedFS — and it aligns with the platform's Rust direction.
//
// Garage v2.3 bootstraps its default access key and bucket from env vars
// (--single-node --default-bucket). Listing uses the S3 API; bucket
// create/delete run the garage CLI inside the container (docker exec,
// manager-pinned service) because S3 CreateBucket requires a global key
// permission the default key does not carry.
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { randomBytes } from 'node:crypto';
import type Docker from 'dockerode';
import {
  SM4RT_KIND_LABEL,
  SM4RT_NAME_LABEL,
  SM4RT_WS_LABEL,
} from './compute-templates.ts';
import { ComputeError, type ComputeManager } from './compute.ts';

const NETWORK_NAME = process.env.SWARM_NETWORK ?? 'floci-net';

interface ObjectStoreSecrets {
  user: string; // S3 access key id (GK…)
  pass: string; // S3 secret key
}

export interface ObjectStoreStatus {
  enabled: boolean;
  state: string;
  host: string | null;
  url: string | null;
  accessKey: string | null;
  secretKey: string | null;
}

export interface BucketInfo {
  name: string;
  createdAt: string | null;
}

/** S3 bucket naming rules (the subset every SDK enforces). */
export function isValidBucketName(name: string): boolean {
  if (name.length < 3 || name.length > 63) return false;
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) return false;
  if (name.includes('..') || name.includes('.-') || name.includes('-.')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return false;
  return true;
}

/** garage.toml for a single-node, workspace-scoped deployment. */
export function garageConfig(rpcSecret: string): string {
  return `metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1

rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "${rpcSecret}"

[s3_api]
s3_region = "us-east-1"
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage.localhost"
`;
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

export class ObjectStoreManager {
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
    return `sm4rt-s3-${ws}`;
  }
  private secretsConfig(ws: string) {
    return `sm4rt-s3-${ws}-secrets`;
  }
  private host(ws: string) {
    return this.compute.hostFor(ws, 's3');
  }

  // — docker config KV (same pattern as RegistryManager) —
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
      Labels: { [SM4RT_KIND_LABEL]: 'objectstore-state' },
    });
  }

  private async createConfigRaw(baseName: string, data: string): Promise<{ name: string; id: string }> {
    const name = `${baseName}-${Date.now().toString(36)}`;
    await this.docker.createConfig({
      Name: name,
      Data: Buffer.from(data, 'utf8').toString('base64'),
      Labels: { [SM4RT_KIND_LABEL]: 'objectstore-toml' },
    });
    const configs = (await this.docker.listConfigs({
      filters: JSON.stringify({ name: [name] }),
    })) as Array<{ ID: string; Spec?: { Name?: string } }>;
    const found = configs.find((c) => c.Spec?.Name === name);
    if (!found) throw new ComputeError(500, `config ${name} not found after create`);
    return { name, id: found.ID };
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
            // in use or already gone — best effort
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

  // — garage CLI via docker exec (service is manager-pinned) —
  private async garageCli(ws: string, args: string[]): Promise<string> {
    const containers = (await this.docker.listContainers({
      filters: JSON.stringify({
        label: [`com.docker.swarm.service.name=${this.serviceName(ws)}`],
      }),
    })) as Array<{ Id: string }>;
    if (containers.length === 0) {
      throw new ComputeError(503, 'object store container not found on this node');
    }
    const container = this.docker.getContainer(containers[0].Id);
    const exec = await container.exec({
      Cmd: ['/garage', ...args],
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({});
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    const raw = Buffer.concat(chunks);
    let out = '';
    let offset = 0;
    while (offset + 8 <= raw.length) {
      const size = raw.readUInt32BE(offset + 4);
      out += raw.subarray(offset + 8, offset + 8 + size).toString('utf8');
      offset += 8 + size;
    }
    const text = out || raw.toString('utf8');
    const inspect = (await exec.inspect()) as { ExitCode?: number };
    if ((inspect.ExitCode ?? 0) !== 0) {
      throw new ComputeError(502, `garage ${args.join(' ')} failed: ${text.trim().slice(0, 300)}`);
    }
    return text;
  }

  // ————————————————— enable / status / disable —————————————————

  async status(ws: string): Promise<ObjectStoreStatus> {
    const svc = await this.getServiceRaw(this.serviceName(ws));
    if (!svc) {
      return { enabled: false, state: 'disabled', host: null, url: null, accessKey: null, secretKey: null };
    }
    const secrets = await this.readConfig<ObjectStoreSecrets>(this.secretsConfig(ws));
    const up = await this.serviceRunning(this.serviceName(ws));
    const host = this.host(ws);
    return {
      enabled: true,
      state: up ? 'running' : 'starting',
      host,
      url: `${this.scheme()}://${host}`,
      accessKey: secrets?.user ?? null,
      secretKey: secrets?.pass ?? null,
    };
  }

  async enable(ws: string): Promise<ObjectStoreStatus> {
    await this.compute.ensureNet();
    if (await this.getServiceRaw(this.serviceName(ws))) {
      throw new ComputeError(409, 'object store already enabled');
    }
    const secrets: ObjectStoreSecrets = {
      user: `GK${randomBytes(16).toString('hex')}`,
      pass: randomBytes(32).toString('hex'),
    };
    await this.writeConfig(this.secretsConfig(ws), secrets);
    const toml = await this.createConfigRaw(
      `sm4rt-s3-${ws}-toml`,
      garageConfig(randomBytes(32).toString('hex')),
    );
    const name = this.serviceName(ws);
    const host = this.host(ws);
    await this.docker.createService({
      Name: name,
      Labels: {
        [SM4RT_KIND_LABEL]: 'objectstore',
        [SM4RT_WS_LABEL]: ws,
        [SM4RT_NAME_LABEL]: 's3',
        ...this.compute.caddyLabelsFor(host, 3900),
      },
      TaskTemplate: {
        ContainerSpec: {
          Image: 'dxflrs/garage:v2.3.0',
          Args: ['/garage', 'server', '--single-node', '--default-bucket'],
          Env: [
            `GARAGE_DEFAULT_ACCESS_KEY=${secrets.user}`,
            `GARAGE_DEFAULT_SECRET_KEY=${secrets.pass}`,
            `GARAGE_DEFAULT_BUCKET=${ws}-default`,
          ],
          Labels: { [SM4RT_WS_LABEL]: ws, [SM4RT_KIND_LABEL]: 'objectstore', [SM4RT_NAME_LABEL]: 's3' },
          Mounts: [
            {
              Type: 'volume',
              Source: `${name}-data`,
              Target: '/var/lib/garage',
              VolumeOptions: { Labels: { [SM4RT_WS_LABEL]: ws } },
            } as unknown as Docker.MountSettings,
          ],
          Configs: [
            {
              ConfigID: toml.id,
              ConfigName: toml.name,
              File: { Name: '/etc/garage.toml', UID: '0', GID: '0', Mode: 0o444 },
            },
          ],
        },
        Resources: { Limits: { NanoCPUs: cpusToNano(1), MemoryBytes: mbToBytes(512) } },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
        // manager node: bucket create/delete run the garage CLI via exec
        Placement: { Constraints: ['node.role == manager'] },
        Networks: [{ Target: NETWORK_NAME, Aliases: [name] }],
      },
      Mode: { Replicated: { Replicas: 1 } },
      EndpointSpec: { Mode: 'dnsrr' },
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
    await this.removeConfigsByPrefix(`sm4rt-s3-${ws}-toml`);
    try {
      await this.docker.getVolume(`${name}-data`).remove();
    } catch {
      // still in use or already gone — best effort
    }
    if (!svc) throw new ComputeError(404, 'object store not enabled');
  }

  // ————————————————— buckets —————————————————

  private async s3(ws: string, endpoint: string): Promise<S3Client> {
    const secrets = await this.readConfig<ObjectStoreSecrets>(this.secretsConfig(ws));
    if (!secrets) throw new ComputeError(503, 'object store secrets not found');
    return new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: secrets.user, secretAccessKey: secrets.pass },
    });
  }

  async listBuckets(ws: string): Promise<BucketInfo[]> {
    // overlay first (prod), public edge fallback (local dev) — registry pattern
    const tryList = async (endpoint: string) => {
      const client = await this.s3(ws, endpoint);
      const res = await client.send(new ListBucketsCommand({}));
      return (res.Buckets ?? []).map((b) => ({
        name: b.Name ?? '',
        createdAt: b.CreationDate ? b.CreationDate.toISOString() : null,
      }));
    };
    try {
      return await tryList(`http://${this.serviceName(ws)}:3900`);
    } catch (err) {
      if (err instanceof ComputeError) throw err;
      try {
        return await tryList(`${this.scheme()}://${this.host(ws)}`);
      } catch (err2) {
        throw new ComputeError(502, `object store unreachable: ${(err2 as Error).message}`);
      }
    }
  }

  async createBucket(ws: string, bucket: string): Promise<void> {
    if (!isValidBucketName(bucket)) {
      throw new ComputeError(400, 'invalid bucket name (3-63 chars, lowercase, s3 rules)');
    }
    const secrets = await this.readConfig<ObjectStoreSecrets>(this.secretsConfig(ws));
    if (!secrets) throw new ComputeError(503, 'object store secrets not found');
    const existing = await this.listBuckets(ws);
    if (existing.some((b) => b.name === bucket)) {
      throw new ComputeError(409, `bucket ${bucket} already exists`);
    }
    await this.garageCli(ws, ['bucket', 'create', bucket]);
    await this.garageCli(ws, [
      'bucket', 'allow', '--read', '--write', '--owner', bucket, '--key', secrets.user,
    ]);
  }

  async deleteBucket(ws: string, bucket: string): Promise<void> {
    if (!isValidBucketName(bucket)) {
      throw new ComputeError(400, 'invalid bucket name');
    }
    const existing = await this.listBuckets(ws);
    if (!existing.some((b) => b.name === bucket)) {
      throw new ComputeError(404, `bucket ${bucket} not found`);
    }
    try {
      await this.garageCli(ws, ['bucket', 'delete', '--yes', bucket]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not empty|objects/i.test(msg)) {
        throw new ComputeError(409, `bucket ${bucket} is not empty`);
      }
      throw err;
    }
  }
}
