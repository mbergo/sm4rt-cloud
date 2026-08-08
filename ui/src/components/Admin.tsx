import { useCallback, useEffect, useState } from 'react';
import { Copy, Cpu, HardDrive, Network, RefreshCw, Server, ShieldCheck } from 'lucide-react';
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
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-4">
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

      <main className="mx-auto max-w-6xl space-y-8 px-6 py-8">
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
