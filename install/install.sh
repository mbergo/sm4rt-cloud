#!/usr/bin/env bash
# floci-cloud installer — main machine (Ubuntu, Docker Swarm driver).
#
#   curl -fsSL https://raw.githubusercontent.com/mbergo/floci-cloud/main/install/install.sh | sudo bash
#
# Next-next-finish: asks a few questions, then brings up a complete
# self-hosted cloud (Swarm + Caddy with on-demand Let's Encrypt + console).
set -euo pipefail

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '\033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die() { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo bash install.sh)"
command -v curl >/dev/null || die "curl is required"

bold ""
bold "  ███████ FLOCI CLOUD — self-hosted installer"
bold ""

# ── 1. questions ────────────────────────────────────────────────────────────
DEFAULT_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

prompt() { # var, question, default
  local var="$1" q="$2" def="$3" answer
  if [ -n "${!var:-}" ]; then return; fi
  if [ -t 0 ]; then
    read -r -p "$q [$def]: " answer || true
    printf -v "$var" '%s' "${answer:-$def}"
  else
    printf -v "$var" '%s' "$def"
  fi
}

prompt INSTANCE_DOMAIN "Base domain (create a wildcard DNS record *.domain -> $DEFAULT_IP)" "cloud.local"
prompt ACME_EMAIL      "Email for Let's Encrypt (empty = disable TLS, plain HTTP)" ""
prompt ADMIN_USER      "Admin username" "admin"
prompt ADMIN_PASS      "Admin password" "floci-admin"
prompt CLOUD_TOKEN     "Console access token (empty = generate)" ""
prompt FLOCI_CLOUD_IMAGE "floci-cloud image" "ghcr.io/mbergo/floci-cloud:latest"
prompt FLOCI_IMAGE     "floci emulator image" "ghcr.io/mbergo/floci:latest"

if [ -z "$CLOUD_TOKEN" ]; then
  CLOUD_TOKEN="$(head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32)"
fi
CONSOLE_HOST="cloud.${INSTANCE_DOMAIN}"
if [ -n "$ACME_EMAIL" ]; then INSTANCE_TLS=true; SCHEME=https; else INSTANCE_TLS=false; SCHEME=http; fi

bold ""
bold "  Plan"
echo "    domain        *.${INSTANCE_DOMAIN}"
echo "    console       ${SCHEME}://${CONSOLE_HOST}"
echo "    admin         ${SCHEME}://${CONSOLE_HOST}/admin  (${ADMIN_USER})"
echo "    tls           ${INSTANCE_TLS} (on-demand Let's Encrypt)"
echo "    driver        docker swarm"
bold ""

# ── 2. docker ───────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null; then
  bold "Installing Docker…"
  curl -fsSL https://get.docker.com | sh
fi
ok "docker $(docker --version | awk '{print $3}' | tr -d ',')"

# ── 3. swarm ────────────────────────────────────────────────────────────────
SWARM_STATE="$(docker info --format '{{.Swarm.LocalNodeState}}')"
if [ "$SWARM_STATE" != "active" ]; then
  bold "Initializing Docker Swarm…"
  docker swarm init --advertise-addr "$DEFAULT_IP" >/dev/null
fi
ok "swarm active (manager: $DEFAULT_IP)"

docker network inspect floci-net >/dev/null 2>&1 || \
  docker network create --driver overlay --attachable floci-net >/dev/null
ok "overlay network floci-net"

# ── 4. caddy (edge proxy + on-demand TLS) ───────────────────────────────────
BOOTSTRAP='{"admin":{"listen":"0.0.0.0:2019"}}'
if ! docker config inspect caddy-bootstrap >/dev/null 2>&1; then
  printf '%s' "$BOOTSTRAP" | docker config create caddy-bootstrap - >/dev/null
fi
docker volume create caddy-data >/dev/null 2>&1 || true
if ! docker service inspect caddy >/dev/null 2>&1; then
  docker service create --name caddy \
    --network floci-net \
    --constraint node.role==manager \
    --publish published=80,target=80,mode=host \
    --publish published=443,target=443,mode=host \
    --mount type=volume,source=caddy-data,target=/data \
    --config source=caddy-bootstrap,target=/etc/caddy/bootstrap.json \
    --restart-condition any \
    caddy:2 caddy run --config /etc/caddy/bootstrap.json >/dev/null
fi
ok "caddy running (ports 80/443, admin on overlay :2019)"

# ── 5. floci images ─────────────────────────────────────────────────────────
bold "Pulling images (this can take a few minutes)…"
docker pull "$FLOCI_CLOUD_IMAGE" >/dev/null && ok "pulled $FLOCI_CLOUD_IMAGE"
docker pull "$FLOCI_IMAGE" >/dev/null && ok "pulled $FLOCI_IMAGE" || warn "could not pull $FLOCI_IMAGE — instances will pull on demand"

# ── 6. floci-cloud (console + api) ──────────────────────────────────────────
if docker service inspect floci-cloud >/dev/null 2>&1; then
  docker service rm floci-cloud >/dev/null
fi
docker service create --name floci-cloud \
  --network floci-net \
  --constraint node.role==manager \
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
  --env DRIVER=swarm \
  --env INSTANCE_DOMAIN="$INSTANCE_DOMAIN" \
  --env CONSOLE_HOST="$CONSOLE_HOST" \
  --env INSTANCE_TLS="$INSTANCE_TLS" \
  --env FLOCI_IMAGE="$FLOCI_IMAGE" \
  --env FLOCI_CLOUD_TOKEN="$CLOUD_TOKEN" \
  --env ADMIN_USER="$ADMIN_USER" \
  --env ADMIN_PASS="$ADMIN_PASS" \
  --env CADDY_ADMIN_URL=http://caddy:2019 \
  --env SELF_UPSTREAM=floci-cloud:8080 \
  ${ACME_EMAIL:+--env ACME_EMAIL="$ACME_EMAIL"} \
  --restart-condition any \
  "$FLOCI_CLOUD_IMAGE" >/dev/null
ok "floci-cloud deployed"

# ── 7. wait for health ──────────────────────────────────────────────────────
bold "Waiting for the console to come up…"
for i in $(seq 1 60); do
  if docker run --rm --network floci-net curlimages/curl:8.10.1 \
       -fsS -m 3 http://floci-cloud:8080/healthz >/dev/null 2>&1; then
    ok "console healthy"
    break
  fi
  [ "$i" -eq 60 ] && warn "console still starting — check: docker service logs floci-cloud"
  sleep 3
done

JOIN_CMD="$(docker swarm join-token worker -q 2>/dev/null || true)"

bold ""
bold "  ✅ FLOCI CLOUD is up"
bold ""
echo "  Console   ${SCHEME}://${CONSOLE_HOST}"
echo "  Admin     ${SCHEME}://${CONSOLE_HOST}/admin   (${ADMIN_USER} / ${ADMIN_PASS})"
echo "  Token     ${CLOUD_TOKEN}"
echo ""
echo "  DNS       point *.${INSTANCE_DOMAIN} at ${DEFAULT_IP} (one wildcard A record)"
if [ -n "$JOIN_CMD" ]; then
  echo "  Add node  ./add-node.sh ubuntu@WORKER_IP    (or on the worker:)"
  echo "            docker swarm join --token ${JOIN_CMD} ${DEFAULT_IP}:2377"
fi
echo ""
