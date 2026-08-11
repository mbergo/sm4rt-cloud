// Marketplace page — one-click apps from the shared Coolify server.
// Catalog (~330 templates) + installed apps for the current workspace.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  Loader2,
  Play,
  RotateCw,
  Search,
  Square,
  Store,
  Trash2,
} from 'lucide-react';
import { PrimaryButton } from './bits';
import {
  appAction,
  createApp,
  deleteApp,
  listApps,
  listTemplates,
  type MarketplaceApp,
} from '../lib/marketplace';

function statusTone(status: string): string {
  if (status.startsWith('running')) return 'text-emerald-400';
  if (status.startsWith('exited') || status.startsWith('stopped')) return 'text-stone-500';
  return 'text-amber-300';
}

function titleize(id: string): string {
  return id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function MarketplacePage({
  instance,
  notify,
}: {
  instance: string;
  notify: (message: string, tone?: 'ok' | 'err') => void;
}) {
  const [templates, setTemplates] = useState<string[] | null>(null);
  const [apps, setApps] = useState<MarketplaceApp[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [query, setQuery] = useState('');
  const [installing, setInstalling] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refreshApps = useCallback(() => {
    listApps(instance)
      .then((r) => setApps(r.apps))
      .catch(() => setApps([]));
  }, [instance]);

  useEffect(() => {
    let alive = true;
    listTemplates(instance)
      .then((r) => {
        if (alive) setTemplates(r.templates);
      })
      .catch((err) => {
        if (!alive) return;
        if ((err as { status?: number }).status === 503) setUnavailable(true);
        setTemplates([]);
      });
    refreshApps();
    const timer = setInterval(refreshApps, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [instance, refreshApps]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = templates ?? [];
    return q ? all.filter((t) => t.includes(q)) : all;
  }, [templates, query]);

  const install = async (type: string) => {
    setInstalling(type);
    try {
      const created = await createApp(instance, type);
      notify(`${titleize(type)} deploying — ${created.domains[0] ?? created.uuid}`);
      refreshApps();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'install failed', 'err');
    } finally {
      setInstalling(null);
    }
  };

  const act = async (app: MarketplaceApp, action: 'start' | 'stop' | 'restart') => {
    setBusy(app.uuid);
    try {
      await appAction(instance, app.uuid, action);
      notify(`${app.name}: ${action} requested`);
      setTimeout(refreshApps, 1500);
    } catch (err) {
      notify(err instanceof Error ? err.message : `${action} failed`, 'err');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (app: MarketplaceApp) => {
    if (!window.confirm(`Delete ${app.name} and its volumes?`)) return;
    setBusy(app.uuid);
    try {
      await deleteApp(instance, app.uuid);
      notify(`${app.name} deletion queued`);
      setTimeout(refreshApps, 1500);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'delete failed', 'err');
    } finally {
      setBusy(null);
    }
  };

  if (unavailable) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <Store className="mx-auto h-8 w-8 text-stone-500" />
        <p className="mt-3 text-sm text-stone-400">
          Marketplace is not configured on this deployment.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-wider text-stone-400">
          Installed apps ({apps?.length ?? '…'})
        </h2>
        {apps === null ? (
          <div className="h-20 animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]" />
        ) : apps.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-stone-500">
            Nothing installed yet — pick an app from the catalog below.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {apps.map((app) => (
              <div key={app.uuid} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate font-mono text-sm text-stone-100">
                    {app.name}
                  </span>
                  <span className={`ml-auto text-xs ${statusTone(app.status)}`}>{app.status}</span>
                </div>
                {app.type ? (
                  <p className="mt-1 text-xs text-stone-500">{titleize(app.type)}</p>
                ) : null}
                {app.domains[0] ? (
                  <a
                    href={app.domains[0]}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 flex items-center gap-1.5 truncate font-mono text-xs text-amber-300 hover:underline"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    {app.domains[0].replace(/^https?:\/\//, '')}
                  </a>
                ) : null}
                <div className="mt-3 flex gap-2">
                  {app.status.startsWith('running') ? (
                    <>
                      <button
                        type="button"
                        disabled={busy === app.uuid}
                        onClick={() => act(app, 'restart')}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-stone-300 transition hover:bg-white/10 disabled:opacity-50"
                      >
                        <RotateCw className="h-3 w-3" /> Restart
                      </button>
                      <button
                        type="button"
                        disabled={busy === app.uuid}
                        onClick={() => act(app, 'stop')}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-stone-300 transition hover:bg-white/10 disabled:opacity-50"
                      >
                        <Square className="h-3 w-3" /> Stop
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={busy === app.uuid}
                      onClick={() => act(app, 'start')}
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-emerald-300 transition hover:bg-white/10 disabled:opacity-50"
                    >
                      <Play className="h-3 w-3" /> Start
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy === app.uuid}
                    onClick={() => remove(app)}
                    className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-stone-400 transition hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-50"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-stone-400">
            Catalog {templates ? `(${filtered.length}/${templates.length})` : ''}
          </h2>
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search apps…"
              className="w-64 rounded-lg border border-white/10 bg-stone-900 py-2 pl-9 pr-3 text-sm text-stone-100 outline-none focus:border-amber-400/50"
            />
          </div>
        </div>
        {templates === null ? (
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl border border-white/5 bg-white/[0.03]" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
            {filtered.map((type) => (
              <div
                key={type}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-stone-100">{titleize(type)}</p>
                  <p className="truncate font-mono text-[10px] text-stone-500">{type}</p>
                </div>
                <PrimaryButton onClick={() => install(type)} disabled={installing !== null}>
                  {installing === type ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    'Install'
                  )}
                </PrimaryButton>
              </div>
            ))}
            {filtered.length === 0 ? (
              <p className="col-span-full py-6 text-center text-sm text-stone-500">
                No template matches “{query}”.
              </p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
