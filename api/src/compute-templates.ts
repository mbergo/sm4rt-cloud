// Pure template/config builders for the sm4rt compute layer.
// No docker calls here — everything is deterministic and unit-testable.

export const SM4RT_KIND_LABEL = 'sm4rt.kind';
export const SM4RT_WS_LABEL = 'sm4rt.workspace';
export const SM4RT_NAME_LABEL = 'sm4rt.name';
export const SM4RT_META_LABEL = 'sm4rt.meta';
export const SM4RT_GITOPS_REV_LABEL = 'sm4rt.gitops.rev';
export const SM4RT_GITOPS_APP_LABEL = 'sm4rt.gitops.app';

export const SSH_PORT_RANGE = { from: 22000, to: 22999 };
export const DB_PORT_RANGE = { from: 15000, to: 15999 };
export const CACHE_PORT_RANGE = { from: 16000, to: 16999 };

export type VmImageId = 'ubuntu-24' | 'debian-12' | 'alpine-3';
export type VmPlanId = 'nano' | 'small' | 'medium' | 'large';
export type DbEngineId = 'postgres-16' | 'mysql-8' | 'mariadb-11';
export type CacheEngineId = 'redis-7' | 'valkey-8';

export const VM_IMAGES: Record<VmImageId, { image: string; label: string; shell: string }> = {
  'ubuntu-24': { image: 'ubuntu:24.04', label: 'Ubuntu 24.04 LTS', shell: '/bin/bash' },
  'debian-12': { image: 'debian:12', label: 'Debian 12 (bookworm)', shell: '/bin/bash' },
  'alpine-3': { image: 'alpine:3.20', label: 'Alpine 3.20', shell: '/bin/sh' },
};

export const VM_PLANS: Record<VmPlanId, { label: string; cpus: number; memoryMb: number }> = {
  nano: { label: '0.5 vCPU · 512 MB', cpus: 0.5, memoryMb: 512 },
  small: { label: '1 vCPU · 1 GB', cpus: 1, memoryMb: 1024 },
  medium: { label: '2 vCPU · 2 GB', cpus: 2, memoryMb: 2048 },
  large: { label: '4 vCPU · 4 GB', cpus: 4, memoryMb: 4096 },
};

// Sizing plans for managed services (databases, caches, container tasks).
export type ServicePlanId = 'micro' | 'small' | 'medium' | 'large';

export const DB_PLANS: Record<ServicePlanId, { label: string; cpus: number; memoryMb: number }> = {
  micro: { label: '0.5 vCPU · 512 MB', cpus: 0.5, memoryMb: 512 },
  small: { label: '1 vCPU · 1 GB', cpus: 1, memoryMb: 1024 },
  medium: { label: '2 vCPU · 2 GB', cpus: 2, memoryMb: 2048 },
  large: { label: '4 vCPU · 4 GB', cpus: 4, memoryMb: 4096 },
};

export const CACHE_PLANS: Record<ServicePlanId, { label: string; cpus: number; memoryMb: number }> =
  {
    micro: { label: '0.25 vCPU · 256 MB', cpus: 0.25, memoryMb: 256 },
    small: { label: '0.5 vCPU · 512 MB', cpus: 0.5, memoryMb: 512 },
    medium: { label: '1 vCPU · 1 GB', cpus: 1, memoryMb: 1024 },
    large: { label: '2 vCPU · 2 GB', cpus: 2, memoryMb: 2048 },
  };

export const TASK_PLANS: Record<ServicePlanId, { label: string; cpus: number; memoryMb: number }> =
  {
    micro: { label: '0.25 vCPU · 256 MB', cpus: 0.25, memoryMb: 256 },
    small: { label: '0.5 vCPU · 512 MB', cpus: 0.5, memoryMb: 512 },
    medium: { label: '1 vCPU · 1 GB', cpus: 1, memoryMb: 1024 },
    large: { label: '2 vCPU · 2 GB', cpus: 2, memoryMb: 2048 },
  };

export const DB_ENGINES: Record<
  DbEngineId,
  { image: string; label: string; port: number; dataDir: string; user: string; database: string }
> = {
  'postgres-16': {
    image: 'postgres:16-alpine',
    label: 'PostgreSQL 16',
    port: 5432,
    dataDir: '/var/lib/postgresql/data',
    user: 'sm4rt',
    database: 'app',
  },
  'mysql-8': {
    image: 'mysql:8',
    label: 'MySQL 8',
    port: 3306,
    dataDir: '/var/lib/mysql',
    user: 'sm4rt',
    database: 'app',
  },
  'mariadb-11': {
    image: 'mariadb:11',
    label: 'MariaDB 11',
    port: 3306,
    dataDir: '/var/lib/mysql',
    user: 'sm4rt',
    database: 'app',
  },
};

export const CACHE_ENGINES: Record<CacheEngineId, { image: string; label: string; port: number }> =
  {
    'redis-7': { image: 'redis:7-alpine', label: 'Redis 7', port: 6379 },
    'valkey-8': { image: 'valkey/valkey:8-alpine', label: 'Valkey 8', port: 6379 },
  };

export function isVmImageId(v: string): v is VmImageId {
  return v in VM_IMAGES;
}
export function isVmPlanId(v: string): v is VmPlanId {
  return v in VM_PLANS;
}
export function isServicePlanId(v: string): v is ServicePlanId {
  return v in DB_PLANS;
}
export function isDbEngineId(v: string): v is DbEngineId {
  return v in DB_ENGINES;
}
export function isCacheEngineId(v: string): v is CacheEngineId {
  return v in CACHE_ENGINES;
}

/** short resource names: start alnum, then alnum/dash, max 24 chars */
export function isValidResourceName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,23}$/.test(name);
}

export function isValidDnsRecordName(record: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(record);
}

export function isValidImageRef(image: string): boolean {
  if (image.length > 256 || /\s/.test(image)) return false;
  return /^[a-z0-9][a-z0-9._\-/:@]*$/i.test(image);
}

// — VM bootstrap —
// The VM is a swarm service running a real distro with sshd in the foreground.
// Password auth is intentional: users get user+password just like a fresh VPS.
export function vmBootstrapScript(imageId: VmImageId, user: string, password: string): string {
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(user)) throw new Error(`invalid vm user: ${user}`);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(password)) throw new Error('invalid vm password');
  if (imageId === 'alpine-3') {
    return [
      'set -e',
      'apk add --no-cache openssh sudo bash curl ca-certificates htop',
      'ssh-keygen -A',
      `adduser -D -s /bin/bash ${user}`,
      `echo '${user}:${password}' | chpasswd`,
      `mkdir -p /etc/sudoers.d && echo '${user} ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-${user}`,
      `sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config`,
      'exec /usr/sbin/sshd -D -e',
    ].join('\n');
  }
  return [
    'set -e',
    'export DEBIAN_FRONTEND=noninteractive',
    'apt-get update -q',
    'apt-get install -y -q --no-install-recommends openssh-server sudo curl ca-certificates iproute2 htop vim-tiny',
    'mkdir -p /run/sshd',
    `id -u ${user} >/dev/null 2>&1 || useradd -m -s /bin/bash ${user}`,
    `echo '${user}:${password}' | chpasswd`,
    `usermod -aG sudo ${user}`,
    `echo '${user} ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-${user}`,
    `sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config`,
    'exec /usr/sbin/sshd -D -e',
  ].join('\n');
}

/** Pick a free port in [from,to] given the set of already-published ports. */
export function allocatePort(
  used: Set<number>,
  range: { from: number; to: number },
): number | null {
  for (let p = range.from; p <= range.to; p++) {
    if (!used.has(p)) return p;
  }
  return null;
}

// — API Gateway —
export interface GatewayRoute {
  path: string;
  /** upstream: "task:<name>" (workspace task), "svc:<host>:<port>" or full http(s) URL */
  target: string;
}

export function isValidGatewayPath(p: string): boolean {
  return /^\/[a-zA-Z0-9._~\-/]*$/.test(p) && !p.includes('//');
}

export function resolveGatewayUpstream(
  route: GatewayRoute,
  taskHostFor: (task: string) => string,
  taskPortFor: (task: string) => number | null,
): string {
  const t = route.target.trim();
  if (t.startsWith('task:')) {
    const name = t.slice(5);
    const port = taskPortFor(name);
    if (!port) throw new Error(`task "${name}" has no HTTP port`);
    return `${taskHostFor(name)}:${port}`;
  }
  if (t.startsWith('svc:')) {
    const rest = t.slice(4);
    if (!/^[a-z0-9.-]+:\d{2,5}$/i.test(rest)) throw new Error(`invalid svc target: ${t}`);
    return rest;
  }
  if (/^https?:\/\/[a-z0-9.-]+(:\d{2,5})?$/i.test(t)) {
    return t;
  }
  throw new Error(`invalid route target: ${t}`);
}

/** Caddyfile for a dedicated per-API gateway (mounted via docker config). */
export function gatewayCaddyfile(
  routes: GatewayRoute[],
  taskHostFor: (task: string) => string,
  taskPortFor: (task: string) => number | null,
): string {
  const sorted = [...routes].sort((a, b) => b.path.length - a.path.length);
  const blocks = sorted.map((r, i) => {
    const upstream = resolveGatewayUpstream(r, taskHostFor, taskPortFor);
    // normalize "/web", "/web/", "/web/*" and "/web*" all to prefix "/web"
    const prefix = r.path.replace(/\/?\*+$/, '').replace(/\/+$/, '');
    if (prefix !== '' && !/^\/[A-Za-z0-9_./-]*$/.test(prefix)) {
      throw new Error(`invalid route path: ${r.path}`);
    }
    const upstreamDirective = upstream.startsWith('https://')
      ? `reverse_proxy ${upstream} {\n      header_up Host {upstream_hostport}\n    }`
      : `reverse_proxy ${upstream.replace(/^http:\/\//, '')}`;
    if (prefix === '') {
      return `  handle {\n    ${upstreamDirective}\n  }`;
    }
    return [
      `  @r${i} path ${prefix} ${prefix}/*`,
      `  handle @r${i} {`,
      `    uri strip_prefix ${prefix}`,
      `    ${upstreamDirective}`,
      `  }`,
    ].join('\n');
  });
  return [
    '{',
    '  admin off',
    '  auto_https off',
    '}',
    ':8080 {',
    ...blocks,
    '  handle {',
    '    header Content-Type application/json',
    '    respond `{"message":"no route matched","gateway":"sm4rt"}` 404',
    '  }',
    '}',
    '',
  ].join('\n');
}

// — CDN (Varnish) —
export interface CdnOrigin {
  /** backend host varnish talks to (helper host for https origins) */
  host: string;
  port: number;
  /** Host header to send upstream */
  hostHeader: string;
}

export function parseCdnOrigin(origin: string): {
  scheme: 'http' | 'https';
  host: string;
  port: number;
} {
  const m = /^(https?):\/\/([a-z0-9.-]+)(?::(\d{2,5}))?\/?$/i.exec(origin.trim());
  if (!m) throw new Error(`invalid origin URL: ${origin}`);
  const scheme = m[1]!.toLowerCase() as 'http' | 'https';
  return { scheme, host: m[2]!.toLowerCase(), port: m[3] ? Number(m[3]) : scheme === 'https' ? 443 : 80 };
}

export function cdnVcl(name: string, origin: CdnOrigin, ttlSeconds: number): string {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86400 * 30) {
    throw new Error('ttlSeconds must be between 1 and 2592000');
  }
  return `vcl 4.1;

backend origin {
  .host = "${origin.host}";
  .port = "${origin.port}";
  .connect_timeout = 5s;
  .first_byte_timeout = 30s;
}

sub vcl_recv {
  set req.http.Host = "${origin.hostHeader}";
  unset req.http.Cookie;
  if (req.method != "GET" && req.method != "HEAD") {
    return (pass);
  }
}

sub vcl_backend_response {
  # Force-cache with the distribution TTL even when the origin sends
  # no-cache / no-store (builtin VCL would mark those uncacheable).
  set beresp.ttl = ${Math.floor(ttlSeconds)}s;
  unset beresp.http.Set-Cookie;
  unset beresp.http.Cache-Control;
  unset beresp.http.Expires;
  if (beresp.status < 400) {
    set beresp.uncacheable = false;
    return (deliver);
  }
}

sub vcl_deliver {
  if (obj.hits > 0) {
    set resp.http.X-Cache = "HIT";
    set resp.http.X-Cache-Hits = obj.hits;
  } else {
    set resp.http.X-Cache = "MISS";
  }
  set resp.http.X-Sm4rt-CDN = "${name}";
}
`;
}

/** nginx config for the TLS helper (Varnish OSS cannot talk TLS to origins). */
export function cdnTlsHelperConf(originHost: string, originPort: number): string {
  return `events {}
http {
  server {
    listen 8080;
    location / {
      proxy_pass https://${originHost}:${originPort};
      proxy_set_header Host ${originHost};
      proxy_ssl_server_name on;
      proxy_ssl_name ${originHost};
      proxy_set_header X-Forwarded-For $remote_addr;
    }
  }
}
`;
}

// — Observability: Grafana Alloy configs —
// Global log agent: one per node, discovers every workspace container via the
// sm4rt.workspace container label and ships logs to the workspace Loki.
export function alloyLogsConfig(workspace: string, lokiHost: string): string {
  return `discovery.docker "ws" {
  host = "unix:///var/run/docker.sock"
  filter {
    name   = "label"
    values = ["${SM4RT_WS_LABEL}=${workspace}"]
  }
}

discovery.relabel "ws" {
  targets = discovery.docker.ws.targets
  rule {
    source_labels = ["__meta_docker_container_label_com_docker_swarm_service_name"]
    target_label  = "service"
  }
  rule {
    source_labels = ["__meta_docker_container_label_sm4rt_kind"]
    target_label  = "kind"
  }
  rule {
    source_labels = ["__meta_docker_container_label_sm4rt_name"]
    target_label  = "app"
  }
  rule {
    target_label = "workspace"
    replacement  = "${workspace}"
  }
}

loki.source.docker "ws" {
  host          = "unix:///var/run/docker.sock"
  targets       = discovery.relabel.ws.output
  forward_to    = [loki.write.obs.receiver]
  refresh_interval = "10s"
}

loki.write "obs" {
  endpoint {
    url = "http://${lokiHost}:3100/loki/api/v1/push"
  }
}
`;
}

export interface ScrapeTarget {
  taskName: string;
  serviceHost: string;
  port: number;
  path: string;
}

// Single-replica scraper: resolves tasks.<svc> via swarm DNS so every replica
// of a task is scraped individually — no duplicate series from global agents.
export function alloyScrapeConfig(
  workspace: string,
  promHost: string,
  targets: ScrapeTarget[],
): string {
  const blocks = targets.map((t, i) => {
    const id = `t${i}_${t.taskName.replace(/[^a-z0-9_]/gi, '_')}`;
    return `discovery.dns "${id}" {
  names = ["tasks.${t.serviceHost}"]
  type  = "A"
  port  = ${t.port}
}

prometheus.scrape "${id}" {
  targets      = discovery.dns.${id}.targets
  metrics_path = "${t.path}"
  job_name     = "${t.taskName}"
  forward_to   = [prometheus.remote_write.obs.receiver]
}`;
  });
  return `${blocks.join('\n\n')}${blocks.length ? '\n\n' : ''}prometheus.remote_write "obs" {
  endpoint {
    url = "http://${promHost}:9090/api/v1/write"
  }
}
`;
}

/** OTEL env auto-injected into ECS-style tasks when the obs stack is running. */
export function otelEnvFor(workspace: string, taskName: string, obsHost: string): string[] {
  return [
    `OTEL_EXPORTER_OTLP_ENDPOINT=http://${obsHost}:4318`,
    'OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf',
    `OTEL_SERVICE_NAME=${taskName}`,
    `OTEL_RESOURCE_ATTRIBUTES=sm4rt.workspace=${workspace}`,
  ];
}

// — GitOps —
export interface GitopsTaskSpec {
  name: string;
  image: string;
  port?: number;
  replicas?: number;
  env?: Record<string, string>;
}

export interface GitopsDeploySpec {
  tasks: GitopsTaskSpec[];
}

/** Parse and validate the deploy/sm4rt.yaml document (already YAML-parsed). */
export function validateGitopsSpec(doc: unknown): GitopsDeploySpec {
  if (!doc || typeof doc !== 'object') throw new Error('sm4rt.yaml: not a mapping');
  const tasks = (doc as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('sm4rt.yaml: "tasks" must be a non-empty list');
  }
  if (tasks.length > 20) throw new Error('sm4rt.yaml: too many tasks (max 20)');
  const out: GitopsTaskSpec[] = [];
  for (const t of tasks) {
    if (!t || typeof t !== 'object') throw new Error('sm4rt.yaml: task must be a mapping');
    const { name, image, port, replicas, env } = t as Record<string, unknown>;
    if (typeof name !== 'string' || !isValidResourceName(name)) {
      throw new Error(`sm4rt.yaml: invalid task name "${String(name)}"`);
    }
    if (typeof image !== 'string' || !isValidImageRef(image)) {
      throw new Error(`sm4rt.yaml: invalid image for task "${name}"`);
    }
    const spec: GitopsTaskSpec = { name, image };
    if (port !== undefined) {
      const p = Number(port);
      if (!Number.isInteger(p) || p < 1 || p > 65535) {
        throw new Error(`sm4rt.yaml: invalid port for task "${name}"`);
      }
      spec.port = p;
    }
    if (replicas !== undefined) {
      const r = Number(replicas);
      if (!Number.isInteger(r) || r < 0 || r > 10) {
        throw new Error(`sm4rt.yaml: invalid replicas for task "${name}"`);
      }
      spec.replicas = r;
    }
    if (env !== undefined) {
      if (!env || typeof env !== 'object' || Array.isArray(env)) {
        throw new Error(`sm4rt.yaml: env for task "${name}" must be a mapping`);
      }
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
          throw new Error(`sm4rt.yaml: invalid env name "${k}" in task "${name}"`);
        }
        clean[k] = String(v);
      }
      spec.env = clean;
    }
    out.push(spec);
  }
  return { tasks: out };
}

export function randomSecret(len = 24): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const buf = globalThis.crypto.getRandomValues(new Uint8Array(len));
  for (const b of buf) out += chars[b % chars.length];
  return out;
}
