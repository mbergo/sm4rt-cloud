// PaaS page. Render-style: public git repo in, live URL out. Plus managed
// databases (8 engines). Runs on the embedded engine; the tenant only sees us.
import { useCallback, useEffect, useState } from 'react';
import {
  Database,
  ExternalLink,
  GitBranch,
  Loader2,
  Play,
  RotateCw,
  Rocket,
  Square,
  Trash2,
} from 'lucide-react';
import { BrandLoader, GhostButton, PrimaryButton } from './bits';
import {
  Card,
  CopyRow,
  DangerButton,
  EmptyState,
  Input,
  Label,
  PageShell,
  Select,
  StateDot,
} from './Compute';
import { normalizeStatus } from '../lib/status';
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

/** Amber chip for the health suffix; healthy is the norm, so only surface trouble. */
function DetailChip({ detail }: { detail?: string }) {
  if (!detail || detail === 'healthy') return null;
  return (
    <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-amber-300">
      {detail}
    </span>
  );
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
  const [deployNotice, setDeployNotice] = useState<string | null>(null);

  const [repo, setRepo] = useState('');
  const [appName, setAppName] = useState('');
  const [branch, setBranch] = useState('main');
  const [port, setPort] = useState('3000');
  const [deploying, setDeploying] = useState(false);

  const [dbEngine, setDbEngine] = useState<string>('postgresql');
  const [dbName, setDbName] = useState('');

  const refresh = useCallback(() => {
    listPaasApps(instance)
      .then((r) => {
        setApps(r.apps);
        // a successful call means Coolify is back; recover from the 503 state
        setUnavailable(false);
      })
      .catch((err) => {
        if ((err as { status?: number }).status === 503) setUnavailable(true);
        setApps([]);
      });
    listPaasDatabases(instance)
      .then((r) => {
        setDbs(r.databases);
        setUnavailable(false);
      })
      .catch(() => setDbs([]));
  }, [instance]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 12000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!deployNotice) return;
    const timer = setTimeout(() => setDeployNotice(null), 12000);
    return () => clearTimeout(timer);
  }, [deployNotice]);

  const deploy = async () => {
    const name = appName.trim();
    setDeploying(true);
    try {
      const created = await createPaasApp(instance, {
        name,
        repository: repo.trim(),
        branch: branch.trim() || 'main',
        port: Number(port) || 3000,
      });
      // The API returns only { uuid, fqdn }; status polling below tracks the build.
      setDeployNotice(
        created.fqdn
          ? `Deploy queued for ${name}. Live URL once built: ${created.fqdn}`
          : `Deploy queued for ${name}. Status updates below as the build runs.`,
      );
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
      if (action === 'deploy') {
        setDeployNotice(`Deploy queued for ${app.name}. Status updates as the build runs.`);
      } else {
        notify(`${app.name}: ${action} requested`);
      }
      setTimeout(refresh, 1500);
    } catch (err) {
      notify(err instanceof Error ? err.message : `${action} failed`, 'err');
    } finally {
      setBusy(null);
    }
  };

  const removeApp = async (app: PaasApp) => {
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
      <PageShell icon={Rocket} title="PaaS" subtitle="Deploy apps straight from Git">
        <Card>
          <EmptyState text="PaaS is not configured on this deployment." />
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell
      icon={Rocket}
      title="PaaS"
      subtitle="Public Git repo in, live URL out. Managed databases included."
      onRefresh={refresh}
    >
      <section className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">
          Apps from Git
        </h3>
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-72 flex-1">
              <Label>Public repository URL</Label>
              <Input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="https://github.com/you/your-app"
                className="font-mono"
              />
            </label>
            <label className="w-40">
              <Label>App name</Label>
              <Input
                value={appName}
                onChange={(e) => setAppName(e.target.value.toLowerCase())}
                placeholder="my-app"
                className="font-mono"
              />
            </label>
            <label className="w-28">
              <Label>Branch</Label>
              <Input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="font-mono"
              />
            </label>
            <label className="w-20">
              <Label>Port</Label>
              <Input
                value={port}
                onChange={(e) => setPort(e.target.value)}
                inputMode="numeric"
                className="font-mono"
              />
            </label>
            <PrimaryButton
              onClick={() => void deploy()}
              disabled={deploying || !repo.trim() || !appName.trim()}
            >
              {deploying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              Deploy
            </PrimaryButton>
          </div>
          <p className="text-xs text-stone-500">
            Build is automatic (nixpacks detects the stack). Your app goes live on the platform
            domain with TLS, no Dockerfile required.
          </p>
        </Card>

        {deployNotice ? (
          <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-200">
            {deployNotice}
          </div>
        ) : null}

        {apps === null ? (
          <div className="flex justify-center py-6">
            <BrandLoader size="sm" label="Loading apps" />
          </div>
        ) : apps.length === 0 ? (
          <Card>
            <EmptyState text="No apps yet. Point a Git repo above and deploy." />
          </Card>
        ) : (
          <div className="space-y-2">
            {apps.map((app) => {
              const st = normalizeStatus(app.status);
              return (
                <Card key={app.uuid} className="p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <StateDot state={st.label} />
                    <DetailChip detail={st.detail} />
                    <span className="font-mono text-sm text-stone-100">{app.name}</span>
                    {app.repository ? (
                      <span className="flex min-w-0 items-center gap-1 truncate font-mono text-[11px] text-stone-500">
                        <GitBranch className="h-3 w-3 shrink-0" />
                        {app.repository.replace(/^https?:\/\//, '')}@{app.branch ?? 'main'}
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
                      <PrimaryButton
                        onClick={() => void runApp(app, 'deploy')}
                        disabled={busy === app.uuid}
                        className="!px-3 !py-1.5 !text-xs"
                      >
                        <RotateCw className="h-3 w-3" /> Redeploy
                      </PrimaryButton>
                      {st.state === 'running' ? (
                        <GhostButton
                          onClick={() => void runApp(app, 'stop')}
                          disabled={busy === app.uuid}
                          className="!px-2.5 !py-1 !text-xs"
                        >
                          <Square className="h-3 w-3" /> Stop
                        </GhostButton>
                      ) : (
                        <GhostButton
                          onClick={() => void runApp(app, 'start')}
                          disabled={busy === app.uuid}
                          className="!px-2.5 !py-1 !text-xs !text-emerald-300"
                        >
                          <Play className="h-3 w-3" /> Start
                        </GhostButton>
                      )}
                      <DangerButton
                        onClick={() => void removeApp(app)}
                        disabled={busy === app.uuid}
                        confirmLabel="Confirm?"
                        ariaLabel={`Delete ${app.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </DangerButton>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">
          Managed databases
        </h3>
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="w-44">
              <Label>Engine</Label>
              <Select value={dbEngine} onChange={(e) => setDbEngine(e.target.value)}>
                {PAAS_DB_ENGINES.map((engine) => (
                  <option key={engine} value={engine}>
                    {engine}
                  </option>
                ))}
              </Select>
            </label>
            <label className="w-40">
              <Label>Name (optional)</Label>
              <Input
                value={dbName}
                onChange={(e) => setDbName(e.target.value.toLowerCase())}
                placeholder="main"
                className="font-mono"
              />
            </label>
            <PrimaryButton onClick={() => void createDb()} disabled={busy === 'new-db'}>
              {busy === 'new-db' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Database className="h-4 w-4" />
              )}
              Provision
            </PrimaryButton>
          </div>
        </Card>

        {dbs === null ? (
          <div className="flex justify-center py-6">
            <BrandLoader size="sm" label="Loading databases" />
          </div>
        ) : dbs.length === 0 ? (
          <Card>
            <EmptyState text="No databases yet. Pick an engine above and provision one." />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {dbs.map((db) => {
              const st = normalizeStatus(db.status);
              return (
                <Card key={db.uuid} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-stone-100">{db.name}</span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-widest text-stone-400">
                      {db.engine}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      <StateDot state={st.label} />
                      <DetailChip detail={st.detail} />
                    </span>
                  </div>
                  {db.internalUrl ? (
                    <div className="mt-3">
                      <CopyRow label="Internal URL" value={db.internalUrl} secret />
                    </div>
                  ) : null}
                  <div className="mt-3 flex items-center gap-1.5">
                    {st.state === 'running' ? (
                      <GhostButton
                        onClick={() => void runDb(db, 'stop')}
                        disabled={busy === db.uuid}
                        className="!px-2.5 !py-1 !text-xs"
                      >
                        <Square className="h-3 w-3" /> Stop
                      </GhostButton>
                    ) : (
                      <GhostButton
                        onClick={() => void runDb(db, 'start')}
                        disabled={busy === db.uuid}
                        className="!px-2.5 !py-1 !text-xs !text-emerald-300"
                      >
                        <Play className="h-3 w-3" /> Start
                      </GhostButton>
                    )}
                    <span className="ml-auto">
                      <DangerButton
                        onClick={() => void removeDb(db)}
                        disabled={busy === db.uuid}
                        confirmLabel="Confirm?"
                        ariaLabel={`Delete ${db.name}`}
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
    </PageShell>
  );
}
