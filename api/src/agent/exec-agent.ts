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
    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`floci-exec-agent listening on :${PORT}`);
});
