#!/usr/bin/env bash
# floci-cloud — add a worker node to the swarm.
#
#   ./add-node.sh ubuntu@10.0.0.12 [ubuntu@10.0.0.13 …]
#
# Run from the MAIN machine (the swarm manager). Uses your SSH key to
# install Docker on each box (if missing) and join it to the cluster.
set -euo pipefail

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '\033[32m✔\033[0m %s\n' "$*"; }
die() { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

[ $# -ge 1 ] || die "usage: $0 user@host [user@host …]"
command -v docker >/dev/null || die "docker not found — run this on the manager"
[ "$(docker info --format '{{.Swarm.ControlAvailable}}')" = "true" ] || \
  die "this machine is not a swarm manager — run install.sh first"

TOKEN="$(docker swarm join-token worker -q)"
MANAGER_ADDR="$(docker info --format '{{.Swarm.NodeAddr}}')"

for target in "$@"; do
  bold "→ $target"
  # shellcheck disable=SC2087  # TOKEN/MANAGER_ADDR expand client-side by design
  ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$target" bash -s <<REMOTE
set -euo pipefail
if ! command -v docker >/dev/null; then
  echo "  installing docker…"
  curl -fsSL https://get.docker.com | sudo sh
fi
STATE="\$(sudo docker info --format '{{.Swarm.LocalNodeState}}')"
if [ "\$STATE" = "active" ]; then
  echo "  already in a swarm — skipping join"
else
  sudo docker swarm join --token ${TOKEN} ${MANAGER_ADDR}:2377
fi
REMOTE
  ok "$target joined"
done

bold ""
docker node ls
