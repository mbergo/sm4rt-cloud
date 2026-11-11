# SM4RT-CLOUD

Self-hosted, multi-tenant control plane that turns a set of Linux boxes into a
personal cloud with an AWS-compatible API and a catalog of real Apache-family
services. "Coolify × Vercel, but the thing being served is cloud capacity."

Lives at `~/github/sm4rt-cloud` (renamed from `floci-cloud` on 2026-08-16 to
match the repo). `origin` is `https://github.com/mbergo/sm4rt-cloud.git`,
default branch `main`. **Package names inside still say `floci-cloud-api` /
`floci-cloud-ui`**, and the Helm chart is still `charts/floci-cloud/` — the
rename hasn't propagated into the code yet.

## Core model

- **Workspace** = a real [floci](https://github.com/mbergo/floci) engine with its
  own public endpoint. AWS CLI / SDKs / Terraform point straight at it.
- **Capacity** = machines added to the cluster. Not pets. Tenants create
  workspaces; workspaces consume from the pool. Add a machine, pool grows.
- **Edge** = Caddy or Envoy Gateway. One wildcard DNS record
  (`*.your-domain → main machine IP`) is the entire DNS config. TLS is issued
  on demand via Let's Encrypt.
- **Driver** = `swarm` or `kubernetes` (see `DRIVER.md`).

## Layout

| Path | What |
|---|---|
| `api/` | Node **>= 24**. Control plane. Heavy `@aws-sdk/client-*` surface (dynamodb, ec2, ecs, iam, glue, athena, …). Scripts: `dev`, `start`, `test`, `test:e2e` |
| `ui/` | React + `@clerk/react` for auth, `lucide-react` icons. Scripts: `dev`, `build` |
| `cli/` | `sm4rt` CLI + `install-cli.sh` |
| `install/` | `install.sh` (main machine wizard), `add-node.sh` (extra machines), `install-k8s.sh` |
| `charts/floci-cloud/` | Helm chart |
| `deploy/` | `floci-cloud.yaml`, `envoy-gateway.yaml` |
| `e2e/selenium/` | End-to-end tests |
| `.claude/skills/`, `.agents/skills/` | Skills, pinned by `skills-lock.json` — see below |

### Bundled Clerk skills

Auth is **Clerk** (`ui/` uses `@clerk/react` + `@clerk/themes`), and the repo
ships ~20 project-scoped Clerk skills in `.claude/skills/`. Use them instead of
guessing at Clerk APIs — they are the current upstream docs, not training data.

- `clerk` — router; routes to the right one for the task
- `clerk-setup`, `clerk-cli`, `clerk-backend-api` — install, CLI ops, REST API
- `clerk-react-patterns` — the relevant frontend one here (Vite/React SPA:
  `ClerkProvider`, `useAuth`/`useUser`, protected routes)
- `clerk-orgs` — **matters for this project**: B2B multi-tenancy, org switching,
  RBAC, verified domains. Maps directly onto the workspace/tenant model
- `clerk-billing` — plans, seat limits, `has()` entitlements, billing webhooks
- `clerk-webhooks`, `clerk-testing`, `clerk-custom-ui`
- Framework variants present but not used here: nextjs, nuxt, astro, vue,
  tanstack, react-router, expo, swift, android, chrome-extension

When files under `github/sm4rt-cloud/` are in play, the **project-scoped**
variant wins over the identically-named global skill.

## Commands

Everything goes through the `Makefile`:

```
make help      install    dev-api    dev-ui     build
make image     push       secrets    deploy     rollout
make url       token      logs       destroy
```

Read `INSTALL.md` before touching install flow; it documents the supported
paths (Swarm on VMs/bare metal, or Kubernetes) and the port requirements
(`80/443` public; `2377/tcp`, `7946/tcp+udp`, `4789/udp` between nodes).

## Conventions

`.github/copilot-instructions.md` is the authoritative engineering contract for
this repo. The rules that bite hardest:

- **No mocks, ever.** Every feature runs against real infrastructure — real
  emulator containers, real Kubernetes/Swarm APIs, real AWS SDK v3 clients.
  Stubbed behavior presented as working is the top review failure.
- **Driver neutrality.** Business logic must not assume Kubernetes. Everything
  goes through the driver interface (`k8s.ts` today, `swarm.ts` coming) so
  bare-metal installs behave identically. See `DRIVER.md`.
- **AWS wire compatibility.** `resources.ts` / `explorer.ts` speak real AWS
  protocols. Don't drift endpoints, path-style S3, or regional defaults.
- **Installability.** Nothing may break the 30-minute install story — no
  hardcoded cloud-specific paths, no manual steps a wizard can't perform.
- **Tenant isolation.** Namespace-per-instance (`floci-i-<name>`), TTL
  annotations and the reaper must keep working.
- Node 24 with **native TypeScript execution — no build step for the API**.
  Tests are `node --test` only; do not introduce another test framework.
  Fastify routes stay thin; provisioning lives in the driver.
- Tests hit real things: `api/tests/resources.test.ts` uses a real emulator
  container, `api/tests/e2e-kind.test.ts` provisions a real instance in kind.

Plus the global rules:

- **No AI attribution anywhere** — commits, PR bodies, comments, docs. Enforced
  without exception.
- **Every change needs a rollback path**, logged to `~/.rollback-log`.
- Commit style follows the existing history: `feat(scope): …`, `fix(scope): …`.

## Working agreement

- **Work autonomously.** No need to ask before each step; carry a task through
  to an open PR. Never merge — Marcus merges.
- **Small PRs, steady cadence.** Split at natural break points, not one change
  per PR.
- **Every mistake becomes a CI test.** When a bug slips through, the fix PR adds
  a test that runs in GitHub Actions so it cannot regress.
- **English** for commits, PR titles and bodies.
