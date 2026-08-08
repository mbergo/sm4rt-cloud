# Copilot Instructions for Pull Request Review — floci-cloud

floci-cloud provisions real floci (AWS emulator) instances and real Apache-family
services on Kubernetes or Docker Swarm, fronted by per-workspace subdomains. It is a
product meant to be installed on customer machines (Ubuntu VMs, bare metal, or K8s).

## Review priorities (in order)

1. **No mocks, ever.** Every feature must operate against real infrastructure
   (real emulator containers, real Kubernetes/Swarm APIs, real AWS SDK clients).
   Flag any stubbed/faked behavior presented as functional.
2. **Driver neutrality.** Business logic must not assume Kubernetes. Anything the
   server does should go through the driver interface (`k8s.ts` today, `swarm.ts`
   coming) so VMs/bare-metal installs behave identically.
3. **AWS compatibility.** `resources.ts` and `explorer.ts` speak real AWS wire
   protocols via AWS SDK v3. Changes must keep SDK/CLI compatibility (endpoints,
   path-style S3, credentials `test`/`test`, regional defaults).
4. **Installability.** Nothing may break the 30-minute install story: no
   hardcoded Azure/cloud-specific paths in the product path, no required manual
   steps that a wizard/script can't do.
5. **Tenant isolation basics.** Namespace-per-instance (`floci-i-<name>`),
   TTL annotations, and the reaper must keep working.

## What to flag

- `high`: mocked behavior, broken instance lifecycle (create/delete/reap), auth
  bypass on `/api/*` when TOKEN/Clerk configured, AWS protocol drift, resource
  leaks (namespaces/services left behind), breaking the public HTTP API shape.
- `medium`: Kubernetes-specific logic outside the driver, missing test coverage
  for lifecycle/gateway changes, catalog entries without real probes/ports,
  Azure coupling in the product path.
- `low`: naming, docs, minor conventions.

## Testing expectations

- `api/tests/resources.test.ts` runs against a **real** emulator container —
  extend it when touching `resources.ts`/`explorer.ts`.
- `api/tests/e2e-kind.test.ts` provisions a **real** instance in kind — extend it
  when touching `k8s.ts`/`server.ts` lifecycle behavior.
- New drivers (swarm) must gain an equivalent e2e job.
- No mocked SDK clients in tests; use the emulator.

## Conventions

- Node 24, native TypeScript execution (no build step for the API).
- `node --test` only; no new test frameworks.
- Fastify routes stay thin; provisioning logic lives in the driver.
- Catalog services (`services.ts`) must define real images, probes, and ports —
  verified boot, not aspirational entries.
