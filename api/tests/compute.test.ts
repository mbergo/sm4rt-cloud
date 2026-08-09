import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CACHE_PORT_RANGE,
  DB_PORT_RANGE,
  SSH_PORT_RANGE,
  allocatePort,
  alloyLogsConfig,
  alloyScrapeConfig,
  cdnTlsHelperConf,
  cdnVcl,
  gatewayCaddyfile,
  isValidDnsRecordName,
  isValidGatewayPath,
  isValidImageRef,
  isValidResourceName,
  otelEnvFor,
  parseCdnOrigin,
  randomSecret,
  resolveGatewayUpstream,
  validateGitopsSpec,
  vmBootstrapScript,
} from '../src/compute-templates.ts';

// ————— names / validation —————

test('isValidResourceName accepts kebab names and rejects bad ones', () => {
  assert.equal(isValidResourceName('web'), true);
  assert.equal(isValidResourceName('my-app-2'), true);
  assert.equal(isValidResourceName('a'.repeat(24)), true);
  assert.equal(isValidResourceName('a'.repeat(25)), false);
  assert.equal(isValidResourceName('-bad'), false);
  assert.equal(isValidResourceName('Bad'), false);
  assert.equal(isValidResourceName('has_underscore'), false);
  assert.equal(isValidResourceName(''), false);
});

test('isValidDnsRecordName and isValidImageRef', () => {
  assert.equal(isValidDnsRecordName('www'), true);
  assert.equal(isValidDnsRecordName('api-v2'), true);
  assert.equal(isValidDnsRecordName('UPPER'), false);
  assert.equal(isValidImageRef('nginx:alpine'), true);
  assert.equal(isValidImageRef('ghcr.io/org/app:1.2.3'), true);
  assert.equal(isValidImageRef('bad image'), false);
  assert.equal(isValidImageRef(''), false);
});

// ————— port allocation —————

test('allocatePort picks the first free port and skips used ones', () => {
  const used = new Set([SSH_PORT_RANGE.from, SSH_PORT_RANGE.from + 1]);
  assert.equal(allocatePort(used, SSH_PORT_RANGE), SSH_PORT_RANGE.from + 2);
  assert.equal(allocatePort(new Set(), DB_PORT_RANGE), DB_PORT_RANGE.from);
  assert.equal(allocatePort(new Set(), CACHE_PORT_RANGE), CACHE_PORT_RANGE.from);
});

test('allocatePort returns null when the range is exhausted', () => {
  const all = new Set<number>();
  for (let p = SSH_PORT_RANGE.from; p <= SSH_PORT_RANGE.to; p++) all.add(p);
  assert.equal(allocatePort(all, SSH_PORT_RANGE), null);
});

// ————— VM bootstrap —————

test('vmBootstrapScript installs sshd and creates the user (apt images)', () => {
  const s = vmBootstrapScript('ubuntu-24', 'marcus', 'Secret-Pass1');
  assert.match(s, /apt-get install/);
  assert.match(s, /openssh-server/);
  assert.match(s, /useradd -m -s \/bin\/bash marcus/);
  assert.match(s, /marcus:Secret-Pass1/);
  assert.match(s, /PasswordAuthentication yes/);
  assert.match(s, /NOPASSWD:ALL/);
  assert.match(s, /exec \/usr\/sbin\/sshd -D -e/);
});

test('vmBootstrapScript uses apk and adduser on alpine', () => {
  const s = vmBootstrapScript('alpine-3', 'ops', 'Abcdefgh');
  assert.match(s, /apk add/);
  assert.match(s, /ssh-keygen -A/);
  assert.match(s, /adduser -D -s \/bin\/bash ops/);
  assert.match(s, /exec \/usr\/sbin\/sshd -D -e/);
});

test('vmBootstrapScript rejects dangerous user/password values', () => {
  assert.throws(() => vmBootstrapScript('ubuntu-24', 'bad user', 'Abcdefgh'));
  assert.throws(() => vmBootstrapScript('ubuntu-24', 'ok', "pa'ss"));
  assert.throws(() => vmBootstrapScript('ubuntu-24', 'ok', 'short'));
});

// ————— API gateway Caddyfile —————

test('gatewayCaddyfile orders routes by longest prefix and strips it', () => {
  const cf = gatewayCaddyfile(
    [
      { path: '/api', target: 'svc:backend:8080' },
      { path: '/api/v2', target: 'https://example.com' },
    ],
    () => 'sm4rt-task-demo-web',
    () => 3000,
  );
  const idxV2 = cf.indexOf('/api/v2');
  const idxApi = cf.indexOf('@r1 path /api /api/*');
  assert.ok(idxV2 >= 0 && idxApi >= 0 && idxV2 < idxApi, 'longer prefix must come first');
  assert.match(cf, /uri strip_prefix \/api\/v2/);
  assert.match(cf, /uri strip_prefix \/api\n/);
  assert.match(cf, /reverse_proxy backend:8080/);
  assert.match(cf, /admin off/);
  assert.match(cf, /auto_https off/);
});

test('gatewayCaddyfile normalizes wildcard and trailing-slash paths', () => {
  const cf = gatewayCaddyfile(
    [{ path: '/web/*', target: 'task:web' }],
    (t) => `sm4rt-task-demo-${t}`,
    () => 80,
  );
  assert.match(cf, /@r0 path \/web \/web\/\*/);
  assert.match(cf, /uri strip_prefix \/web\n/);
  assert.ok(!cf.includes('strip_prefix /web/*'), 'wildcard must not leak into strip_prefix');
  assert.throws(() => gatewayCaddyfile([{ path: '/we b', target: 'task:web' }], () => 'x', () => 80));
});

test('gatewayCaddyfile resolves task targets and https upstreams', () => {
  const cf = gatewayCaddyfile(
    [
      { path: '/app', target: 'task:web' },
      { path: '/ext', target: 'https://api.github.com' },
    ],
    (name) => `sm4rt-task-demo-${name}`,
    () => 8080,
  );
  assert.match(cf, /reverse_proxy sm4rt-task-demo-web:8080/);
  assert.match(cf, /reverse_proxy https:\/\/api\.github\.com/);
  assert.match(cf, /header_up Host \{upstream_hostport\}/);
  assert.match(cf, /respond .* 404/);
});

test('gateway path and upstream validation reject bad input', () => {
  assert.equal(isValidGatewayPath('/api'), true);
  assert.equal(isValidGatewayPath('api'), false);
  assert.equal(isValidGatewayPath('/api bad'), false);
  assert.equal(isValidGatewayPath('/a//b'), false);
  assert.throws(() =>
    resolveGatewayUpstream({ path: '/x', target: 'nope:xyz' }, () => 'x', () => 1),
  );
  assert.throws(() =>
    resolveGatewayUpstream({ path: '/x', target: 'task:web' }, () => 'x', () => null),
    /no HTTP port/,
  );
});

// ————— CDN (Varnish) —————

test('parseCdnOrigin handles http, https and host:port', () => {
  assert.deepEqual(parseCdnOrigin('https://example.com'), {
    scheme: 'https',
    host: 'example.com',
    port: 443,
  });
  const httpOrigin = parseCdnOrigin('http://web.internal:8080');
  assert.equal(httpOrigin.host, 'web.internal');
  assert.equal(httpOrigin.port, 8080);
  assert.equal(httpOrigin.scheme, 'http');
  assert.throws(() => parseCdnOrigin('ftp://x'));
});

test('cdnVcl sets backend, ttl and cache headers', () => {
  const vcl = cdnVcl('assets', { host: 'origin-host', port: 8080, hostHeader: 'example.com' }, 120);
  assert.match(vcl, /vcl 4\.1/);
  assert.match(vcl, /\.host = "origin-host"/);
  assert.match(vcl, /\.port = "8080"/);
  assert.match(vcl, /req\.http\.Host = "example\.com"/);
  assert.match(vcl, /beresp\.ttl = 120s/);
  assert.match(vcl, /X-Cache/);
  assert.match(vcl, /X-Sm4rt-CDN/);
});

test('cdnVcl clamps invalid TTLs', () => {
  assert.throws(() => cdnVcl('x', { host: 'h', port: 80, hostHeader: 'h' }, 0));
  assert.throws(() => cdnVcl('x', { host: 'h', port: 80, hostHeader: 'h' }, 99_999_999));
});

test('cdnTlsHelperConf proxies to the https origin with SNI', () => {
  const conf = cdnTlsHelperConf('secure.example.com', 443);
  assert.match(conf, /proxy_pass https:\/\/secure\.example\.com:443/);
  assert.match(conf, /proxy_ssl_server_name on/);
  assert.match(conf, /listen 8080/);
});

// ————— Observability (LGTM + discovery) —————

test('alloyLogsConfig discovers workspace containers and ships to Loki', () => {
  const cfg = alloyLogsConfig('demo', 'sm4rt-obs-demo');
  assert.match(cfg, /discovery\.docker/);
  assert.match(cfg, /sm4rt\.workspace=demo/);
  assert.match(cfg, /loki\.write/);
  assert.match(cfg, /sm4rt-obs-demo:3100\/loki\/api\/v1\/push/);
  assert.match(cfg, /label_com_docker_swarm_service_name/);
});

test('alloyScrapeConfig creates one dns+scrape block per target', () => {
  const cfg = alloyScrapeConfig('demo', 'sm4rt-obs-demo', [
    { taskName: 'web', serviceHost: 'sm4rt-task-demo-web', port: 9100, path: '/metrics' },
    { taskName: 'api', serviceHost: 'sm4rt-task-demo-api', port: 8081, path: '/stats' },
  ]);
  assert.match(cfg, /tasks\.sm4rt-task-demo-web/);
  assert.match(cfg, /tasks\.sm4rt-task-demo-api/);
  assert.match(cfg, /metrics_path = "\/stats"/);
  assert.match(cfg, /9090\/api\/v1\/write/);
  const empty = alloyScrapeConfig('demo', 'sm4rt-obs-demo', []);
  assert.match(empty, /remote_write/);
});

test('otelEnvFor points tasks at the workspace collector', () => {
  const env = otelEnvFor('demo', 'web', 'sm4rt-obs-demo');
  assert.ok(env.some((e) => e === 'OTEL_EXPORTER_OTLP_ENDPOINT=http://sm4rt-obs-demo:4318'));
  assert.ok(env.some((e) => e === 'OTEL_SERVICE_NAME=web'));
  assert.ok(env.some((e) => e.startsWith('OTEL_RESOURCE_ATTRIBUTES=')));
});

// ————— GitOps spec —————

test('validateGitopsSpec accepts a valid deploy spec', () => {
  const spec = validateGitopsSpec({
    tasks: [
      { name: 'web', image: 'nginx:alpine', port: 80, replicas: 2, env: { A: '1' } },
      { name: 'worker', image: 'busybox:1' },
    ],
  });
  assert.equal(spec.tasks.length, 2);
  assert.equal(spec.tasks[0]!.name, 'web');
  assert.equal(spec.tasks[1]!.port, undefined);
});

test('validateGitopsSpec rejects malformed specs', () => {
  assert.throws(() => validateGitopsSpec(null));
  assert.throws(() => validateGitopsSpec({}));
  assert.throws(() => validateGitopsSpec({ tasks: [{ name: 'Bad Name', image: 'x' }] }));
  assert.throws(() => validateGitopsSpec({ tasks: [{ name: 'ok', image: '' }] }));
  assert.throws(() => validateGitopsSpec({ tasks: [{ name: 'ok', image: 'x', replicas: 99 }] }));
  const tooMany = { tasks: Array.from({ length: 21 }, (_, i) => ({ name: `t${i}`, image: 'x:1' })) };
  assert.throws(() => validateGitopsSpec(tooMany));
});

// ————— misc —————

test('randomSecret returns url-safe strings of the requested length', () => {
  const s = randomSecret(32);
  assert.equal(s.length, 32);
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(randomSecret(32), s);
});
