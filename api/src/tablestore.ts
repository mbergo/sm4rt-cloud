// TableStoreManager — Sm4rt Table Store: one real ScyllaDB with Alternator
// (the genuine DynamoDB wire protocol) per workspace, published over HTTPS at
// ddb.<ws>.<domain>. Table operations use @aws-sdk/client-dynamodb — the same
// SigV4 requests any AWS SDK sends.
//
// Alternator authorization: access key is a Scylla role name and the secret
// is that role's salted_hash from system.roles. We read it once with cqlsh
// inside the container (service is pinned to the manager node like the
// registry, so docker exec over the local socket works) and cache it in a
// docker config.
import {
  DynamoDBClient,
  ListTablesCommand,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  type AttributeDefinition,
  type KeySchemaElement,
} from '@aws-sdk/client-dynamodb';
import type Docker from 'dockerode';
import {
  SM4RT_KIND_LABEL,
  SM4RT_NAME_LABEL,
  SM4RT_WS_LABEL,
} from './compute-templates.ts';
import { ComputeError, type ComputeManager } from './compute.ts';

const NETWORK_NAME = process.env.SWARM_NETWORK ?? 'floci-net';

interface TableStoreSecrets {
  accessKey: string;
  secretKey: string;
}

export interface TableStoreStatus {
  enabled: boolean;
  state: string;
  host: string | null;
  url: string | null;
  accessKey: string | null;
  secretKey: string | null;
}

export interface TableInfo {
  name: string;
  status: string | null;
  keySchema: Array<{ attribute: string; type: string; role: string }>;
  itemCount: number | null;
}

export type KeyType = 'S' | 'N' | 'B';

/** DynamoDB table naming rules. */
export function isValidTableName(name: string): boolean {
  return /^[A-Za-z0-9_.-]{3,255}$/.test(name);
}

export function isValidAttrName(name: string): boolean {
  return /^[A-Za-z0-9_.-]{1,255}$/.test(name);
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

export class TableStoreManager {
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
    return `sm4rt-ddb-${ws}`;
  }
  private secretsConfig(ws: string) {
    return `sm4rt-ddb-${ws}-secrets`;
  }
  private host(ws: string) {
    return this.compute.hostFor(ws, 'ddb');
  }

  // — docker config KV (same as RegistryManager) —
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
      Labels: { [SM4RT_KIND_LABEL]: 'tablestore-state' },
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

  // — exec inside the (manager-pinned) container —
  private async execInContainer(ws: string, cmd: string[]): Promise<string> {
    const containers = (await this.docker.listContainers({
      filters: JSON.stringify({
        label: [`com.docker.swarm.service.name=${this.serviceName(ws)}`],
      }),
    })) as Array<{ Id: string }>;
    if (containers.length === 0) {
      throw new ComputeError(503, 'table store container not found on this node');
    }
    const container = this.docker.getContainer(containers[0].Id);
    const exec = await container.exec({
      Cmd: cmd,
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
    // strip the 8-byte docker stream multiplex headers
    const raw = Buffer.concat(chunks);
    let out = '';
    let offset = 0;
    while (offset + 8 <= raw.length) {
      const size = raw.readUInt32BE(offset + 4);
      out += raw.subarray(offset + 8, offset + 8 + size).toString('utf8');
      offset += 8 + size;
    }
    return out || raw.toString('utf8');
  }

  /** Alternator secret = salted_hash of the default superuser role. */
  private async fetchAlternatorSecret(ws: string): Promise<string> {
    const out = await this.execInContainer(ws, [
      'cqlsh',
      '-u',
      'cassandra',
      '-p',
      'cassandra',
      '-e',
      "SELECT salted_hash FROM system.roles WHERE role = 'cassandra'",
    ]);
    const m = /(\$[0-9a-zA-Z$./]+)/.exec(out);
    if (!m) {
      throw new ComputeError(503, 'table store still bootstrapping — try again shortly');
    }
    return m[1];
  }

  private async secrets(ws: string): Promise<TableStoreSecrets> {
    const cached = await this.readConfig<TableStoreSecrets>(this.secretsConfig(ws));
    if (cached?.secretKey) return cached;
    const secretKey = await this.fetchAlternatorSecret(ws);
    const secrets: TableStoreSecrets = { accessKey: 'cassandra', secretKey };
    await this.writeConfig(this.secretsConfig(ws), secrets);
    return secrets;
  }

  // ————————————————— enable / status / disable —————————————————

  async status(ws: string): Promise<TableStoreStatus> {
    const svc = await this.getServiceRaw(this.serviceName(ws));
    if (!svc) {
      return { enabled: false, state: 'disabled', host: null, url: null, accessKey: null, secretKey: null };
    }
    const up = await this.serviceRunning(this.serviceName(ws));
    const host = this.host(ws);
    let creds: TableStoreSecrets | null = null;
    if (up) {
      try {
        creds = await this.secrets(ws);
      } catch {
        creds = null; // still bootstrapping
      }
    }
    return {
      enabled: true,
      state: up ? (creds ? 'running' : 'starting') : 'starting',
      host,
      url: `${this.scheme()}://${host}`,
      accessKey: creds?.accessKey ?? null,
      secretKey: creds?.secretKey ?? null,
    };
  }

  async enable(ws: string): Promise<TableStoreStatus> {
    await this.compute.ensureNet();
    if (await this.getServiceRaw(this.serviceName(ws))) {
      throw new ComputeError(409, 'table store already enabled');
    }
    const name = this.serviceName(ws);
    const host = this.host(ws);
    await this.docker.createService({
      Name: name,
      Labels: {
        [SM4RT_KIND_LABEL]: 'tablestore',
        [SM4RT_WS_LABEL]: ws,
        [SM4RT_NAME_LABEL]: 'ddb',
        ...this.compute.caddyLabelsFor(host, 8000),
      },
      TaskTemplate: {
        ContainerSpec: {
          Image: 'scylladb/scylla:6.2',
          Args: [
            '--smp', '1',
            '--memory', '750M',
            '--overprovisioned', '1',
            '--alternator-port', '8000',
            '--alternator-write-isolation', 'only_rmw_uses_lwt',
            '--alternator-enforce-authorization', '1',
            '--authenticator', 'PasswordAuthenticator',
          ],
          Labels: { [SM4RT_WS_LABEL]: ws, [SM4RT_KIND_LABEL]: 'tablestore', [SM4RT_NAME_LABEL]: 'ddb' },
          Mounts: [
            {
              Type: 'volume',
              Source: `${name}-data`,
              Target: '/var/lib/scylla',
              VolumeOptions: { Labels: { [SM4RT_WS_LABEL]: ws } },
            } as unknown as Docker.MountSettings,
          ],
        },
        Resources: { Limits: { NanoCPUs: cpusToNano(1), MemoryBytes: mbToBytes(1024) } },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
        // manager node: the salted_hash bootstrap uses exec via the local socket
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
    try {
      await this.docker.getVolume(`${name}-data`).remove();
    } catch {
      // best effort
    }
    if (!svc) throw new ComputeError(404, 'table store not enabled');
  }

  // ————————————————— tables (real DynamoDB protocol) —————————————————

  private async ddb(ws: string, endpoint: string): Promise<DynamoDBClient> {
    const creds = await this.secrets(ws);
    return new DynamoDBClient({
      endpoint,
      region: 'us-east-1',
      credentials: { accessKeyId: creds.accessKey, secretAccessKey: creds.secretKey },
    });
  }

  private async withDdb<T>(ws: string, fn: (client: DynamoDBClient) => Promise<T>): Promise<T> {
    try {
      const inner = await this.ddb(ws, `http://${this.serviceName(ws)}:8000`);
      return await fn(inner);
    } catch (err) {
      if (err instanceof ComputeError) throw err;
      const named = (err as { name?: string }).name ?? '';
      if (named && named !== 'TimeoutError' && !/ENOTFOUND|ECONN|EAI_AGAIN/.test(String(err))) {
        throw err; // a real DynamoDB error from the service — don't retry on the edge
      }
      const outer = await this.ddb(ws, `${this.scheme()}://${this.host(ws)}`);
      try {
        return await fn(outer);
      } catch (err2) {
        throw new ComputeError(502, `table store unreachable: ${(err2 as Error).message}`);
      }
    }
  }

  async listTables(ws: string): Promise<TableInfo[]> {
    return this.withDdb(ws, async (client) => {
      const res = await client.send(new ListTablesCommand({ Limit: 100 }));
      const names = res.TableNames ?? [];
      return Promise.all(
        names.map(async (name) => {
          try {
            const d = await client.send(new DescribeTableCommand({ TableName: name }));
            const attrs = new Map(
              (d.Table?.AttributeDefinitions ?? []).map((a) => [a.AttributeName, a.AttributeType]),
            );
            return {
              name,
              status: d.Table?.TableStatus ?? null,
              keySchema: (d.Table?.KeySchema ?? []).map((k) => ({
                attribute: k.AttributeName ?? '',
                type: attrs.get(k.AttributeName ?? '') ?? '?',
                role: k.KeyType ?? '',
              })),
              itemCount: typeof d.Table?.ItemCount === 'number' ? d.Table.ItemCount : null,
            };
          } catch {
            return { name, status: null, keySchema: [], itemCount: null };
          }
        }),
      );
    });
  }

  async createTable(
    ws: string,
    input: { name: string; hashKey: string; hashType: KeyType; rangeKey?: string; rangeType?: KeyType },
  ): Promise<void> {
    if (!isValidTableName(input.name)) throw new ComputeError(400, 'invalid table name');
    if (!isValidAttrName(input.hashKey)) throw new ComputeError(400, 'invalid partition key');
    if (input.rangeKey && !isValidAttrName(input.rangeKey)) {
      throw new ComputeError(400, 'invalid sort key');
    }
    const attrs: AttributeDefinition[] = [
      { AttributeName: input.hashKey, AttributeType: input.hashType },
    ];
    const keys: KeySchemaElement[] = [{ AttributeName: input.hashKey, KeyType: 'HASH' }];
    if (input.rangeKey) {
      attrs.push({ AttributeName: input.rangeKey, AttributeType: input.rangeType ?? 'S' });
      keys.push({ AttributeName: input.rangeKey, KeyType: 'RANGE' });
    }
    await this.withDdb(ws, async (client) => {
      try {
        await client.send(
          new CreateTableCommand({
            TableName: input.name,
            AttributeDefinitions: attrs,
            KeySchema: keys,
            BillingMode: 'PAY_PER_REQUEST',
          }),
        );
      } catch (err) {
        if ((err as { name?: string }).name === 'ResourceInUseException') {
          throw new ComputeError(409, `table ${input.name} already exists`);
        }
        throw err;
      }
    });
  }

  async deleteTable(ws: string, name: string): Promise<void> {
    if (!isValidTableName(name)) throw new ComputeError(400, 'invalid table name');
    await this.withDdb(ws, async (client) => {
      try {
        await client.send(new DeleteTableCommand({ TableName: name }));
      } catch (err) {
        if ((err as { name?: string }).name === 'ResourceNotFoundException') {
          throw new ComputeError(404, `table ${name} not found`);
        }
        throw err;
      }
    });
  }
}
