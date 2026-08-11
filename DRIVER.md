# DRIVER.md — Contract for a sm4rt-cloud provisioning backend

This document specifies **exactly** what a new orchestration backend (e.g. a
Rust runtime in the spirit of Kubernetes, but simpler) must implement to sit
underneath sm4rt-cloud. The API server (`api/src/server.ts`) talks only to the
`CloudDriver` interface plus a small set of container primitives used by the
compute managers — implement these and every panel in the console works
unchanged.

Reference implementations:
- `api/src/swarm.ts` — Docker Swarm (production today)
- `api/src/k8s.ts` — Kubernetes

---

## 1. Mental model

```
┌────────────────────────── console (React) ──────────────────────────┐
└──────────────────────────────┬──────────────────────────────────────┘
                               │ REST /api/*
┌──────────────────────────────▼──────────────────────────────────────┐
│ api (Fastify, Node)                                                 │
│  ├── CloudDriver          ← instance lifecycle (workspaces)         │
│  └── Compute managers     ← real services (DBs, S3, DDB, MQ, …)     │
│        (talk to the container runtime through 6 primitives)         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  YOUR RUST RUNTIME  │   ← replaces Docker Swarm
                    └─────────────────────┘
```

Two integration surfaces:

1. **`CloudDriver`** (`api/src/driver.ts`) — workspace ("instance")
   lifecycle. One implementation per backend.
2. **Container primitives** — the compute managers (`compute.ts`,
   `registry.ts`, `objectstore.ts`, `tablestore.ts`, `broker.ts`, `devops.ts`)
   call dockerode directly today. To swap the runtime, expose the same six
   primitives (§4) — either speak the Docker Engine API (drop-in, zero code
   changes) or provide an adapter object with the same call shapes.

**Recommended path:** implement the subset of the Docker Engine REST API in
§4 in your Rust runtime. Then *both* surfaces work without touching the Node
code — `DOCKER_HOST=tcp://your-runtime:2375` is the only change.

---

## 2. CloudDriver interface (workspace lifecycle)

From `api/src/driver.ts`:

```ts
interface CloudDriver {
  kind: 'kubernetes' | 'swarm';        // add your own, e.g. 'rustd'

  // lifecycle
  list(): Promise<InstanceInfo[]>;
  get(name): Promise<InstanceInfo | null>;
  create(name, ttlHours): Promise<InstanceInfo>;   // must throw ConflictError on duplicates
  delete(name): Promise<boolean>;
  logs(name, tailLines): Promise<string>;
  reapExpired(): Promise<string[]>;                // TTL garbage collection

  // addressing
  hostFor(name): string;               // e.g. `${name}.pajesystems.io`
  scheme(): string;                    // 'https' when TLS
  awsEndpointFor(name): string;        // internal URL the API uses to reach the instance

  // catalog services (per-workspace service catalog)
  listServices(name): Promise<RealServiceInfo[]>;
  getService(name, service): Promise<RealServiceInfo>;
  serviceLogs(name, service, tail): Promise<string>;
  startService(name, service, instanceName?): Promise<void>;
  stopService(name, service, instanceName?): Promise<void>;

  // post-provision panel (optional but expected for full console UX)
  streamServiceLogs?(name, target, tail): Promise<{ stream; close }>;
  execInService?(name, target, cmd[], timeoutMs?): Promise<{ output; exitCode; timedOut }>;
  getServiceConfig?(name, target): Promise<ServiceConfigInfo>;
  updateServiceEnv?(name, target, env[]): Promise<void>;
  listServiceTargets?(name): Promise<ServiceTargetInfo[]>;

  // observability
  instanceMetrics(name): Promise<InstanceMetrics>;
  nodes(): Promise<NodeInfo[]>;        // cluster capacity for the admin/user dashboards
  joinCommand(): Promise<string | null>; // shell one-liner to add a node, or null

  // agents (one-shot job containers)
  runOtelAgent(name, options): Promise<OtelAgentRun>;
  listOtelAgentRuns(name): Promise<OtelAgentRun[]>;
  otelAgentLogs(name, runId, tail): Promise<string>;
}
```

Wire-in point: `createDriver()` in `server.ts` switches on the `DRIVER` env
var. Add a branch, e.g. `DRIVER=rustd`.

### Semantics that matter

- `create()` is **async-ish**: return immediately with `status:
  'provisioning'`; the console polls `get()` until `running`.
- `ConflictError` (409) on duplicate names — the UI relies on it.
- `nodes()` powers the ClusterBar every tenant sees; return real capacity
  (`cpuTotalMilli`, `memTotalBytes`) and live usage if you can measure it
  (else `null` — the UI renders gracefully).
- `reapExpired()` is called on an interval; delete workspaces whose
  `expiresAt` passed and return their names.

---

## 3. Workload model (what the managers create)

Every real service is **one replicated unit** ("service" in Swarm terms, a
Deployment+Service in k8s terms) with:

| Concept            | Swarm mechanism                       | Your runtime needs                          |
|--------------------|---------------------------------------|---------------------------------------------|
| identity           | service name `sm4rt-<kind>-<ws>[-id]` | unique name, listable by label filter        |
| tenancy labels     | `sm4rt.workspace`, `sm4rt.kind`, `sm4rt.name`, `sm4rt.meta` (JSON blob) | arbitrary string labels, filterable |
| container image    | any public OCI image                  | OCI pull + run                               |
| env vars           | `Env: ["K=V"]`                        | plain env injection                          |
| command/args       | `Command` / `Args`                    | override entrypoint/cmd                      |
| persistent data    | named volume + mount                  | named volumes surviving restarts             |
| config files       | swarm Config mounted at path (mode 0400/0444) | small immutable files mounted read-only |
| resources          | `NanoCPUs`, `MemoryBytes` limits      | cgroup cpu/mem limits (see §6 for Java)      |
| restart            | `RestartPolicy{any, 5s}`              | always-restart with backoff                  |
| private DNS        | overlay network alias = service name  | cluster DNS: service name resolves internally|
| public L7          | caddy-docker-proxy labels (see below) | any ingress that maps host→container port    |
| public L4          | `PublishedPort` from ranges           | host-port publish on every node (or LB)      |
| placement          | `node.role == manager` constraint     | constraint targeting (used by registry/ddb)  |
| exec               | `container.exec` on the local node    | exec-in-container with captured output       |
| logs               | service logs w/ tail + follow         | per-service log tail + streaming             |

### Port ranges (host-published, cluster-wide unique)

| Range        | Use            |
|--------------|----------------|
| 22000–22999  | VM SSH         |
| 15000–15999  | databases      |
| 16000–16999  | caches         |
| 17000–17999  | brokers (AMQP/Kafka) |

The managers pick a free port by listing all services' published ports —
your runtime must expose "list all published ports" cheaply.

### Ingress (the caddy contract)

Today an L7 proxy (caddy-docker-proxy) watches service labels:

```
caddy                = <host>            # e.g. s3.demo.pajesystems.io
caddy.reverse_proxy  = {{upstreams 9000}}
caddy.tls.on_demand  =                   # when INSTANCE_TLS=true
```

Your runtime can keep caddy (it only needs the Docker events/labels API) or
substitute any ingress able to route `host → service:port` from the same
labels. Wildcard DNS `*.pajesystems.io` → cluster edge is assumed.

### Networking

One shared internal network (`floci-net`). Requirements:
- every service is attached with an alias equal to its service name;
- the API server's own container is on the same network (managers reach
  services at `http://sm4rt-s3-demo:9000` first, falling back to the public
  edge — keep both paths working).

---

## 4. The six container primitives (Docker Engine API subset)

If the Rust runtime speaks these endpoints, **nothing in Node changes**:

1. `POST /services` + `GET /services` + `GET /services/{id}` +
   `DELETE /services/{id}` + `POST /services/{id}/update`
   (CreateServiceOptions shape: Name, Labels, TaskTemplate{ContainerSpec
   {Image, Env, Args, Command, Labels, Mounts, Configs}, Resources.Limits,
   RestartPolicy, Placement.Constraints, Networks[{Target, Aliases}]},
   Mode.Replicated.Replicas, EndpointSpec{Mode|Ports})
2. `GET /tasks?filters={service}` — per-service task state
   (`Status.State == 'running'`, `DesiredState`)
3. `GET /services/{id}/logs?tail=&follow=` — multiplexed stream (8-byte
   header framing, same as Docker)
4. `POST /containers/{id}/exec` + `POST /exec/{id}/start` — used for
   in-container introspection (registry catalog, scylla bootstrap, cqlsh)
5. `GET/POST/DELETE /configs` — small immutable KV blobs (the managers use
   configs as their secret store) and mounted files
6. `GET/POST/DELETE /volumes`, `GET/POST /networks` — named volumes and the
   shared network

Plus: `GET /nodes` (capacity), `GET /containers?filters={label}` (exec
targeting), `swarm join-token` equivalent for `joinCommand()`.

---

## 5. State & multi-tenancy (where truth lives)

- **Runtime truth** = labels on services (`sm4rt.meta` carries the manager's
  JSON metadata: plan, ports, creds pointers). The managers rebuild all state
  from a label-filtered list — your runtime must persist labels reliably.
- **Control-plane truth** = Postgres via `Store` (`api/src/db.ts`): users
  (Clerk), custom domains, workspace settings, coolify servers, and (planned)
  `workspace_owners` for tenant isolation. Your runtime never touches this.
- etcd is NOT required — deliberately. If your runtime needs internal
  consensus state, that's an implementation detail invisible to this contract.

---

## 6. Java-friendly containers (requirement from the roadmap)

The runtime must run heavyweight JVM images (Keycloak, Kafka, Temporal…):

- **cgroup v2** with accurate `memory.max` — modern JVMs
  (`UseContainerSupport`, default on) size the heap from it. If you fake or
  omit limits, JVMs OOM or over-allocate.
- report the limit consistently in `/sys/fs/cgroup/memory.max` **and**
  `/proc/meminfo` is unnecessary — JVM reads cgroups; other stacks (Scylla)
  read both, so document what you expose (we hit this: Scylla saw the cgroup
  and needed `--memory 480M` under a 1 GiB limit).
- allow >= 1 GiB per-container limits and don't kill on brief spikes
  (JIT warmup); prefer `memory.high` soft-throttle before OOM-kill.
- `exec` must work against JVM containers (health scripts, keytool, etc.).
- clean SIGTERM → grace period (30s+) → SIGKILL; JVMs need the grace window.

---

## 7. Conformance checklist (hello world)

A backend is "console-complete" when this sequence works end-to-end:

```bash
# 1. workspace
POST /api/instances {"name":"hello"}            → running

# 2. real container task with public ingress
POST /api/instances/hello/compute/tasks
     {"name":"web","image":"nginxdemos/hello:plain-text","port":80}
curl https://web.hello.<domain>                 → 200 "hello"

# 3. real database with published port
POST /api/instances/hello/compute/databases
     {"name":"db","engine":"postgres-16","plan":"small"}
psql postgres://…:<published-port>/app          → SELECT 1

# 4. object store (S3 wire protocol)
POST /api/instances/hello/compute/objectstore
aws --endpoint-url https://s3.hello.<domain> s3 mb s3://x && s3 ls

# 5. logs / exec / config panel
GET  /api/instances/hello/compute/tasks/web/logs → container output
POST /api/instances/hello/exec {"cmd":["uname","-a"]}

# 6. teardown
DELETE /api/instances/hello                      → everything gone (services,
                                                   volumes, configs, ports freed)
```

Run the existing suites against a live backend:
`cd api && node --test tests/resources.test.ts tests/e2e-kind.test.ts`
(they require a working cluster and validate the full request paths).
