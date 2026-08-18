// Marketplace page. One-click apps from the shared Coolify server.
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
import { BrandLoader, CopyButton, GhostButton, PrimaryButton } from './bits';
import { Card, CopyRow, DangerButton, EmptyState, ErrorNote, Input, PageShell, StateDot } from './Compute';
import { timeAgo } from '../lib/format';
import { normalizeStatus } from '../lib/status';
import {
  appAction,
  createApp,
  deleteApp,
  listApps,
  listTemplates,
  type MarketplaceApp,
} from '../lib/marketplace';

const CATALOG_PREVIEW = 48;

function titleize(id: string): string {
  return id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Coolify may return bare domains; hrefs need a scheme to not resolve relative. */
function toHref(domain: string): string {
  return /^https?:\/\//.test(domain) ? domain : `https://${domain}`;
}

function TypePill({ type }: { type: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-widest text-stone-400">
      {titleize(type)}
    </span>
  );
}

/** Amber chip for the health suffix; healthy is the norm, so only surface trouble. */
function DetailChip({ detail }: { detail?: string }) {
  if (!detail || detail === 'healthy') return null;
  return (
    <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-amber-300">
      {detail}
    </span>
  );
}

export default function MarketplacePage({
  instance,
  notify,
}: {
  instance: string;
  notify: (message: string, tone?: 'ok' | 'err') => void;
}) {
  const [templates, setTemplates] = useState<string[] | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [apps, setApps] = useState<MarketplaceApp[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [installing, setInstalling] = useState<string[]>([]);
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
        if ((err as { status?: number }).status === 503) {
          setUnavailable(true);
        } else {
          setCatalogError(err instanceof Error ? err.message : 'failed to load the catalog');
        }
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
    if (!q) return all;
    return all.filter((t) => t.includes(q) || t.replace(/-/g, ' ').includes(q));
  }, [templates, query]);

  const visible = expanded ? filtered : filtered.slice(0, CATALOG_PREVIEW);

  // createApp is a plain POST per template; installs can run concurrently, so
  // the guard is single-flight per tile only. Other tiles stay enabled.
  const install = async (type: string) => {
    if (installing.includes(type)) {
      notify(`${titleize(type)} install already in flight`, 'err');
      return;
    }
    setInstalling((cur) => [...cur, type]);
    try {
      const created = await createApp(instance, type);
      notify(
        created.domains[0]
          ? `${titleize(type)} deploying at ${created.domains[0]}`
          : `${titleize(type)} deploying (${created.uuid})`,
      );
      refreshApps();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'install failed', 'err');
    } finally {
      setInstalling((cur) => cur.filter((t) => t !== type));
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
      <PageShell icon={Store} title="Marketplace" subtitle="One-click apps on the shared apps server">
        <Card>
          <EmptyState text="Marketplace is not configured on this deployment." />
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell
      icon={Store}
      title="Marketplace"
      subtitle="One-click apps with automatic TLS on the shared apps server"
      onRefresh={refreshApps}
    >
      <section className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">
          Installed apps{apps ? ` (${apps.length})` : ''}
        </h3>
        {apps === null ? (
          <div className="flex justify-center py-6">
            <BrandLoader size="sm" label="Loading apps" />
          </div>
        ) : apps.length === 0 ? (
          <Card>
            <EmptyState text="Nothing installed yet. Pick an app from the catalog below." />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {apps.map((app) => {
              const st = normalizeStatus(app.status);
              return (
                <Card key={app.uuid} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StateDot state={st.label} />
                    <DetailChip detail={st.detail} />
                    {app.type ? (
                      <span className="ml-auto">
                        <TypePill type={app.type} />
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 truncate font-mono text-sm text-stone-100">{app.name}</p>
                  {app.domains[0] ? (
                    <a
                      href={toHref(app.domains[0])}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 flex items-center gap-1.5 truncate font-mono text-xs text-amber-300 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      {app.domains[0].replace(/^https?:\/\//, '')}
                    </a>
                  ) : null}
                  <div className="mt-3 flex items-center gap-1.5">
                    {st.state === 'running' ? (
                      <>
                        <GhostButton
                          onClick={() => void act(app, 'restart')}
                          disabled={busy === app.uuid}
                          className="!px-2.5 !py-1 !text-xs"
                        >
                          <RotateCw className="h-3 w-3" /> Restart
                        </GhostButton>
                        <GhostButton
                          onClick={() => void act(app, 'stop')}
                          disabled={busy === app.uuid}
                          className="!px-2.5 !py-1 !text-xs"
                        >
                          <Square className="h-3 w-3" /> Stop
                        </GhostButton>
                      </>
                    ) : (
                      <GhostButton
                        onClick={() => void act(app, 'start')}
                        disabled={busy === app.uuid}
                        className="!px-2.5 !py-1 !text-xs !text-emerald-300"
                      >
                        <Play className="h-3 w-3" /> Start
                      </GhostButton>
                    )}
                    <span className="ml-auto">
                      <DangerButton
                        onClick={() => void remove(app)}
                        disabled={busy === app.uuid}
                        confirmLabel="Confirm?"
                        ariaLabel={`Delete ${app.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </DangerButton>
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">
            Catalog
          </h3>
          {templates !== null ? (
            <span className="text-[11px] text-stone-500">
              {filtered.length} of {templates.length}
            </span>
          ) : null}
          {templates === null || templates.length > 0 ? (
            <div className="relative ml-auto w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-stone-500" />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setExpanded(false);
                }}
                placeholder="Search apps"
                className="pl-9"
              />
            </div>
          ) : null}
        </div>
        {templates === null ? (
          <div className="flex justify-center py-6">
            <BrandLoader size="sm" label="Loading catalog" />
          </div>
        ) : templates.length === 0 ? (
          <ErrorNote
            message={catalogError || 'The catalog came back empty. Refresh to try again.'}
          />
        ) : filtered.length === 0 ? (
          <Card>
            <EmptyState text={`No templates match "${query}".`} />
          </Card>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
              {visible.map((type) => {
                const tileBusy = installing.includes(type);
                return (
                  <Card key={type} className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-stone-100">{titleize(type)}</p>
                      <p className="truncate font-mono text-[10px] text-stone-500">{type}</p>
                    </div>
                    <PrimaryButton
                      onClick={() => void install(type)}
                      disabled={tileBusy}
                      className="!px-3 !py-1.5 !text-xs"
                    >
                      {tileBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Install'}
                    </PrimaryButton>
                  </Card>
                );
              })}
            </div>
            {!expanded && filtered.length > CATALOG_PREVIEW ? (
              <div className="flex justify-center">
                <GhostButton onClick={() => setExpanded(true)}>
                  Show all {filtered.length}
                </GhostButton>
              </div>
            ) : null}
          </>
        )}
      </section>
    </PageShell>
  );
}

/** Detail page for one user-deployed marketplace app (sidebar entry). */
export function MarketplaceAppPage({
  instance,
  uuid,
  notify,
  onGone,
}: {
  instance: string;
  uuid: string;
  notify: (message: string, tone?: 'ok' | 'err') => void;
  onGone: () => void;
}) {
  const [app, setApp] = useState<MarketplaceApp | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    listApps(instance)
      .then((r) => {
        const found = r.apps.find((a) => a.uuid === uuid) ?? null;
        setApp(found);
        if (!found) onGone();
      })
      .catch(() => undefined);
  }, [instance, uuid, onGone]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 8000);
    return () => clearInterval(timer);
  }, [refresh]);

  const act = async (action: 'start' | 'stop' | 'restart') => {
    setBusy(true);
    try {
      await appAction(instance, uuid, action);
      notify(`${app?.name ?? 'app'}: ${action} requested`);
      setTimeout(refresh, 1500);
    } catch (err) {
      notify(err instanceof Error ? err.message : `${action} failed`, 'err');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteApp(instance, uuid);
      notify(`${app?.name ?? 'app'} deletion queued`);
      onGone();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'delete failed', 'err');
      setBusy(false);
    }
  };

  if (!app) {
    return (
      <div className="flex justify-center py-16">
        <BrandLoader size="sm" label="Loading app" />
      </div>
    );
  }

  const st = normalizeStatus(app.status);

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-display text-lg font-bold tracking-tight text-stone-100">
              {app.name}
            </h2>
            <StateDot state={st.label} />
            <DetailChip detail={st.detail} />
            {app.type ? <TypePill type={app.type} /> : null}
          </div>
          <p className="mt-1 text-xs text-stone-500">
            Deployed from the marketplace · created {timeAgo(app.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {st.state === 'running' ? (
            <>
              <GhostButton onClick={() => void act('restart')} disabled={busy}>
                <RotateCw className="h-3.5 w-3.5" /> Restart
              </GhostButton>
              <GhostButton onClick={() => void act('stop')} disabled={busy}>
                <Square className="h-3.5 w-3.5" /> Stop
              </GhostButton>
            </>
          ) : (
            <PrimaryButton onClick={() => void act('start')} disabled={busy}>
              <Play className="h-3.5 w-3.5" /> Start
            </PrimaryButton>
          )}
          <DangerButton onClick={() => void remove()} disabled={busy} confirmLabel="Confirm delete">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </DangerButton>
        </div>
      </div>

      {app.domains.length > 0 ? (
        <Card className="p-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
            Endpoints
          </h3>
          <div className="mt-2 space-y-2">
            {app.domains.map((domain) => (
              <div
                key={domain}
                className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-black/20 px-3 py-2"
              >
                <a
                  href={toHref(domain)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-1.5 truncate font-mono text-xs text-amber-300 hover:underline"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  {domain.replace(/^https?:\/\//, '')}
                </a>
                <CopyButton value={domain} />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="space-y-2 p-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
          Details
        </h3>
        <CopyRow label="App UUID" value={app.uuid} />
        <p className="text-xs text-stone-500">Runs on the shared apps server.</p>
      </Card>
    </div>
  );
}
