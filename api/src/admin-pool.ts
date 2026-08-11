// Admin node-pool helpers — pure builders for join scripts and Azure CLI
// provisioning commands, plus the Coolify server registry glue.
// No docker/network calls here except checkCoolifyHealth (plain fetch).

export interface AzureDefaults {
  resourceGroup: string;
  location: string;
  size: string;
  image: string;
  adminUsername: string;
  vnet: string;
  subnet: string;
  nsg: string;
  sshKeyPath: string;
}

// Defaults mirror the existing sm4rt-1..4 fleet; every field can be overridden
// via AZURE_* env vars without a rebuild.
export function azureDefaultsFromEnv(env: Record<string, string | undefined>): AzureDefaults {
  return {
    resourceGroup: env.AZURE_RESOURCE_GROUP ?? 'SM4RT-DEMO',
    location: env.AZURE_LOCATION ?? 'westus2',
    size: env.AZURE_VM_SIZE ?? 'Standard_B2ms',
    image: env.AZURE_VM_IMAGE ?? 'Canonical:ubuntu-24_04-lts:server:latest',
    adminUsername: env.AZURE_ADMIN_USERNAME ?? 'mbergo',
    vnet: env.AZURE_VNET ?? 'sm4rt-vnet',
    subnet: env.AZURE_SUBNET ?? 'default',
    nsg: env.AZURE_NSG ?? 'sm4rt-open',
    sshKeyPath: env.AZURE_SSH_KEY_PATH ?? '~/.ssh/id_rsa.pub',
  };
}

// Idempotent bash script: installs Docker when missing, then joins the swarm.
// Meant for `curl -u admin:… …/join-script | sudo bash` on a fresh Ubuntu VM.
export function buildJoinScript(joinCommand: string): string {
  return `#!/usr/bin/env bash
# sm4rt-cloud — add this machine to the swarm pool (idempotent)
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "==> installing docker"
  curl -fsSL https://get.docker.com | sh
fi

state="$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo inactive)"
if [ "$state" = "active" ]; then
  echo "==> already part of a swarm, nothing to do"
  exit 0
fi

echo "==> joining swarm"
${joinCommand}
echo "==> done — node joined the pool"
`;
}

// Cloud-init payload for brand-new Azure VMs: same steps as the join script.
export function buildCloudInit(joinCommand: string): string {
  return `#cloud-config
package_update: true
runcmd:
  - curl -fsSL https://get.docker.com | sh
  - ${joinCommand}
`;
}

// One copy-paste block: writes the cloud-init file then loops `az vm create`
// for `count` machines named `<name>`, `<name>2`, `<name>3`, …
export function buildAzureCreateCommand(opts: {
  joinCommand: string;
  defaults: AzureDefaults;
  name?: string;
  count?: number;
}): string {
  const d = opts.defaults;
  const base = (opts.name ?? 'sm4rt-5').trim() || 'sm4rt-5';
  const rawCount = Math.floor(opts.count ?? 1);
  const count = Number.isFinite(rawCount) ? Math.min(10, Math.max(1, rawCount)) : 1;
  // "sm4rt-5" ×3 → sm4rt-5, sm4rt-6, sm4rt-7; a base without a numeric
  // suffix gets 2, 3, … appended instead.
  const suffixMatch = /^(.*?)(\d+)$/.exec(base);
  const names = Array.from({ length: count }, (_, i) => {
    if (i === 0) return base;
    if (suffixMatch) {
      return `${suffixMatch[1]}${Number(suffixMatch[2]) + i}`;
    }
    return `${base}${i + 1}`;
  });
  const create = (vm: string) =>
    [
      `az vm create \\`,
      `  --resource-group ${d.resourceGroup} \\`,
      `  --name ${vm} \\`,
      `  --location ${d.location} \\`,
      `  --size ${d.size} \\`,
      `  --image ${d.image} \\`,
      `  --admin-username ${d.adminUsername} \\`,
      `  --ssh-key-values ${d.sshKeyPath} \\`,
      `  --vnet-name ${d.vnet} --subnet ${d.subnet} \\`,
      `  --nsg ${d.nsg} \\`,
      `  --public-ip-sku Standard \\`,
      `  --custom-data /tmp/sm4rt-join.yaml`,
    ].join('\n');
  return [
    `cat > /tmp/sm4rt-join.yaml <<'EOF'`,
    buildCloudInit(opts.joinCommand).trimEnd(),
    `EOF`,
    ``,
    ...names.map(create),
  ].join('\n');
}

// — Coolify server registry —

export interface CoolifyServer {
  id: string;
  label: string;
  url: string;
  source: 'env' | 'registered';
  healthy: boolean | null;
  version: string | null;
}

export async function checkCoolifyHealth(
  url: string,
  token: string,
): Promise<{ healthy: boolean; version: string | null }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/v1/version`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { healthy: false, version: null };
    }
    const body = (await res.text()).trim().replace(/^"|"$/g, '');
    return { healthy: true, version: body || null };
  } catch {
    return { healthy: false, version: null };
  }
}
