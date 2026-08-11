// ObjectStoreManager — Sm4rt Object Store: one real SeaweedFS per workspace
// (Apache-2.0, Haystack-paper architecture), published over HTTPS via
// caddy-docker-proxy at s3.<ws>.<domain>, speaking the genuine S3 API so
// aws cli / SDKs work unchanged (path-style).
//
// Chosen over MinIO (license) and Garage (S3 API gaps — HEAD 400 with
// aws-cli v2 — and performance declared a non-goal upstream). SeaweedFS also
// ships an embedded Iceberg REST catalog, which the lake path uses.
//
// Credentials live in an s3.json identities file (docker config). The
// workspace key carries Admin, so bucket create/delete go through the plain
// S3 API — no CLI/exec needed. A static lake key (used by the Iceberg/Trino
// catalog services) is provisioned alongside it.
import {
  S3Client,
  ListBucketsCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
} from '@aws-sdk/client-s3';
import { randomBytes } from 'node:crypto';
import type Docker from 'dockerode';
import {
  SM4RT_KIND_LABEL,
  SM4RT_NAME_LABEL,
  SM4RT_WS_LABEL,
} from './compute-templates.ts';
import { ComputeError, type ComputeManager } from './compute.ts';

const NETWORK_NAME = process.env.SWARM_NETWORK ?? 'floci-net';

/** Static identity for the shared lake path (Iceberg REST / Trino / Spark). */
export const LAKE_ACCESS_KEY = 'GKfloci0lake0static';
export const LAKE_SECRET_KEY = 'floci-secret-lake-0000000000000000';

interface ObjectStoreSecrets {
  user: string;
  pass: string;
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

/** seaweedfs s3.json — workspace admin identity + static lake identity. */
export function seaweedS3Config(secrets: { user: string; pass: string }): string {
  return JSON.stringify(
    {
      identities: [
        {
          name: secrets.user,
          credentials: [{ accessKey: secrets.user, secretKey: secrets.pass }],
          actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
        },
        {
          name: 'lake-static',
          credentials: [{ accessKey: LAKE_ACCESS_KEY, secretKey: LAKE_SECRET_KEY }],
          actions: ['Read', 'Write', 'List', 'Tagging'],
        },
      ],
    },
    null,
    2,
  );
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
      Labels: { [SM4RT_KIND_LABEL]: 'objectstore-auth' },
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
      user: `${ws}-admin`,
      pass: randomBytes(20).toString('hex'),
    };
    await this.writeConfig(this.secretsConfig(ws), secrets);
    const auth = await this.createConfigRaw(
      `sm4rt-s3-${ws}-auth`,
      seaweedS3Config(secrets),
    );
    const name = this.serviceName(ws);
    const host = this.host(ws);
    await this.docker.createService({
      Name: name,
      Labels: {
        [SM4RT_KIND_LABEL]: 'objectstore',
        [SM4RT_WS_LABEL]: ws,
        [SM4RT_NAME_LABEL]: 's3',
        ...this.compute.caddyLabelsFor(host, 8333),
      },
      TaskTemplate: {
        ContainerSpec: {
          Image: 'chrislusf/seaweedfs:3.97',
          Args: [
            'server',
            '-dir=/data',
            '-s3',
            '-s3.port=8333',
            '-s3.config=/etc/seaweedfs/s3.json',
            '-master.volumeSizeLimitMB=1024',
          ],
          Labels: { [SM4RT_WS_LABEL]: ws, [SM4RT_KIND_LABEL]: 'objectstore', [SM4RT_NAME_LABEL]: 's3' },
          Mounts: [
            {
              Type: 'volume',
              Source: `${name}-data`,
              Target: '/data',
              VolumeOptions: { Labels: { [SM4RT_WS_LABEL]: ws } },
            } as unknown as Docker.MountSettings,
          ],
          Configs: [
            {
              ConfigID: auth.id,
              ConfigName: auth.name,
              File: { Name: '/etc/seaweedfs/s3.json', UID: '0', GID: '0', Mode: 0o444 },
            },
          ],
        },
        Resources: { Limits: { NanoCPUs: cpusToNano(1), MemoryBytes: mbToBytes(768) } },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
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
    await this.removeConfigsByPrefix(`sm4rt-s3-${ws}-auth`);
    try {
      await this.docker.getVolume(`${name}-data`).remove();
    } catch {
      // still in use or already gone — best effort
    }
    if (!svc) throw new ComputeError(404, 'object store not enabled');
  }

  // ————————————————— buckets (plain S3 API — ws key has Admin) —————————————————

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

  private async withS3<T>(ws: string, fn: (client: S3Client) => Promise<T>): Promise<T> {
    // overlay DNS first (prod), public edge fallback (local dev) — registry pattern
    try {
      const inner = await this.s3(ws, `http://${this.serviceName(ws)}:8333`);
      return await fn(inner);
    } catch (err) {
      if (err instanceof ComputeError) throw err;
      const named = (err as { name?: string }).name ?? '';
      if (named && !/ENOTFOUND|ECONN|EAI_AGAIN|TimeoutError/.test(`${named} ${String(err)}`)) {
        throw err; // a real S3 error from the service — don't mask it via the edge
      }
      const outer = await this.s3(ws, `${this.scheme()}://${this.host(ws)}`);
      try {
        return await fn(outer);
      } catch (err2) {
        throw new ComputeError(502, `object store unreachable: ${(err2 as Error).message}`);
      }
    }
  }

  async listBuckets(ws: string): Promise<BucketInfo[]> {
    return this.withS3(ws, async (client) => {
      const res = await client.send(new ListBucketsCommand({}));
      return (res.Buckets ?? []).map((b) => ({
        name: b.Name ?? '',
        createdAt: b.CreationDate ? b.CreationDate.toISOString() : null,
      }));
    });
  }

  async createBucket(ws: string, bucket: string): Promise<void> {
    if (!isValidBucketName(bucket)) {
      throw new ComputeError(400, 'invalid bucket name (3-63 chars, lowercase, s3 rules)');
    }
    await this.withS3(ws, async (client) => {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (err) {
        const name = (err as { name?: string }).name ?? '';
        if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') {
          throw new ComputeError(409, `bucket ${bucket} already exists`);
        }
        throw err;
      }
    });
  }

  async deleteBucket(ws: string, bucket: string): Promise<void> {
    if (!isValidBucketName(bucket)) {
      throw new ComputeError(400, 'invalid bucket name');
    }
    await this.withS3(ws, async (client) => {
      try {
        await client.send(new DeleteBucketCommand({ Bucket: bucket }));
      } catch (err) {
        const name = (err as { name?: string }).name ?? '';
        if (name === 'NoSuchBucket') throw new ComputeError(404, `bucket ${bucket} not found`);
        if (name === 'BucketNotEmpty') throw new ComputeError(409, `bucket ${bucket} is not empty`);
        throw err;
      }
    });
  }
}
