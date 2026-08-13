// PaaS page — Render-style: public git repo in, live URL out. Plus managed
// databases (8 engines). Runs on the embedded engine; the tenant only sees us.
import { useCallback, useEffect, useState } from 'react';
import {
  Database,
  ExternalLink,
  GitBranch,
  Loader2,
  Play,
  RefreshCw,
  RotateCw,
  Rocket,
  Square,
  Trash2,
} from 'lucide-react';
import { BrandLoader, PrimaryButton } from './bits';
import {
  PAAS_DB_ENGINES,
  createPaasApp,
  createPaasDatabase,
  deletePaasApp,
  deletePaasDatabase,
  listPaasApps,
  listPaasDatabases,
  paasAppAction,
  paasDatabaseAction,
  type PaasApp,
  type PaasDatabase,
} from '../lib/paas';

function statusTone(status: string): string {
  const s = status.toLowerCase();
  if (s.startsWith('running')) return 'text-emerald-400';
  if (s.startsWith('exited') || s.startsWith('stopped')) return 'text-stone-500';
  return 'text-amber-300';
}

export default function PaasPage({
  instance,
  notify,
}: {
  instance: string;
  notify: (message: string, tone?: 'ok' | 'err') => void;
}) {
  const [apps, setApps] = useState<PaasApp[] | null>(null);
  const [dbs, setDbs] = useState<PaasDatabase[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [repo, setRepo] = useState('');
  const [appName, setAppName] = useState('');
  const [branch, setBranch] = useState('main');
  const [port, setPort] = useState('3000');
  const [deploying, setDeploying] = useState(false);

  const [dbEngine, setDbEngine] = useState<string>('postgresql');
  const [dbName, setDbName] = useState('');

  const refresh = useCallback(() => {
    listPaasApps(instance)
      .then((r) => setApps(r.apps))
      .catch((err) => {
        if ((err as { status?: number }).status === 503) setUnavailable(true);
        setApps([]);
      });
    listPaasDatabases(instance)
      .then((r) => setDbs(r.databases))
      .catch(() => setDbs([]));
  }, [instance]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 12000);
    return () => clearInterval(timer);
  }, [refresh]);

  const deploy = async () => {
    setDeploying(true);
    try {
      const created = await createPaasApp(instance, {
        name: appName.trim(),
        repository: repo.trim(),
        branch: branch.trim() || 'main',
        port: Number(port) || 3000,
      });
      notify(`Building — will be live at ${created.fqdn ?? 'its URL'} in a few minutes`);
      setRepo('');
      setAppName('');
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'deploy failed', 'err');
    } finally {
      setDeploying(false);
    }
  };

  const runApp = async (app: PaasApp, action: 'start' | 'stop' | 'restart' | 'deploy') => {
    setBusy(app.uuid);
    try {
      await paasAppAction(instance, app.uuid, action);
      notify(`${app.name}: ${action} requested`);
      setTimeout(refresh, 1500);
    } catch (err) {
      notify(err instanceof Error ? err.message : `${action} failed`, 'err');
    } finally {
      setBusy(null);
    }
  };

  const removeApp = async (app: PaasApp) => {
    if (!window.confirm(`Delete ${app.name} and its volumes?`)) return;
    setBusy(app.uuid);
    try {
      await deletePaasApp(instance, app.uuid);
      notify(`${app.name} deletion queued`);
      setTimeout(refresh, 1500);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'delete failed', 'err');
    } finally {
      setBusy(null);
    }
  };

  const createDb = async () => {
    setBusy('new-db');
    try {
      await createPaasDatabase(instance, dbEngine, dbName.trim() || undefined);
      notify(`${dbEngine} provisioning`);
      setDbName('');
      setTimeout(refresh, 1500);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'create failed', 'err');
    } finally {
      setBusy(null);
    }
  };

  const runDb = async (db: PaasDatabase, action: 'start' | 'stop' | 'restart') => {
    setBusy(db.uuid);
    try {
      await paasDatabaseAction(instance, db.uuid, action);
      notify(`${db.name}: ${action} requested`);
      setTimeout(refresh, 1500);
    } catch (err) {
      notify(err instanceof Error ? err.message : `${action} failed`, 'err');
    } finally {
      setBusy(null);
    }
  };

  const removeDb = async (db: PaasDatabase) => {
    if (!window.confirm(`Delete ${db.name} and its data?`)) return;
    setBusy(db.uuid);
    try {
      await deletePaasDatabase(instance, db.uuid);
      notify(`${db.name} deletion queued`);
      setTimeout(refresh, 1500);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'delete failed', 'err');
    } finally {
      setBusy(null);
    }
  };

  if (unavailable) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <Rocket className="mx-auto h-8 w-8 text-stone-500" />
        <p className="mt-3 text-sm text-stone-400">PaaS is not configured on this deployment.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-stone-400">
          <Rocket className="h-4 w-4" /> Deploy from Git
        </h2>
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-72 flex-1 text-xs text-stone-400">
              Public repository URL
              <input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="https://github.com/you/your-app"
                className="mt-1 block w-full rounded-lg border border-white/10 bg-stone-900 px-3 py-2 font-mono text-sm text-stone-100 outline-none focus:border-amber-400/50"
              />
            </label>
            <label className="text-xs text-stone-400">
              App name
              <input
                value={appName}
                onChange={(e) => setAppName(e.target.value.toLowerCase())}
                placeholder="my-app"
                className="mt-1 block w-40 rounded-lg border border-white/10 bg-stone-900 px-3 py-2 font-mono text-sm text-stone-100 outline-none focus:border-amber-400/50"
              />
            </label>
            <label className="text-xs text-stone-400">
              Branch
              <input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="mt-1 block w-28 rounded-lg border border-white/10 bg-stone-900 px-3 py-2 font-mono text-sm text-stone-100 outline-none focus:border-amber-400/50"
              />
            </label>
            <label className="text-xs text-stone-400">
              Port
              <input
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="mt-1 block w-20 rounded-lg border border-white/10 bg-stone-900 px-3 py-2 font-mono text-sm text-stone-100 outline-none focus:border-amber-400/50"
              />
            </label>
            <PrimaryButton onClick={deploy} disabled={deploying || !repo.trim() || !appName.trim()}>
              {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Deploy
            </PrimaryButton>
          </div>
          <p className="text-xs text-stone-500">
            Build is automatic (nixpacks detects the stack). Your app goes live on the platform
            domain with TLS — no Dockerfile required.
          </p>
        </div>

        {apps === null ? (
          <div className="mt-4 flex justify-center py-4"><BrandLoader size="sm" label="Loading apps" /></div>
        ) : apps.length > 0 ? (
          <div className="mt-4 space-y-3">
            {apps.map((app) => (
              <div key={app.uuid} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`text-xs ${statusTone(app.status)}`}>●</span>
                  <span className="font-mono text-sm text-stone-100">{app.name}</span>
                  <span className={`text-xs ${statusTone(app.status)}`}>{app.status}</span>
                  {app.repository ? (
                    <span className="flex items-center gap-1 truncate font-mono text-[11px] text-stone-500">
                      <GitBranch className="h-3 w-3" />
                      {app.repository.replace('https://', '')}@{app.branch}
                    </span>
                  ) : null}
                  {app.fqdn ? (
                    <a
                      href={app.fqdn}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 font-mono text-xs text-amber-300 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {app.fqdn.replace(/^https?:\/\//, '')}
                    </a>
                  ) : null}
                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busy === app.uuid}
                      onClick={() => runApp(app, 'deploy')}
                      title="Rebuild & redeploy"
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-stone-300 transition hover:bg-white/10 disabled:opacity-50"
                    >
                      <RotateCw className="h-3 w-3" /> Redeploy
                    </button>
                    {app.status.startsWith('running') ? (
                      <button
                        type="button"
                        disabled={busy === app.uuid}
                        onClick={() => runApp(app, 'stop')}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-stone-300 transition hover:bg-white/10 disabled:opacity-50"
                      >
                        <Square className="h-3 w-3" /> Stop
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy === app.uuid}
                        onClick={() => runApp(app, 'start')}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-emerald-300 transition hover:bg-white/10 disabled:opacity-50"
                      >
                        <Play className="h-3 w-3" /> Start
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy === app.uuid}
                      onClick={() => removeApp(app)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-stone-400 transition hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-50"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-stone-400">
          <Database className="h-4 w-4" /> Managed databases
        </h2>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-stone-400">
              Engine
              <select
                value={dbEngine}
                onChange={(e) => setDbEngine(e.target.value)}
                className="mt-1 block w-44 rounded-lg border border-white/10 bg-stone-900 px-3 py-2 text-sm text-stone-100 outline-none focus:border-amber-400/50"
              >
                {PAAS_DB_ENGINES.map((engine) => (
                  <option key={engine} value={engine}>
                    {engine}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-stone-400">
              Name (optional)
              <input
                value={dbName}
                onChange={(e) => setDbName(e.target.value.toLowerCase())}
                placeholder="main"
                className="mt-1 block w-40 rounded-lg border border-white/10 bg-stone-900 px-3 py-2 font-mono text-sm text-stone-100 outline-none focus:border-amber-400/50"
              />
            </label>
            <PrimaryButton onClick={createDb} disabled={busy === 'new-db'}>
              <Database className="h-4 w-4" /> Provision
            </PrimaryButton>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-stone-400 transition hover:bg-white/10"
              aria-label="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {dbs === null ? (
          <div className="mt-4 flex justify-center py-4"><BrandLoader size="sm" label="Loading databases" /></div>
        ) : dbs.length > 0 ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {dbs.map((db) => (
              <div key={db.uuid} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-stone-100">{db.name}</span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-widest text-stone-400">
                    {db.engine}
                  </span>
                  <span className={`ml-auto text-xs ${statusTone(db.status)}`}>{db.status}</span>
                </div>
                {db.internalUrl ? (
                  <p className="mt-2 truncate font-mono text-[11px] text-stone-500">{db.internalUrl}</p>
                ) : null}
                <div className="mt-3 flex gap-2">
                  {db.status.startsWith('running') ? (
                    <button
                      type="button"
                      disabled={busy === db.uuid}
                      onClick={() => runDb(db, 'stop')}
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-stone-300 transition hover:bg-white/10 disabled:opacity-50"
                    >
                      <Square className="h-3 w-3" /> Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy === db.uuid}
                      onClick={() => runDb(db, 'start')}
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-emerald-300 transition hover:bg-white/10 disabled:opacity-50"
                    >
                      <Play className="h-3 w-3" /> Start
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy === db.uuid}
                    onClick={() => removeDb(db)}
                    className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-stone-400 transition hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-50"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
