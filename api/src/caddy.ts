// On-demand TLS gating for the edge proxy (caddy-docker-proxy).
// Routing is fully declarative: every swarm service carries caddy.* labels
// (see swarm.ts and install/install.sh) and the proxy rebuilds its Caddyfile
// from them — no admin-API pushes, no config to lose on restart. The one
// dynamic decision left is certificate issuance: Caddy calls our
// /api/public/tls-ask endpoint before issuing, and parseTlsAsk decides
// which hostnames are legitimate:
//   console host          -> allowed outright
//   <name>.domain         -> allowed if the instance exists
//   <name>-<svc>.domain   -> allowed if the instance exists (catalog UIs)
import { SERVICE_CATALOG } from './services.ts';

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
  // Multi-label subs (e.g. app.demo.<domain>) belong to sm4rt compute: every
  // label must be a valid DNS label and the instance is the last one.
  if (sub.includes('.')) {
    const labels = sub.split('.');
    if (labels.length > 4 || labels.some((l) => !/^[a-z0-9][a-z0-9-]*$/.test(l) || l.length > 63)) {
      return { allowed: false, instance: null };
    }
    return { allowed: false, instance: labels[labels.length - 1]! };
  }
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
