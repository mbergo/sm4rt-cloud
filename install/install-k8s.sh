#!/usr/bin/env bash
# floci-cloud — Kubernetes install (Helm).
#
#   ./install-k8s.sh                                  # interactive
#   INSTANCE_DOMAIN=cloud.acme.com ./install-k8s.sh   # non-interactive
set -euo pipefail

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '\033[32m✔\033[0m %s\n' "$*"; }
die() { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

command -v kubectl >/dev/null || die "kubectl is required"
command -v helm >/dev/null || die "helm is required (https://helm.sh/docs/intro/install/)"
kubectl cluster-info >/dev/null 2>&1 || die "no reachable cluster (check kubeconfig)"

bold ""
bold "  ███████ FLOCI CLOUD — Kubernetes installer"
bold ""

prompt() {
  local var="$1" q="$2" def="$3" answer
  if [ -n "${!var:-}" ]; then return; fi
  if [ -t 0 ]; then
    read -r -p "$q [$def]: " answer || true
    printf -v "$var" '%s' "${answer:-$def}"
  else
    printf -v "$var" '%s' "$def"
  fi
}

prompt INSTANCE_DOMAIN "Base domain (wildcard *.domain -> ingress IP)" "cloud.local"
prompt INGRESS_CLASS   "Ingress class" "nginx"
prompt CLUSTER_ISSUER  "cert-manager ClusterIssuer (empty = no TLS)" ""
prompt ADMIN_USER      "Admin username" "admin"
prompt ADMIN_PASS      "Admin password" "floci-admin"
prompt CLOUD_TOKEN     "Console token (empty = generate)" ""
prompt NAMESPACE       "Namespace" "floci-cloud"

TLS=false; [ -n "$CLUSTER_ISSUER" ] && TLS=true
CHART_DIR="$(cd "$(dirname "$0")/../charts/floci-cloud" && pwd)"

helm upgrade --install floci-cloud "$CHART_DIR" \
  --namespace "$NAMESPACE" --create-namespace \
  --set instanceDomain="$INSTANCE_DOMAIN" \
  --set instanceTls="$TLS" \
  --set routing.ingressClass="$INGRESS_CLASS" \
  ${CLUSTER_ISSUER:+--set routing.clusterIssuer="$CLUSTER_ISSUER"} \
  --set admin.user="$ADMIN_USER" \
  --set admin.pass="$ADMIN_PASS" \
  ${CLOUD_TOKEN:+--set auth.token="$CLOUD_TOKEN"} \
  --wait --timeout 5m

ok "deployed to namespace $NAMESPACE"
kubectl -n "$NAMESPACE" get pods,ingress
