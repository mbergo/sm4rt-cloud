// Caddy integration — the edge proxy for swarm/VM installs.
// One wildcard DNS record (*.domain -> main machine) is all the operator
// configures. Caddy issues per-subdomain certificates on the first request
// (on-demand TLS, gated by our /api/public/tls-ask endpoint) and routes:
//   console host          -> floci-cloud API/UI
//   <name>.domain         -> floci-i-<name>:4566          (emulator)
//   <name>-<svc>.domain   -> svc-<svc>-<name>:<http port>  (catalog UIs)
// Routes use host regexp captures, so no per-instance route registration is
// ever needed — the whole config is stateless and pushed once at boot.
import { SERVICE_CATALOG, type RealServiceId } from './services.ts';

export interface CaddyOptions {
  instanceDomain: string;
  consoleHost: string;
  /** upstream address of the floci-cloud API itself, e.g. floci-cloud:8080 */
  selfUpstream: string;
  /** email for Let's Encrypt registration */
  acmeEmail?: string;
  /** use Let's Encrypt staging (for tests) */
  acmeStaging?: boolean;
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function proxyRoute(match: object, dial: string): object {
  return {
    match: [match],
    handle: [
      {
        handler: 'reverse_proxy',
        upstreams: [{ dial }],
      },
    ],
    terminal: true,
  };
}

export function buildCaddyConfig(opts: CaddyOptions): object {
  const domain = escapeRe(opts.instanceDomain);
  const routes: object[] = [];

  // console (UI + API)
  routes.push(proxyRoute({ host: [opts.consoleHost] }, opts.selfUpstream));

  // catalog services with an HTTP UI: <name>-<svc>.domain
  for (const [id, spec] of Object.entries(SERVICE_CATALOG)) {
    if (!spec.httpIngressPort) {
      continue;
    }
    const svc = id as RealServiceId;
    routes.push(
      proxyRoute(
        {
          header_regexp: {
            Host: {
              name: `svc_${svc}`,
              pattern: `^([a-z0-9-]+)-${escapeRe(svc)}\\.${domain}$`,
            },
          },
        },
        `svc-${svc}-{http.regexp.svc_${svc}.1}:${spec.httpIngressPort}`,
      ),
    );
  }

  // emulator instances: <name>.domain (catch-all, last)
  routes.push(
    proxyRoute(
      {
        header_regexp: {
          Host: { name: 'inst', pattern: `^([a-z0-9-]+)\\.${domain}$` },
        },
      },
      'floci-i-{http.regexp.inst.1}:4566',
    ),
  );

  const issuer: Record<string, unknown> = { module: 'acme' };
  if (opts.acmeEmail) {
    issuer.email = opts.acmeEmail;
  }
  if (opts.acmeStaging) {
    issuer.ca = 'https://acme-staging-v02.api.letsencrypt.org/directory';
  }

  return {
    admin: { listen: '0.0.0.0:2019' },
    apps: {
      http: {
        servers: {
          srv0: {
            listen: [':443'],
            routes,
          },
        },
      },
      tls: {
        automation: {
          on_demand: {
            permission: {
              module: 'http',
              endpoint: `http://${opts.selfUpstream}/api/public/tls-ask`,
            },
          },
          policies: [
            {
              on_demand: true,
              issuers: [issuer],
            },
          ],
        },
      },
    },
  };
}

/**
 * Push the full config to Caddy's admin API, retrying while Caddy boots.
 * Idempotent: /load replaces the running config atomically.
 */
export async function pushCaddyConfig(
  adminUrl: string,
  config: object,
  log: { info: (o: object, msg: string) => void; warn: (o: object, msg: string) => void },
  attempts = 30,
): Promise<boolean> {
  const url = `${adminUrl.replace(/\/$/, '')}/load`;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        log.info({ url, attempt }, 'caddy config loaded');
        return true;
      }
      const body = await res.text();
      log.warn({ url, status: res.status, body: body.slice(0, 300) }, 'caddy rejected config');
      return false;
    } catch (err) {
      if (attempt === attempts) {
        log.warn({ url, err: String(err) }, 'caddy admin API unreachable, giving up');
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  return false;
}

/** service ids that have an external HTTP UI, longest first for suffix parsing */
const HTTP_SERVICE_IDS = Object.entries(SERVICE_CATALOG)
  .filter(([, spec]) => spec.httpIngressPort)
  .map(([id]) => id)
  .sort((a, b) => b.length - a.length);

export interface TlsAskDecision {
  allowed: boolean;
  instance: string | null;
}

/**
 * Decide whether Caddy may issue a certificate for `domain`.
 * Returns the instance name whose existence must be verified, or
 * allowed=true outright for the console host.
 */
export function parseTlsAsk(
  domain: string,
  instanceDomain: string,
  consoleHost: string,
): TlsAskDecision {
  const lower = domain.toLowerCase();
  if (lower === consoleHost.toLowerCase()) {
    return { allowed: true, instance: null };
  }
  const suffix = `.${instanceDomain.toLowerCase()}`;
  if (!lower.endsWith(suffix)) {
    return { allowed: false, instance: null };
  }
  const sub = lower.slice(0, -suffix.length);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(sub)) {
    return { allowed: false, instance: null };
  }
  for (const svc of HTTP_SERVICE_IDS) {
    if (sub.endsWith(`-${svc}`)) {
      return { allowed: false, instance: sub.slice(0, -(svc.length + 1)) };
    }
  }
  return { allowed: false, instance: sub };
}
