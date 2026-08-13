// floci-exec-agent — tiny per-node exec relay for multi-node swarms.
// The API's `docker exec` only reaches containers on its own node; this agent
// runs as a *global* swarm service (one task per node, same image as the API)
// and executes commands against the local docker.sock on behalf of the API.
// Plain node:http on purpose: no deps beyond dockerode, no Fastify.
import http from 'node:http';
import Docker from 'dockerode';

const TOKEN = process.env.FLOCI_CLOUD_TOKEN ?? '';
const PORT = Number(process.env.PORT ?? 8080);
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Same stateful demuxer as swarm.ts (duplicated so the agent stays standalone):
// docker exec without TTY multiplexes stdout/stderr in 8-byte-header frames.
function createLogDemuxer(): { push: (chunk: Buffer) => string } {
  let buf = Buffer.alloc(0);
  let raw: boolean | null = null;
  return {
    push(chunk: Buffer): string {
      buf = Buffer.concat([buf, chunk]);
      if (raw === null && buf.length > 0) {
        const first = buf[0] ?? 255;
        raw = !(first <= 2 && buf.length >= 8 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0);
      }
      if (raw) {
        const out = buf.toString('utf-8');
        buf = Buffer.alloc(0);
        return out;
      }
      let out = '';
      while (buf.length >= 8) {
        const size = buf.readUInt32BE(4);
        if (buf.length < 8 + size) {
          break;
        }
        out += buf.subarray(8, 8 + size).toString('utf-8');
        buf = buf.subarray(8 + size);
      }
      return out;
    },
  };
}

async function readBody(req: http.IncomingMessage, limit = 64 * 1024): Promise<string> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) {
      throw new Error('body too large');
    }
  }
  return body;
}

async function execLocal(
  containerId: string,
  cmd: string[],
  timeoutMs = 30_000,
): Promise<{ output: string; exitCode: number | null; timedOut: boolean }> {
  const container = docker.getContainer(containerId);
  const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
  const stream = (await exec.start({})) as NodeJS.ReadableStream & { destroy?: () => void };
  const demux = createLogDemuxer();
  let output = '';
  let timedOut = false;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      stream.destroy?.();
      resolve();
    }, timeoutMs);
    stream.on('data', (chunk: Buffer) => {
      output += demux.push(chunk);
      if (output.length > 256 * 1024) {
        clearTimeout(timer);
        stream.destroy?.();
        resolve();
      }
    });
    stream.on('end', () => {
      clearTimeout(timer);
      resolve();
    });
    stream.on('error', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  let exitCode: number | null = null;
  try {
    const inspect = await exec.inspect();
    exitCode = typeof inspect.ExitCode === 'number' ? inspect.ExitCode : null;
  } catch {
    // container may be gone
  }
  return { output, exitCode, timedOut };
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(json);
}

// — eBPF (Grafana Beyla) lifecycle on this node —
const EBPF_CONTAINER = 'sm4rt-ebpf-beyla';
const EBPF_IMAGE = 'grafana/beyla:2.7';

interface EbpfResult {
  node: string;
  state: 'running' | 'absent' | 'starting';
  error?: string;
}

async function manageEbpf(
  action: string,
  opts: { otlpEndpoint: string; network: string; image: string },
): Promise<EbpfResult> {
  const node = process.env.HOSTNAME ?? 'unknown';
  try {
    const existing = docker.getContainer(EBPF_CONTAINER);
    let state: string | null = null;
    try {
      const info = await existing.inspect();
      state = info.State?.Running ? 'running' : 'stopped';
    } catch {
      state = null;
    }
    if (action === 'status') {
      return { node, state: state === 'running' ? 'running' : 'absent' };
    }
    if (action === 'remove') {
      if (state !== null) {
        await existing.remove({ force: true });
      }
      return { node, state: 'absent' };
    }
    if (action !== 'ensure') {
      return { node, state: 'absent', error: `unknown action: ${action}` };
    }
    if (state === 'running') {
      return { node, state: 'running' };
    }
    if (state !== null) {
      await existing.remove({ force: true });
    }
    if (!opts.otlpEndpoint) {
      return { node, state: 'absent', error: 'otlpEndpoint required' };
    }
    await new Promise<void>((resolve, reject) => {
      docker.pull(opts.image, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (err2: Error | null) => (err2 ? reject(err2) : resolve()));
      });
    });
    const container = await docker.createContainer({
      name: EBPF_CONTAINER,
      Image: opts.image,
      Env: [
        'BEYLA_OPEN_PORT=1-65535',
        'BEYLA_METRICS_FEATURES=application,network',
        `OTEL_EXPORTER_OTLP_ENDPOINT=${opts.otlpEndpoint}`,
        'OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf',
        `OTEL_RESOURCE_ATTRIBUTES=node.name=${node}`,
        'BEYLA_BPF_CONTEXT_PROPAGATION=disabled',
      ],
      Labels: { 'sm4rt.kind': 'ebpf-agent' },
      HostConfig: {
        Privileged: true,
        PidMode: 'host',
        RestartPolicy: { Name: 'always' },
        NetworkMode: opts.network,
        Mounts: [
          { Type: 'bind', Source: '/sys/fs/cgroup', Target: '/sys/fs/cgroup', ReadOnly: true },
        ],
      },
    });
    await container.start();
    return { node, state: 'starting' };
  } catch (err) {
    return { node, state: 'absent', error: err instanceof Error ? err.message : String(err) };
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/agent/health') {
      send(res, 200, { ok: true, node: process.env.HOSTNAME ?? 'unknown' });
      return;
    }
    if (!TOKEN || req.headers.authorization !== `Bearer ${TOKEN}`) {
      send(res, 401, { error: 'unauthorized' });
      return;
    }
    if (req.method === 'POST' && req.url === '/agent/exec') {
      const body = await readBody(req);
      let parsed: { containerId?: unknown; cmd?: unknown };
      try {
        parsed = JSON.parse(body);
      } catch {
        send(res, 400, { error: 'invalid JSON' });
        return;
      }
      const containerId = typeof parsed.containerId === 'string' ? parsed.containerId : '';
      const cmd = Array.isArray(parsed.cmd) ? parsed.cmd.map(String) : [];
      if (!containerId || cmd.length === 0) {
        send(res, 400, { error: 'containerId and cmd[] required' });
        return;
      }
      const result = await execLocal(containerId, cmd);
      send(res, 200, result);
      return;
    }
    // — node-level eBPF (Beyla): swarm services can't run privileged/pid=host,
    //   so each agent manages a plain local container on its own node —
    if (req.method === 'POST' && req.url === '/agent/ebpf') {
      const body = await readBody(req);
      let parsed: { action?: unknown; otlpEndpoint?: unknown; network?: unknown; image?: unknown };
      try {
        parsed = JSON.parse(body);
      } catch {
        send(res, 400, { error: 'invalid JSON' });
        return;
      }
      const action = typeof parsed.action === 'string' ? parsed.action : '';
      const result = await manageEbpf(action, {
        otlpEndpoint: typeof parsed.otlpEndpoint === 'string' ? parsed.otlpEndpoint : '',
        network: typeof parsed.network === 'string' ? parsed.network : 'floci-net',
        image: typeof parsed.image === 'string' && parsed.image ? parsed.image : EBPF_IMAGE,
      });
      send(res, result.error ? 502 : 200, result);
      return;
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`floci-exec-agent listening on :${PORT}`);
});
