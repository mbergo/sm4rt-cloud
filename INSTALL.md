# Installing SM4RT-CLOUD

Self-hosted AWS-compatible cloud. One main machine + N workers, or a
Kubernetes cluster. Everything real — no mocks.

## What you need

- Ubuntu 22.04+ (any Linux with Docker works), 4+ GB RAM per machine
- A domain with **one wildcard DNS record**: `*.cloud.example.com → <main machine IP>`
- Ports 80/443 reachable on the main machine (for Let's Encrypt + traffic)
- Between machines (LAN): `2377/tcp`, `7946/tcp+udp`, `4789/udp` (Swarm
  management, gossip and overlay networking — usually open by default on a LAN)

That's it. No cloud account, no external services.

---

## Option A — VMs / bare metal (Docker Swarm)

### 1. Main machine (~5 min)

```bash
curl -fsSL https://raw.githubusercontent.com/mbergo/sm4rt-cloud/main/install/install.sh | sudo bash
```

The wizard asks for: domain, Let's Encrypt email (empty = plain HTTP),
admin user/pass, console token. It then installs Docker, initializes
Swarm, starts Caddy (edge + on-demand TLS) and the floci-cloud console.

At the end it prints the console URL, admin URL and access token.

Non-interactive:

```bash
sudo INSTANCE_DOMAIN=cloud.example.com ACME_EMAIL=you@example.com bash install.sh
```

Private images (e.g. private GHCR): pass registry credentials — the
installer logs in, deploys with `--with-registry-auth`, and instances
created later reuse the credentials on every node:

```bash
sudo REGISTRY_USER=you REGISTRY_PASS=ghp_xxx bash install.sh
```

### 2. Add workers (~1 min each)

From the main machine, with SSH key access to the workers:

```bash
curl -fsSL https://raw.githubusercontent.com/mbergo/sm4rt-cloud/main/install/add-node.sh -o add-node.sh
chmod +x add-node.sh
./add-node.sh ubuntu@10.0.0.12 ubuntu@10.0.0.13 ubuntu@10.0.0.14
```

Each worker gets Docker installed and joins the swarm. Capacity shows up
immediately in `/admin`. You can also copy the join command from the
admin page and run it manually on any machine.

### 3. Demo flow (4 machines)

```bash
# machine 1 (main)
curl -fsSL https://raw.githubusercontent.com/mbergo/sm4rt-cloud/main/install/install.sh | sudo bash
                                        # → console + admin live

# still on machine 1: join machines 2-4
curl -fsSL https://raw.githubusercontent.com/mbergo/sm4rt-cloud/main/install/add-node.sh -o add-node.sh && chmod +x add-node.sh
./add-node.sh user@m2 user@m3 user@m4

# verify
open https://cloud.example.com/admin    # 4 nodes, capacity bars
open https://cloud.example.com          # create instance "demo"
aws --endpoint-url https://demo.cloud.example.com s3 mb s3://hello
```

TLS certificates are issued automatically on the first request to each
subdomain (Caddy on-demand TLS) — no DNS API keys, no cert-manager.

---

## Option B — Kubernetes (Helm)

Requirements: a cluster, an ingress controller (nginx by default),
optionally cert-manager with a ClusterIssuer for TLS.

```bash
./install/install-k8s.sh
# or directly:
helm upgrade --install floci-cloud charts/floci-cloud \
  --namespace floci-cloud --create-namespace \
  --set instanceDomain=cloud.example.com \
  --set routing.ingressClass=nginx \
  --set routing.clusterIssuer=letsencrypt \
  --set instanceTls=true
```

Point `*.cloud.example.com` at the ingress load-balancer IP.

Gateway API instead of Ingress:

```bash
  --set routing.mode=gateway \
  --set routing.gatewayName=floci \
  --set routing.gatewayNamespace=envoy-gateway-system
```

---

## After install

| URL | What |
| --- | --- |
| `https://cloud.<domain>` | Console — create instances, manage AWS resources, service catalog |
| `https://cloud.<domain>/admin` | Admin — nodes, capacity, all workspaces, add-node command |
| `https://<instance>.<domain>` | AWS endpoint of an instance (`aws --endpoint-url …`) |
| `https://<instance>-<svc>.<domain>` | Catalog service ingress (e.g. `demo-jupyter.…`) |

Credentials inside instances are the usual local pair:
`AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test`.

## How capacity works

Instances are **capacity units** for a tenant's personal cloud, not VMs.
Every machine you join adds real CPU/RAM to the cluster; the swarm
scheduler places emulator and catalog-service containers wherever there
is room. The admin page shows per-node totals and live usage.

## Updating

```bash
# swarm
docker service update --image ghcr.io/mbergo/sm4rt-cloud:latest floci-cloud

# kubernetes
helm upgrade floci-cloud charts/floci-cloud --reuse-values
```

## Uninstalling

```bash
# swarm (main machine)
docker service rm floci-cloud caddy
docker swarm leave --force        # on each machine

# kubernetes
helm uninstall floci-cloud -n floci-cloud
```
