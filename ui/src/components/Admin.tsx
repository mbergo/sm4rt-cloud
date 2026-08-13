import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Cloud,
  Copy,
  Cpu,
  HardDrive,
  Layers,
  Network,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { BrandMark, PrimaryButton } from './bits';
import type { Instance } from '../lib/api';

interface NodeInfo {
  id: string;
  hostname: string;
  role: 'manager' | 'worker';
  state: string;
  addr: string | null;
  cpuTotalMilli: number;
  memTotalBytes: number;
  cpuUsedMilli: number | null;
  memUsedBytes: number | null;
}

interface Overview {
  driver: string;
  instanceDomain: string;
  flociImage: string;
  nodes: NodeInfo[];
  instances: Instance[];
  capacity: {
    cpuTotalMilli: number;
    memTotalBytes: number;
    cpuUsedMilli: number | null;
    memUsedBytes: number | null;
  };
}

const AUTH_KEY = 'floci-admin-auth';

interface CoolifyServer {
  id: string;
  label: string;
  url: string;
  source: 'env' | 'registered';
  healthy: boolean | null;
  version: string | null;
}

interface PlanCategory {
  id: string;
  label: string;
  plans: Record<string, { label: string; cpus: number; memoryMb: number }>;
}


function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

function cores(milli: number): string {
  return `${(milli / 1000).toFixed(1)}`;
}

function UsageBar({ used, total, tone }: { used: number | null; total: number; tone: string }) {
  const pct = used !== null && total > 0 ? Math.min(100, Math.round((used / total) * 100)) : null;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
      {pct !== null ? (
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      ) : (
        <div className="h-full w-full bg-white/5" />
      )}
    </div>
  );
}

export default function Admin() {
  const [auth, setAuth] = useState(() => sessionStorage.getItem(AUTH_KEY) ?? '');

  if (!auth) {
    return <AdminLogin onSignedIn={(value) => setAuth(value)} />;
  }
  return (
    <AdminDashboard
      auth={auth}
      onUnauthorized={() => {
        sessionStorage.removeItem(AUTH_KEY);
        setAuth('');
      }}
    />
  );
}

function AdminLogin({ onSignedIn }: { onSignedIn: (auth: string) => void }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const value = `Basic ${btoa(`${user}:${pass}`)}`;
    try {
      const res = await fetch('/api/admin/overview', { headers: { authorization: value } });
      if (res.status === 401) {
        setError('Invalid credentials.');
        return;
      }
      sessionStorage.setItem(AUTH_KEY, value);
      onSignedIn(value);
    } catch {
      setError('Could not reach the API.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="animate-rise-in flex flex-col items-center text-center">
        <BrandMark size="lg" />
        <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">FLOCI ADMIN</h1>
        <p className="mt-1.5 text-sm text-stone-400">Operator console for this cloud.</p>
      </div>
      <form
        className="animate-rise-in w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-stone-400">
          Username
        </label>
        <input
          autoFocus
          value={user}
          onChange={(event) => setUser(event.target.value)}
          className="w-full rounded-xl border border-white/10 bg-stone-950/60 px-3.5 py-2.5 text-sm outline-none transition focus:border-amber-500/60"
        />
        <label className="mb-2 mt-4 block text-xs font-medium uppercase tracking-wider text-stone-400">
          Password
        </label>
        <input
          type="password"
          value={pass}
          onChange={(event) => setPass(event.target.value)}
          className="w-full rounded-xl border border-white/10 bg-stone-950/60 px-3.5 py-2.5 text-sm outline-none transition focus:border-amber-500/60"
        />
        {error ? <p className="mt-2 text-xs text-rose-400">{error}</p> : null}
        <PrimaryButton className="mt-5 w-full justify-center" disabled={busy} type="submit">
          <ShieldCheck className="h-4 w-4" /> {busy ? 'Checking…' : 'Sign in'}
        </PrimaryButton>
      </form>
    </main>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-stone-300 transition hover:bg-white/10"
    >
      <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// Default `az vm create` block (identical machines) + curl|bash join script.
function AzureProvisionSection({ auth }: { auth: string }) {
  const [name, setName] = useState('sm4rt-5');
  const [count, setCount] = useState(1);
  const [command, setCommand] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ name, count: String(count) });
    const timer = setTimeout(() => {
      fetch(`/api/admin/pool/azure-command?${params}`, { headers: { authorization: auth } })
        .then(async (res) => (res.ok ? ((await res.json()) as { command: string }) : null))
        .then((data) => setCommand(data?.command ?? null))
        .catch(() => setCommand(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [auth, name, count]);

  const joinScriptCurl = `curl -fsSL -u ADMIN_USER:ADMIN_PASS ${window.location.origin}/api/admin/pool/join-script | sudo bash`;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-stone-400">
        <Cloud className="h-4 w-4" /> Provision identical VMs (Azure CLI)
      </h2>
      <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs text-stone-400">
            Base name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-44 rounded-lg border border-white/10 bg-stone-900 px-3 py-2 font-mono text-sm text-stone-100 outline-none focus:border-amber-400/50"
            />
          </label>
          <label className="text-xs text-stone-400">
            Count
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="mt-1 block w-24 rounded-lg border border-white/10 bg-stone-900 px-3 py-2 font-mono text-sm text-stone-100 outline-none focus:border-amber-400/50"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-stone-500">
            Same spec as the current fleet: Standard_B2ms · Ubuntu 24.04 · westus2 ·
            sm4rt-vnet. The cloud-init joins the swarm automatically on first boot.
          </p>
        </div>
        {command ? (
          <div className="flex items-start gap-3">
            <pre className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-white/10 bg-stone-950/60 p-4 font-mono text-xs leading-relaxed text-stone-300">
              {command}
            </pre>
            <CopyButton text={command} />
          </div>
        ) : (
          <div className="h-24 animate-pulse rounded-xl border border-white/5 bg-white/[0.03]" />
        )}
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-stone-500">
            Already have a VM? Add it to the pool with one line:
          </p>
          <div className="flex items-center gap-3">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-xl border border-white/10 bg-stone-950/60 p-3 font-mono text-xs text-stone-300">
              {joinScriptCurl}
            </code>
            <CopyButton text={joinScriptCurl} />
          </div>
        </div>
      </div>
    </section>
  );
}

// Two-slot Coolify area: slot 1 mirrors the env/mcp.json server, slot 2 is a
// registration form persisted in the store.
function CoolifySection({ auth }: { auth: string }) {
  const [servers, setServers] = useState<CoolifyServer[] | null>(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    fetch('/api/admin/coolify/servers', { headers: { authorization: auth } })
      .then(async (res) => (res.ok ? ((await res.json()) as { servers: CoolifyServer[] }) : null))
      .then((data) => setServers(data?.servers ?? []))
      .catch(() => setServers([]));
  }, [auth]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const register = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/coolify/servers', {
        method: 'POST',
        headers: { authorization: auth, 'content-type': 'application/json' },
        body: JSON.stringify({ url, token }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setUrl('');
      setToken('');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'registration failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Remove this Coolify server from the pool?')) return;
    await fetch(`/api/admin/coolify/servers/${id}`, {
      method: 'DELETE',
      headers: { authorization: auth },
    }).catch(() => undefined);
    refresh();
  };

  const slots: Array<CoolifyServer | null> = [servers?.[0] ?? null, servers?.[1] ?? null];

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-stone-400">
        <Layers className="h-4 w-4" /> Coolify servers (shared services)
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {slots.map((server, index) =>
          server ? (
            <div
              key={server.id}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    server.healthy ? 'bg-emerald-400' : 'bg-rose-400'
                  }`}
                />
                <span className="font-mono text-sm text-stone-100">{server.label}</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-widest text-stone-400">
                  {server.source === 'env' ? 'mcp.json / env' : 'registered'}
                </span>
                {server.source === 'registered' ? (
                  <button
                    type="button"
                    onClick={() => remove(server.id)}
                    className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-stone-400 transition hover:bg-rose-500/10 hover:text-rose-400"
                    aria-label="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <p className="mt-2 font-mono text-xs text-stone-400">{server.url}</p>
              <p className="mt-1 text-xs text-stone-500">
                {server.healthy
                  ? `healthy${server.version ? ` · v${server.version}` : ''}`
                  : 'unreachable — check URL/token'}
              </p>
            </div>
          ) : index === 1 && servers !== null ? (
            <div
              key="empty-slot"
              className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5"
            >
              <p className="mb-3 text-xs uppercase tracking-wider text-stone-500">
                Register another Coolify server
              </p>
              <div className="space-y-2">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://coolify.example.com"
                  className="block w-full rounded-lg border border-white/10 bg-stone-900 px-3 py-2 font-mono text-sm text-stone-100 outline-none focus:border-amber-400/50"
                />
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="API token"
                  type="password"
                  className="block w-full rounded-lg border border-white/10 bg-stone-900 px-3 py-2 font-mono text-sm text-stone-100 outline-none focus:border-amber-400/50"
                />
                {error ? <p className="text-xs text-rose-400">{error}</p> : null}
                <PrimaryButton onClick={register} disabled={busy || !url || !token}>
                  <Plus className="h-4 w-4" /> {busy ? 'Checking…' : 'Register'}
                </PrimaryButton>
              </div>
            </div>
          ) : (
            <div
              key={`skeleton-${index}`}
              className="h-28 animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]"
            />
          ),
        )}
      </div>
    </section>
  );
}

// Read-only catalog of service size offerings, browsable with dropdowns.
function PlansSection({ auth }: { auth: string }) {
  const [categories, setCategories] = useState<PlanCategory[] | null>(null);
  const [categoryId, setCategoryId] = useState('vm');
  const [planId, setPlanId] = useState<string>('');

  useEffect(() => {
    fetch('/api/admin/plans', { headers: { authorization: auth } })
      .then(async (res) => (res.ok ? ((await res.json()) as { categories: PlanCategory[] }) : null))
      .then((data) => setCategories(data?.categories ?? []))
      .catch(() => setCategories([]));
  }, [auth]);

  const category = categories?.find((c) => c.id === categoryId) ?? categories?.[0] ?? null;
  const planEntries = category ? Object.entries(category.plans) : [];
  const selected = category?.plans[planId] ?? planEntries[0]?.[1] ?? null;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-stone-400">
        <ShieldCheck className="h-4 w-4" /> Service size offerings
      </h2>
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        {category ? (
          <>
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-xs text-stone-400">
                Service
                <select
                  value={category.id}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                    setPlanId('');
                  }}
                  className="mt-1 block w-52 rounded-lg border border-white/10 bg-stone-900 px-3 py-2 text-sm text-stone-100 outline-none focus:border-amber-400/50"
                >
                  {categories?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-stone-400">
                Size
                <select
                  value={planId || planEntries[0]?.[0] || ''}
                  onChange={(e) => setPlanId(e.target.value)}
                  className="mt-1 block w-64 rounded-lg border border-white/10 bg-stone-900 px-3 py-2 text-sm text-stone-100 outline-none focus:border-amber-400/50"
                >
                  {planEntries.map(([id, plan]) => (
                    <option key={id} value={id}>
                      {id} — {plan.label}
                    </option>
                  ))}
                </select>
              </label>
              {selected ? (
                <div className="flex gap-6 rounded-xl border border-white/10 bg-stone-950/50 px-4 py-2.5">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-stone-500">vCPU</p>
                    <p className="font-mono text-sm text-stone-100">{selected.cpus}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-stone-500">Memory</p>
                    <p className="font-mono text-sm text-stone-100">
                      {selected.memoryMb >= 1024
                        ? `${selected.memoryMb / 1024} GB`
                        : `${selected.memoryMb} MB`}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-stone-500">
                <tr>
                  <th className="py-2">Plan</th>
                  <th className="py-2">Label</th>
                  <th className="py-2">vCPU</th>
                  <th className="py-2">Memory</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {planEntries.map(([id, plan]) => (
                  <tr key={id}>
                    <td className="py-2 font-mono text-xs">{id}</td>
                    <td className="py-2 text-xs text-stone-400">{plan.label}</td>
                    <td className="py-2 font-mono text-xs">{plan.cpus}</td>
                    <td className="py-2 font-mono text-xs">
                      {plan.memoryMb >= 1024 ? `${plan.memoryMb / 1024} GB` : `${plan.memoryMb} MB`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <div className="h-20 animate-pulse rounded-xl border border-white/5 bg-white/[0.03]" />
        )}
      </div>
    </section>
  );
}

// Node-level eBPF (Grafana Beyla) — one privileged agent per node via the exec relay.
function EbpfSection({ auth }: { auth: string }) {
  const [nodes, setNodes] = useState<Array<{ node: string; state: string; error?: string }> | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch('/api/admin/ebpf', { headers: { authorization: auth } })
      .then(async (res) => (res.ok ? ((await res.json()) as { nodes: typeof nodes }) : null))
      .then((data) => setNodes(data?.nodes ?? []))
      .catch(() => setNodes([]));
  }, [auth]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = async (method: 'POST' | 'DELETE') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/ebpf', {
        method,
        headers: { authorization: auth, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; nodes?: typeof nodes } | null;
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setNodes(body?.nodes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ebpf action failed');
    } finally {
      setBusy(false);
    }
  };

  const running = nodes?.filter((n) => n.state === 'running' || n.state === 'starting').length ?? 0;
  const total = nodes?.length ?? 0;
  const enabled = running > 0;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-stone-400">
        <Activity className="h-4 w-4" /> Kernel observability (eBPF)
      </h2>
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-sm text-stone-400">
            Grafana Beyla on every node — RED metrics for all HTTP/gRPC traffic with zero
            instrumentation, exported to a workspace Grafana via OTLP.
          </p>
          <div className="ml-auto flex items-center gap-2">
            {enabled ? (
              <button
                type="button"
                onClick={() => act('DELETE')}
                disabled={busy}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-stone-300 transition hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Disable on all nodes
              </button>
            ) : (
              <PrimaryButton onClick={() => act('POST')} disabled={busy}>
                <Plus className="h-4 w-4" /> {busy ? 'Deploying…' : 'Enable on all nodes'}
              </PrimaryButton>
            )}
          </div>
        </div>
        {error ? <p className="mt-2 text-xs text-rose-400">{error}</p> : null}
        {nodes === null ? (
          <div className="mt-3 h-10 animate-pulse rounded-xl border border-white/5 bg-white/[0.03]" />
        ) : total === 0 ? (
          <p className="mt-3 text-xs text-stone-500">No exec agents reachable.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {nodes.map((n) => (
              <span
                key={n.node}
                title={n.error ?? undefined}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[11px] text-stone-300"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    n.state === 'running'
                      ? 'bg-emerald-400'
                      : n.state === 'starting'
                        ? 'bg-amber-400 animate-pulse'
                        : n.state === 'absent'
                          ? 'bg-stone-500'
                          : 'bg-rose-400'
                  }`}
                />
                {n.node} · {n.state}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function AdminDashboard({
  auth,
  onUnauthorized,
}: {
  auth: string;
  onUnauthorized: () => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [joinCommand, setJoinCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => {
    fetch('/api/admin/overview', { headers: { authorization: auth } })
      .then(async (res) => {
        if (res.status === 401) {
          onUnauthorized();
          return null;
        }
        return (await res.json()) as Overview;
      })
      .then((data) => {
        if (data) {
          setOverview(data);
        }
      })
      .catch(() => undefined);
  }, [auth, onUnauthorized]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    fetch('/api/admin/join-command', { headers: { authorization: auth } })
      .then(async (res) => (res.ok ? ((await res.json()) as { joinCommand: string | null }) : null))
      .then((data) => setJoinCommand(data?.joinCommand ?? null))
      .catch(() => undefined);
  }, [auth]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-stone-950/70 backdrop-blur-xl">
        <div className="flex w-full items-center gap-4 px-6 py-4">
          <BrandMark />
          <div className="min-w-0">
            <h1 className="font-display text-lg font-bold leading-tight tracking-tight">
              FLOCI ADMIN
            </h1>
            <p className="text-xs text-stone-500">
              {overview ? `${overview.driver} · ${overview.instanceDomain}` : 'loading…'}
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-stone-400 transition hover:bg-white/10 hover:text-stone-100"
            aria-label="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="w-full space-y-8 px-8 py-8">
        {overview ? (
          <>
            <section>
              <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-stone-400">
                <Cpu className="h-4 w-4" /> Cluster capacity
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-stone-400">CPU</span>
                    <span className="font-mono text-sm">
                      {overview.capacity.cpuUsedMilli !== null
                        ? `${cores(overview.capacity.cpuUsedMilli)} / `
                        : ''}
                      {cores(overview.capacity.cpuTotalMilli)} cores
                    </span>
                  </div>
                  <div className="mt-3">
                    <UsageBar
                      used={overview.capacity.cpuUsedMilli}
                      total={overview.capacity.cpuTotalMilli}
                      tone="bg-gradient-to-r from-amber-400 to-orange-500"
                    />
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-stone-400">Memory</span>
                    <span className="font-mono text-sm">
                      {overview.capacity.memUsedBytes !== null
                        ? `${gb(overview.capacity.memUsedBytes)} / `
                        : ''}
                      {gb(overview.capacity.memTotalBytes)}
                    </span>
                  </div>
                  <div className="mt-3">
                    <UsageBar
                      used={overview.capacity.memUsedBytes}
                      total={overview.capacity.memTotalBytes}
                      tone="bg-gradient-to-r from-sky-400 to-blue-500"
                    />
                  </div>
                </div>
              </div>
            </section>

            <section>
              <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-stone-400">
                <Server className="h-4 w-4" /> Nodes ({overview.nodes.length})
              </h2>
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <table className="w-full text-sm">
                  <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wider text-stone-500">
                    <tr>
                      <th className="px-4 py-3">Host</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">State</th>
                      <th className="px-4 py-3">Address</th>
                      <th className="px-4 py-3">CPU</th>
                      <th className="px-4 py-3">Memory</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {overview.nodes.map((node) => (
                      <tr key={node.id} className="bg-white/[0.02]">
                        <td className="px-4 py-3 font-mono text-xs">{node.hostname}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs ${
                              node.role === 'manager'
                                ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                                : 'border-white/10 bg-white/5 text-stone-400'
                            }`}
                          >
                            {node.role}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              node.state === 'ready'
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }
                          >
                            {node.state}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-stone-400">
                          {node.addr ?? '—'}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {node.cpuUsedMilli !== null ? `${cores(node.cpuUsedMilli)} / ` : ''}
                          {cores(node.cpuTotalMilli)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {node.memUsedBytes !== null ? `${gb(node.memUsedBytes)} / ` : ''}
                          {gb(node.memTotalBytes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {joinCommand ? (
              <section>
                <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-stone-400">
                  <Network className="h-4 w-4" /> Add a node
                </h2>
                <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-stone-300">
                    {joinCommand}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(joinCommand);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-stone-300 transition hover:bg-white/10"
                  >
                    <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="mt-2 text-xs text-stone-500">
                  Run <code className="font-mono">install/add-node.sh</code> on a fresh Ubuntu box,
                  or paste this on a machine that already has Docker.
                </p>
              </section>
            ) : null}

            <AzureProvisionSection auth={auth} />

            <EbpfSection auth={auth} />

            <CoolifySection auth={auth} />

            <PlansSection auth={auth} />

            <section>
              <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-stone-400">
                <HardDrive className="h-4 w-4" /> Workspaces ({overview.instances.length})
              </h2>
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <table className="w-full text-sm">
                  <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wider text-stone-500">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Endpoint</th>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3">Expires</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {overview.instances.length === 0 ? (
                      <tr className="bg-white/[0.02]">
                        <td className="px-4 py-6 text-center text-stone-500" colSpan={5}>
                          No workspaces yet.
                        </td>
                      </tr>
                    ) : (
                      overview.instances.map((instance) => (
                        <tr key={instance.name} className="bg-white/[0.02]">
                          <td className="px-4 py-3 font-mono text-xs">{instance.name}</td>
                          <td className="px-4 py-3">
                            <span
                              className={
                                instance.status === 'running'
                                  ? 'text-emerald-400'
                                  : instance.status === 'error'
                                    ? 'text-rose-400'
                                    : 'text-amber-300'
                              }
                            >
                              {instance.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-stone-400">
                            {instance.endpoint}
                          </td>
                          <td className="px-4 py-3 text-xs text-stone-400">
                            {instance.createdAt
                              ? new Date(instance.createdAt).toLocaleString()
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-xs text-stone-400">
                            {instance.expiresAt
                              ? new Date(instance.expiresAt).toLocaleString()
                              : 'never'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1].map((index) => (
              <div
                key={index}
                className="h-28 animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]"
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
