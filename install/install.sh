#!/usr/bin/env bash
# floci-cloud installer — main machine (Ubuntu, Docker Swarm driver).
#
#   curl -fsSL https://raw.githubusercontent.com/mbergo/sm4rt-cloud/main/install/install.sh | sudo bash
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
bold "  ███████ SM4RT-CLOUD — self-hosted installer"
bold ""

# ── 1. questions ────────────────────────────────────────────────────────────
DEFAULT_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

prompt() { # var, question, default
  local var="$1" q="$2" def="$3" answer
  if [ -n "${!var:-}" ]; then return; fi
  # piped install (curl | bash): stdin is not a TTY, read from /dev/tty
  if [ -t 0 ]; then
    read -r -p "$q [$def]: " answer || true
  elif [ -r /dev/tty ]; then
    read -r -p "$q [$def]: " answer < /dev/tty || true
  else
    answer=""
  fi
  printf -v "$var" '%s' "${answer:-$def}"
}

prompt INSTANCE_DOMAIN "Base domain (create a wildcard DNS record *.domain -> $DEFAULT_IP)" "cloud.local"

# Caddy handles certificates automatically (ACME). HTTPS is on by default for
# real domains; local/test domains (cloud.local, *.sslip.io, …) default to HTTP.
case "$INSTANCE_DOMAIN" in
  cloud.local|localhost|*.sslip.io|*.nip.io|*.localhost) TLS_DEFAULT=no ;;
  *) TLS_DEFAULT=yes ;;
esac
prompt ENABLE_TLS      "Enable HTTPS (automatic certificates via Caddy)? (yes/no)" "$TLS_DEFAULT"
prompt ACME_EMAIL      "ACME account email (optional, for certificate expiry notices)" ""
prompt ADMIN_USER      "Admin username" "admin"
prompt ADMIN_PASS      "Admin password" "floci-admin"
prompt CLOUD_TOKEN     "Console access token (empty = generate)" ""
prompt FLOCI_CLOUD_IMAGE "sm4rt-cloud image" "ghcr.io/mbergo/sm4rt-cloud:latest"
prompt FLOCI_IMAGE     "floci emulator image" "ghcr.io/mbergo/floci:latest"
prompt REGISTRY_USER   "Registry username (empty = public images only)" ""
if [ -n "$REGISTRY_USER" ]; then
  prompt REGISTRY_PASS   "Registry token/password" ""
  prompt REGISTRY_SERVER "Registry server" "ghcr.io"
else
  REGISTRY_PASS=""; REGISTRY_SERVER="ghcr.io"
fi

if [ -z "$CLOUD_TOKEN" ]; then
  CLOUD_TOKEN="$(head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32)"
fi
CONSOLE_HOST="cloud.${INSTANCE_DOMAIN}"
case "$ENABLE_TLS" in
  [Yy]*|true) INSTANCE_TLS=true; SCHEME=https ;;
  *)          INSTANCE_TLS=false; SCHEME=http ;;
esac

bold ""
bold "  Plan"
echo "    domain        *.${INSTANCE_DOMAIN}"
echo "    console       ${SCHEME}://${CONSOLE_HOST}"
echo "    admin         ${SCHEME}://${CONSOLE_HOST}/admin  (${ADMIN_USER})"
echo "    tls           ${INSTANCE_TLS} (automatic via Caddy${ACME_EMAIL:+, account $ACME_EMAIL})"
echo "    driver        docker swarm"
bold ""

# ── 2. preflight + dependencies ─────────────────────────────────────────────
OS_TYPE="$(grep -w ID /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"')"
case "$OS_TYPE" in
  pop|linuxmint|zorin) OS_TYPE=ubuntu ;;
  manjaro|manjaro-arm|endeavouros|cachyos) OS_TYPE=arch ;;
  fedora-asahi-remix) OS_TYPE=fedora ;;
esac

# disk / ram sanity (warn only)
AVAIL_GB="$(df -BG / 2>/dev/null | awk 'NR==2 {gsub("G","",$4); print $4}')"
TOTAL_RAM_MB="$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null)"
[ -n "$AVAIL_GB" ] && [ "$AVAIL_GB" -lt 15 ] && warn "only ${AVAIL_GB}GB free on / — 15GB+ recommended (images + workspaces)"
[ -n "$TOTAL_RAM_MB" ] && [ "$TOTAL_RAM_MB" -lt 3500 ] && warn "only ${TOTAL_RAM_MB}MB RAM — 4GB+ recommended"

# docker via snap is unsupported (breaks swarm networking)
if command -v snap >/dev/null 2>&1 && snap list docker >/dev/null 2>&1; then
  die "Docker installed via snap is not supported — 'snap remove docker' and rerun"
fi

ensure_packages() { # minimal deps: curl + ca certs + openssl
  case "$OS_TYPE" in
    ubuntu|debian|raspbian)
      apt-get update -y >/dev/null
      apt-get install -y curl ca-certificates openssl >/dev/null ;;
    centos|fedora|rhel|ol|rocky|almalinux|amzn)
      command -v dnf >/dev/null || yum install -y dnf >/dev/null
      dnf install -y curl ca-certificates openssl >/dev/null ;;
    arch) pacman -Sy --noconfirm --needed curl ca-certificates openssl >/dev/null ;;
    alpine) apk add --no-cache curl ca-certificates openssl >/dev/null ;;
    sles|opensuse-leap|opensuse-tumbleweed) zypper install -y curl ca-certificates openssl >/dev/null ;;
    *) warn "unknown distro '$OS_TYPE' — assuming curl/openssl are present" ;;
  esac
}
command -v openssl >/dev/null 2>&1 || ensure_packages
ok "base packages (distro: ${OS_TYPE:-unknown})"

install_docker_fallback() { # when get.docker.com fails
  case "$OS_TYPE" in
    ubuntu|debian|raspbian)
      apt-get update -y >/dev/null
      apt-get install -y ca-certificates curl >/dev/null
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL "https://download.docker.com/linux/$OS_TYPE/gpg" -o /etc/apt/keyrings/docker.asc
      chmod a+r /etc/apt/keyrings/docker.asc
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$OS_TYPE $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" \
        > /etc/apt/sources.list.d/docker.list
      apt-get update -y >/dev/null
      apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null ;;
    centos|fedora|rhel|ol|rocky|almalinux)
      dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo >/dev/null 2>&1 || true
      dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null ;;
    arch) pacman -Syu --noconfirm --needed docker >/dev/null ;;
    alpine) apk add --no-cache docker docker-cli-compose >/dev/null ;;
    sles|opensuse-leap|opensuse-tumbleweed) zypper install -y docker >/dev/null ;;
    *) return 1 ;;
  esac
}

if ! command -v docker >/dev/null; then
  bold "Installing Docker…"
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1 || true
  if ! command -v docker >/dev/null; then
    warn "get.docker.com failed — trying distro packages"
    install_docker_fallback || die "could not install Docker automatically — install it manually and rerun"
  fi
fi
# make sure the daemon is enabled and running (fresh installs on some distros)
if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now docker >/dev/null 2>&1 || true
elif command -v rc-update >/dev/null 2>&1; then
  rc-update add docker default >/dev/null 2>&1 || true
  service docker start >/dev/null 2>&1 || true
fi
docker info >/dev/null 2>&1 || die "docker daemon is not running"
DOCKER_MAJOR="$(docker --version | sed 's/[^0-9]*\([0-9]*\).*/\1/')"
[ -n "$DOCKER_MAJOR" ] && [ "$DOCKER_MAJOR" -lt 24 ] && warn "docker ${DOCKER_MAJOR}.x is old — 24+ recommended"
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
# caddy-docker-proxy: every swarm service declares its routes via caddy.*
# labels and the proxy rebuilds its Caddyfile from them. Fully declarative —
# no admin-API pushes, no config to lose on restart.
CADDY_IMAGE="lucaslorentz/caddy-docker-proxy:2.13.1-alpine"

# base Caddyfile (global options): on-demand TLS stays gated by the console
CADDY_BASE="{
    on_demand_tls {
        ask http://floci-cloud:8080/api/public/tls-ask
    }
}"
if [ -n "$ACME_EMAIL" ]; then
  CADDY_BASE="{
    email ${ACME_EMAIL}
    on_demand_tls {
        ask http://floci-cloud:8080/api/public/tls-ask
    }
}"
fi

# recreate caddy when the image changes — this also migrates installs from
# the old push-based caddy:2 setup (admin API + bootstrap config)
OLD_CADDY_IMAGE="$(docker service inspect caddy --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null || true)"
if [ -n "$OLD_CADDY_IMAGE" ] && [ "${OLD_CADDY_IMAGE%%@*}" != "$CADDY_IMAGE" ]; then
  warn "caddy image changed (${OLD_CADDY_IMAGE%%@*} -> ${CADDY_IMAGE}) — recreating"
  docker service rm caddy >/dev/null 2>&1 || true
fi
docker config rm caddy-bootstrap >/dev/null 2>&1 || true

CADDY_BASE_B64="$(printf '%s' "$CADDY_BASE" | base64 | tr -d '\n')"
CURRENT_B64="$(docker config inspect caddy-base --format '{{json .Spec.Data}}' 2>/dev/null | tr -d '"' || true)"
if [ -n "$CURRENT_B64" ] && [ "$CURRENT_B64" != "$CADDY_BASE_B64" ]; then
  warn "caddy base config changed — recreating caddy service"
  docker service rm caddy >/dev/null 2>&1 || true
  docker config rm caddy-base >/dev/null 2>&1 || true
fi
if ! docker config inspect caddy-base >/dev/null 2>&1; then
  printf '%s' "$CADDY_BASE" | docker config create caddy-base - >/dev/null
fi
docker volume create caddy-data >/dev/null 2>&1 || true
docker volume create caddy-config >/dev/null 2>&1 || true
if ! docker service inspect caddy >/dev/null 2>&1; then
  docker service create --name caddy \
    --network floci-net \
    --constraint node.role==manager \
    --publish published=80,target=80,mode=host \
    --publish published=443,target=443,mode=host \
    --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock,ro \
    --mount type=volume,source=caddy-data,target=/data \
    --mount type=volume,source=caddy-config,target=/config \
    --config source=caddy-base,target=/dynamic/Caddyfile \
    --env CADDY_INGRESS_NETWORKS=floci-net \
    --env CADDY_DOCKER_CADDYFILE_PATH=/dynamic/Caddyfile \
    --env CADDY_DOCKER_POLLING_INTERVAL=5s \
    --restart-condition any \
    "$CADDY_IMAGE" >/dev/null
fi
ok "caddy running (caddy-docker-proxy, ports 80/443)"

# ── 5. floci images ─────────────────────────────────────────────────────────
if [ -n "$REGISTRY_USER" ] && [ -n "$REGISTRY_PASS" ]; then
  printf '%s' "$REGISTRY_PASS" | docker login "$REGISTRY_SERVER" -u "$REGISTRY_USER" --password-stdin >/dev/null
  ok "logged in to $REGISTRY_SERVER as $REGISTRY_USER"
fi
bold "Pulling images (this can take a few minutes)…"
docker pull "$FLOCI_CLOUD_IMAGE" >/dev/null && ok "pulled $FLOCI_CLOUD_IMAGE"
docker pull "$FLOCI_IMAGE" >/dev/null && ok "pulled $FLOCI_IMAGE" || warn "could not pull $FLOCI_IMAGE — instances will pull on demand"

# ── 6. floci-cloud (console + api) ──────────────────────────────────────────
if docker service inspect floci-cloud >/dev/null 2>&1; then
  docker service rm floci-cloud >/dev/null
fi
# container runs as non-root (USER node) — grant it the docker.sock group
DOCKER_SOCK_GID="$(stat -c %g /var/run/docker.sock 2>/dev/null || echo 0)"
# console vhost: caddy-docker-proxy builds the route from these labels
if [ "$INSTANCE_TLS" = "true" ]; then
  CONSOLE_SITE="$CONSOLE_HOST"
  CONSOLE_TLS_LABEL='caddy.tls.on_demand={{""}}'
else
  CONSOLE_SITE="http://$CONSOLE_HOST"
  CONSOLE_TLS_LABEL=""
fi
docker service create --name floci-cloud \
  --network floci-net \
  --constraint node.role==manager \
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
  --group "$DOCKER_SOCK_GID" \
  --label caddy="$CONSOLE_SITE" \
  --label caddy.reverse_proxy='{{upstreams 8080}}' \
  ${CONSOLE_TLS_LABEL:+--label "$CONSOLE_TLS_LABEL"} \
  --env DRIVER=swarm \
  --env INSTANCE_DOMAIN="$INSTANCE_DOMAIN" \
  --env CONSOLE_HOST="$CONSOLE_HOST" \
  --env INSTANCE_TLS="$INSTANCE_TLS" \
  --env FLOCI_IMAGE="$FLOCI_IMAGE" \
  --env FLOCI_CLOUD_TOKEN="$CLOUD_TOKEN" \
  --env ADMIN_USER="$ADMIN_USER" \
  --env ADMIN_PASS="$ADMIN_PASS" \
  ${REGISTRY_USER:+--env REGISTRY_USER="$REGISTRY_USER"} \
  ${REGISTRY_PASS:+--env REGISTRY_PASS="$REGISTRY_PASS"} \
  ${REGISTRY_USER:+--env REGISTRY_SERVER="$REGISTRY_SERVER"} \
  --with-registry-auth \
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
bold "  ✅ SM4RT-CLOUD is up"
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
