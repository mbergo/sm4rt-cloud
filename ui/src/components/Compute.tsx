/**
 * sm4rt compute pages — real workloads UI (Servers, Containers, Databases,
 * Caches, DNS, Gateways, CDN, Observability, DevOps).
 */
import {
  Activity,
  Archive,
  Box,
  Container,
  Database,
  GitBranch,
  Globe,
  HardDrive,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  ScrollText,
  Server,
  Square,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { ApiError } from '../lib/api';
import {
  CACHE_ENGINES,
  CACHE_PLANS,
  DB_ENGINES,
  DB_PLANS,
  DNS_TYPES,
  TASK_PLANS,
  VM_IMAGES,
  VM_PLANS,
  addGitopsApp,
  createBucket,
  createCache,
  createQueue,
  createTable,
  createCdn,
  createDatabase,
  createDns,
  createGateway,
  createTask,
  createVm,
  databaseLogs,
  deleteBucket,
  deleteCache,
  deleteQueue,
  deleteTable,
  deleteCdn,
  deleteDatabase,
  deleteDns,
  deleteGateway,
  deleteRegistryTag,
  disableDevops,
  disableBroker,
  disableObjectStore,
  disableObservability,
  disableTableStore,
  disableRegistry,
  enableDevops,
  enableBroker,
  enableObjectStore,
  enableObservability,
  enableTableStore,
  enableRegistry,
  getDevops,
  getBroker,
  getObjectStore,
  getObservability,
  getTableStore,
  getRegistry,
  listCaches,
  listBuckets,
  listCdns,
  listDatabases,
  listDns,
  listGateways,
  listGitopsApps,
  listRegistryRepos,
  listQueues,
  listTables,
  listTasks,
  listVms,
  purgeCdn,
  removeGitopsApp,
  retryDevopsBootstrap,
  syncGitopsApp,
  taskAction,
  taskLogs,
  updateGateway,
  updateTask,
  vmAction,
  vmLogs,
  type CacheEngineId,
  type CacheInfo,
  type CdnInfo,
  type DbEngineId,
  type DbInfo,
  type DevopsStatus,
  type DnsRecord,
  type DnsType,
  type GatewayInfo,
  type GatewayRoute,
  type GitopsApp,
  type BucketInfo,
  type ObjectStoreStatus,
  type ObsInfo,
  type BrokerStatus,
  type QueueInfo,
  type RegistryRepo,
  type RegistryStatus,
  type ServicePlanId,
  type TableInfo,
  type TableStoreStatus,
  type TaskInfo,
  type VmImageId,
  type VmInfo,
  type VmPlanId,
} from '../lib/compute';
import { timeAgo } from '../lib/format';
import { useLogConsole } from '../lib/log-console';
import { CopyButton, GhostButton, PrimaryButton } from './bits';

type Notify = (message: string, tone?: 'ok' | 'err') => void;
interface PageProps {
  instance: string;
  notify: Notify;
}

// ————— shared primitives —————

function errMsg(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'request failed';
}

function isSwarmOnly(err: unknown): boolean {
  return err instanceof ApiError && err.status === 501;
}

function useComputeData<T>(load: () => Promise<T>, pollMs = 10000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [swarmOnly, setSwarmOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setData(await loadRef.current());
      setError(null);
      setSwarmOnly(false);
    } catch (err) {
      setSwarmOnly(isSwarmOnly(err));
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => refresh(true), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  return { data, error, swarmOnly, loading, refresh };
}

function SwarmOnlyNote() {
  return (
    <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-4 text-sm text-amber-200">
      This service is not available in this workspace&apos;s region. Recreate the workspace on a
      compute-enabled region to use it.
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-rose-400/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-200">
      {message}
    </div>
  );
}

function PageShell({
  icon: Icon,
  title,
  subtitle,
  onRefresh,
  actions,
  children,
}: {
  icon: typeof Server;
  title: string;
  subtitle: string;
  onRefresh?: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5">
            <Icon className="h-5 w-5 text-amber-300" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-stone-100">{title}</h2>
            <p className="text-xs text-stone-500">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {onRefresh ? (
            <GhostButton onClick={onRefresh}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </GhostButton>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-white/5 bg-white/[0.03] ${className}`}>{children}</div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="px-4 py-8 text-center text-sm text-stone-500">{text}</p>;
}

function StateDot({ state }: { state: string }) {
  const s = state.toLowerCase();
  const color =
    s === 'running' || s === 'ready' || s === 'active'
      ? 'bg-emerald-400'
      : s === 'stopped' || s === 'disabled'
        ? 'bg-stone-500'
        : s === 'error' || s === 'failed'
          ? 'bg-rose-400'
          : 'bg-amber-400 animate-pulse';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-stone-300">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {state}
    </span>
  );
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-stone-500 ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 align-middle text-sm text-stone-300 ${className}`}>{children}</td>;
}

function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-xs ${className}`}>{children}</span>;
}

function CopyRow({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret);
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-black/20 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">{label}</p>
        <p className="truncate font-mono text-xs text-stone-200">
          {shown ? value : '••••••••••••'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {secret ? (
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            className="rounded-md px-2 py-1 text-[10px] font-medium text-stone-400 hover:bg-white/10 hover:text-stone-100"
          >
            {shown ? 'Hide' : 'Reveal'}
          </button>
        ) : null}
        <CopyButton value={value} />
      </div>
    </div>
  );
}

function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-black/30">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">{title}</p>
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed text-stone-300">
        {code}
      </pre>
    </div>
  );
}

function DangerButton({
  children,
  onClick,
  confirmLabel = 'Confirm delete',
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  confirmLabel?: string;
  disabled?: boolean;
}) {
  const [arm, setArm] = useState(false);
  useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(false), 3000);
    return () => clearTimeout(t);
  }, [arm]);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (arm) {
          setArm(false);
          onClick();
        } else {
          setArm(true);
        }
      }}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        arm
          ? 'border-rose-400/40 bg-rose-500/20 text-rose-200'
          : 'border-white/10 bg-white/5 text-rose-300/80 hover:border-rose-400/30 hover:text-rose-200'
      }`}
    >
      {arm ? confirmLabel : children}
    </button>
  );
}

function LogPane({
  fetchLogs,
  title = 'Logs',
}: {
  fetchLogs: () => Promise<{ logs: string }>;
  title?: string;
}) {
  const [logs, setLogs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setBusy(true);
    fetchLogs()
      .then((r) => setLogs(r.logs || '(no output)'))
      .catch((err) => setLogs(`error: ${errMsg(err)}`))
      .finally(() => setBusy(false));
  }, [fetchLogs]);
  useEffect(load, [load]);
  return (
    <div className="rounded-lg border border-white/5 bg-black/40">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">{title}</p>
        <GhostButton onClick={load} disabled={busy} className="!px-2 !py-0.5 !text-xs">
          <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} />
        </GhostButton>
      </div>
      <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-stone-400">
        {logs ?? 'loading…'}
      </pre>
    </div>
  );
}

function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-400/50 focus:outline-none ${props.className ?? ''}`}
    />
  );
}

function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-stone-100 focus:border-amber-400/50 focus:outline-none [&>option]:bg-stone-900 ${props.className ?? ''}`}
    />
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-stone-500">
      {children}
    </span>
  );
}

function CreatePanel({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  if (!open) return null;
  return <Card className="p-4">{children}</Card>;
}

// ————— Servers (real VMs) —————

export function ServersPage({ instance, notify }: PageProps) {
  const { data, error, swarmOnly, loading, refresh } = useComputeData(
    useCallback(() => listVms(instance), [instance]),
  );
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [image, setImage] = useState<VmImageId>('ubuntu-24');
  const [plan, setPlan] = useState<VmPlanId>('small');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const vms = data?.vms ?? [];
  const detail = vms.find((v) => v.id === selected) ?? null;

  const submit = async () => {
    setBusy(true);
    try {
      const vm = await createVm(instance, { name: name.trim(), image, plan });
      notify(`Server ${vm.name} launching — SSH ready in ~20s`);
      setName('');
      setShowCreate(false);
      setSelected(vm.id);
      refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const act = async (vm: VmInfo, action: 'stop' | 'start' | 'reboot' | 'terminate') => {
    try {
      await vmAction(instance, vm.id, action);
      notify(`${vm.name}: ${action} requested`);
      if (action === 'terminate') setSelected(null);
      refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    }
  };

  if (swarmOnly) return <PageShell icon={Server} title="Servers" subtitle="Real Linux VMs with SSH"><SwarmOnlyNote /></PageShell>;

  return (
    <PageShell
      icon={Server}
      title="Servers"
      subtitle="Real Linux servers on the cluster — SSH in seconds, no hypervisor wait"
      onRefresh={() => refresh()}
      actions={
        <PrimaryButton onClick={() => setShowCreate((v) => !v)}>
          <Plus className="h-4 w-4" /> Launch server
        </PrimaryButton>
      }
    >
      {error && !swarmOnly ? <ErrorNote message={error} /> : null}
      <CreatePanel open={showCreate}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="web-1" />
          </label>
          <label>
            <Label>Image</Label>
            <Select value={image} onChange={(e) => setImage(e.target.value as VmImageId)}>
              {VM_IMAGES.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </Select>
          </label>
          <label>
            <Label>Plan</Label>
            <Select value={plan} onChange={(e) => setPlan(e.target.value as VmPlanId)}>
              {VM_PLANS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <PrimaryButton onClick={submit} disabled={busy || !name.trim()}>
            {busy ? 'Launching…' : 'Launch'}
          </PrimaryButton>
        </div>
      </CreatePanel>

      <Card>
        {loading && vms.length === 0 ? (
          <EmptyState text="Loading…" />
        ) : vms.length === 0 ? (
          <EmptyState text="No servers yet. Launch one — it boots in seconds and you SSH straight in." />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <Th>Name</Th>
                <Th>State</Th>
                <Th>Image</Th>
                <Th>Plan</Th>
                <Th>SSH endpoint</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {vms.map((vm) => (
                <tr
                  key={vm.id}
                  onClick={() => setSelected(vm.id === selected ? null : vm.id)}
                  className={`cursor-pointer border-b border-white/5 last:border-0 hover:bg-white/[0.03] ${selected === vm.id ? 'bg-amber-500/5' : ''}`}
                >
                  <Td className="font-medium text-stone-100">{vm.name}</Td>
                  <Td><StateDot state={vm.state} /></Td>
                  <Td>{vm.imageLabel}</Td>
                  <Td>{vm.planLabel}</Td>
                  <Td>
                    <Mono>
                      {vm.sshHost}:{vm.sshPort}
                    </Mono>
                  </Td>
                  <Td className="text-stone-500">{timeAgo(vm.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {detail ? (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-sm font-semibold text-stone-100">{detail.name}</p>
            <div className="flex flex-wrap gap-2">
              {detail.state === 'stopped' ? (
                <GhostButton onClick={() => act(detail, 'start')}>
                  <Play className="h-3.5 w-3.5" /> Start
                </GhostButton>
              ) : (
                <GhostButton onClick={() => act(detail, 'stop')}>
                  <Square className="h-3.5 w-3.5" /> Stop
                </GhostButton>
              )}
              <GhostButton onClick={() => act(detail, 'reboot')}>
                <RotateCw className="h-3.5 w-3.5" /> Reboot
              </GhostButton>
              <DangerButton onClick={() => act(detail, 'terminate')} confirmLabel="Confirm terminate">
                <Trash2 className="h-3.5 w-3.5" /> Terminate
              </DangerButton>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <CopyRow label="SSH command" value={detail.sshCommand} />
            <CopyRow label="Password" value={detail.sshPassword} secret />
            <CopyRow label="User" value={detail.sshUser} />
            <CopyRow label="Endpoint" value={`${detail.sshHost}:${detail.sshPort}`} />
          </div>
          <LogPane fetchLogs={() => vmLogs(instance, detail.id)} title="Console output" />
        </Card>
      ) : null}
    </PageShell>
  );
}

// ————— Containers (real tasks with public URL) —————

function parseEnvText(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

export function ContainersPage({ instance, notify }: PageProps) {
  const { data, error, swarmOnly, loading, refresh } = useComputeData(
    useCallback(() => listTasks(instance), [instance]),
  );
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [port, setPort] = useState('');
  const [replicas, setReplicas] = useState('1');
  const [plan, setPlan] = useState<ServicePlanId>('small');
  const [envText, setEnvText] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const tasks = data?.tasks ?? [];
  const detail = tasks.find((t) => t.name === selected) ?? null;

  const submit = async () => {
    setBusy(true);
    try {
      const body: Parameters<typeof createTask>[1] = {
        name: name.trim(),
        image: image.trim(),
        replicas: Number(replicas) || 1,
        plan,
      };
      if (port.trim()) body.port = Number(port);
      const env = parseEnvText(envText);
      if (Object.keys(env).length > 0) body.env = env;
      const task = await createTask(instance, body);
      notify(`Deploying ${task.name}${task.url ? ` → ${task.url}` : ''}`);
      setName('');
      setImage('');
      setPort('');
      setEnvText('');
      setShowCreate(false);
      setSelected(task.name);
      refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const scale = async (task: TaskInfo, delta: number) => {
    const next = Math.max(0, Math.min(10, task.replicas + delta));
    if (next === task.replicas) return;
    try {
      await updateTask(instance, task.name, { replicas: next });
      notify(`${task.name}: scaling to ${next} replicas`);
      refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    }
  };

  const act = async (task: TaskInfo, action: 'restart' | 'delete') => {
    try {
      await taskAction(instance, task.name, action);
      notify(`${task.name}: ${action} requested`);
      if (action === 'delete') setSelected(null);
      refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    }
  };

  if (swarmOnly) return <PageShell icon={Box} title="Containers" subtitle="Deploy any image with a public URL"><SwarmOnlyNote /></PageShell>;

  return (
    <PageShell
      icon={Box}
      title="Containers"
      subtitle="Deploy any container image — public HTTPS URL, replicas, logs"
      onRefresh={() => refresh()}
      actions={
        <PrimaryButton onClick={() => setShowCreate((v) => !v)}>
          <Plus className="h-4 w-4" /> Deploy container
        </PrimaryButton>
      }
    >
      {error && !swarmOnly ? <ErrorNote message={error} /> : null}
      <CreatePanel open={showCreate}>
        <div className="grid gap-3 sm:grid-cols-5">
          <label>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="api" />
          </label>
          <label>
            <Label>Image</Label>
            <Input value={image} onChange={(e) => setImage(e.target.value)} placeholder="nginx:alpine" />
          </label>
          <label>
            <Label>HTTP port (optional)</Label>
            <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="80" />
          </label>
          <label>
            <Label>Replicas</Label>
            <Input value={replicas} onChange={(e) => setReplicas(e.target.value)} placeholder="1" />
          </label>
          <label>
            <Label>Size</Label>
            <Select value={plan} onChange={(e) => setPlan(e.target.value as ServicePlanId)}>
              {TASK_PLANS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <label className="mt-3 block">
          <Label>Environment (KEY=value per line)</Label>
          <textarea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            rows={3}
            placeholder={'DATABASE_URL=postgres://…\nLOG_LEVEL=info'}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-stone-100 placeholder:text-stone-600 focus:border-amber-400/50 focus:outline-none"
          />
        </label>
        <div className="mt-3 flex justify-end">
          <PrimaryButton onClick={submit} disabled={busy || !name.trim() || !image.trim()}>
            {busy ? 'Deploying…' : 'Deploy'}
          </PrimaryButton>
        </div>
      </CreatePanel>

      <Card>
        {loading && tasks.length === 0 ? (
          <EmptyState text="Loading…" />
        ) : tasks.length === 0 ? (
          <EmptyState text="No containers yet. Deploy any public image and get an HTTPS URL instantly." />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <Th>Name</Th>
                <Th>State</Th>
                <Th>Image</Th>
                <Th>Size</Th>
                <Th>Replicas</Th>
                <Th>URL</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr
                  key={t.name}
                  onClick={() => setSelected(t.name === selected ? null : t.name)}
                  className={`cursor-pointer border-b border-white/5 last:border-0 hover:bg-white/[0.03] ${selected === t.name ? 'bg-amber-500/5' : ''}`}
                >
                  <Td className="font-medium text-stone-100">
                    {t.name}
                    {t.gitopsApp ? (
                      <span className="ml-2 rounded border border-sky-400/20 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300">
                        gitops
                      </span>
                    ) : null}
                  </Td>
                  <Td><StateDot state={t.state} /></Td>
                  <Td><Mono>{t.image}</Mono></Td>
                  <Td className="text-stone-400">{t.planLabel}</Td>
                  <Td>
                    {t.runningReplicas}/{t.replicas}
                  </Td>
                  <Td>
                    {t.url ? (
                      <a
                        href={t.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-amber-300 hover:underline"
                      >
                        {t.url.replace('https://', '')}
                      </a>
                    ) : (
                      <span className="text-stone-600">internal</span>
                    )}
                  </Td>
                  <Td className="text-stone-500">{timeAgo(t.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {detail ? (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-sm font-semibold text-stone-100">{detail.name}</p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-1 py-0.5">
                <button
                  type="button"
                  onClick={() => scale(detail, -1)}
                  className="rounded px-2 py-0.5 text-sm text-stone-300 hover:bg-white/10"
                >
                  −
                </button>
                <span className="px-1 text-xs text-stone-400">{detail.replicas} replicas</span>
                <button
                  type="button"
                  onClick={() => scale(detail, 1)}
                  className="rounded px-2 py-0.5 text-sm text-stone-300 hover:bg-white/10"
                >
                  +
                </button>
              </div>
              <GhostButton onClick={() => act(detail, 'restart')}>
                <RotateCw className="h-3.5 w-3.5" /> Restart
              </GhostButton>
              <DangerButton onClick={() => act(detail, 'delete')}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </DangerButton>
            </div>
          </div>
          {detail.url ? <CopyRow label="Public URL" value={detail.url} /> : null}
          {detail.gitopsApp ? (
            <p className="text-xs text-stone-500">
              Managed by GitOps app <Mono className="text-sky-300">{detail.gitopsApp}</Mono>
              {detail.gitopsRev ? (
                <>
                  {' '}
                  at <Mono>{detail.gitopsRev.slice(0, 10)}</Mono>
                </>
              ) : null}
            </p>
          ) : null}
          {Object.keys(detail.env).length > 0 ? (
            <div className="rounded-lg border border-white/5 bg-black/20 p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-stone-500">
                Environment
              </p>
              {Object.entries(detail.env).map(([k, v]) => (
                <p key={k} className="font-mono text-xs text-stone-400">
                  {k}=<span className="text-stone-300">{v}</span>
                </p>
              ))}
            </div>
          ) : null}
          <LogPane fetchLogs={() => taskLogs(instance, detail.name)} />
        </Card>
      ) : null}
    </PageShell>
  );
}

// ————— Databases —————

function dbSnippet(db: DbInfo): string {
  if (db.engine === 'postgres-16') {
    return `psql "${db.connectionUri}"`;
  }
  const host = db.externalHost ?? db.host;
  const port = db.externalPort ?? db.port;
  return `mysql -h ${host} -P ${port} -u ${db.user} -p'${db.password}' ${db.database}`;
}

export function DatabasesPage({ instance, notify }: PageProps) {
  const { data, error, swarmOnly, loading, refresh } = useComputeData(
    useCallback(() => listDatabases(instance), [instance]),
  );
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [engine, setEngine] = useState<DbEngineId>('postgres-16');
  const [plan, setPlan] = useState<ServicePlanId>('small');
  const [external, setExternal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const dbs = data?.databases ?? [];
  const detail = dbs.find((d) => d.name === selected) ?? null;

  const submit = async () => {
    setBusy(true);
    try {
      const db = await createDatabase(instance, { name: name.trim(), engine, plan, external });
      notify(`Database ${db.name} provisioning`);
      setName('');
      setShowCreate(false);
      setSelected(db.name);
      refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (db: DbInfo) => {
    try {
      await deleteDatabase(instance, db.name);
      notify(`Database ${db.name} deleted`);
      setSelected(null);
      refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    }
  };

  if (swarmOnly) return <PageShell icon={Database} title="Databases" subtitle="Managed PostgreSQL, MySQL & MariaDB"><SwarmOnlyNote /></PageShell>;

  return (
    <PageShell
      icon={Database}
      title="Databases"
      subtitle="Managed PostgreSQL, MySQL and MariaDB with persistent volumes"
      onRefresh={() => refresh()}
      actions={
        <PrimaryButton onClick={() => setShowCreate((v) => !v)}>
          <Plus className="h-4 w-4" /> Create database
        </PrimaryButton>
      }
    >
      {error && !swarmOnly ? <ErrorNote message={error} /> : null}
      <CreatePanel open={showCreate}>
        <div className="grid gap-3 sm:grid-cols-4">
          <label>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="app-db" />
          </label>
          <label>
            <Label>Engine</Label>
            <Select value={engine} onChange={(e) => setEngine(e.target.value as DbEngineId)}>
              {DB_ENGINES.map((e2) => (
                <option key={e2.id} value={e2.id}>
                  {e2.label}
                </option>
              ))}
            </Select>
          </label>
          <label>
            <Label>Size</Label>
            <Select value={plan} onChange={(e) => setPlan(e.target.value as ServicePlanId)}>
              {DB_PLANS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-end gap-2 pb-2">
            <input
              type="checkbox"
              checked={external}
              onChange={(e) => setExternal(e.target.checked)}
              className="h-4 w-4 accent-amber-500"
            />
            <span className="text-sm text-stone-300">Public endpoint (connect from anywhere)</span>
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <PrimaryButton onClick={submit} disabled={busy || !name.trim()}>
            {busy ? 'Provisioning…' : 'Create'}
          </PrimaryButton>
        </div>
      </CreatePanel>

      <Card>
        {loading && dbs.length === 0 ? (
          <EmptyState text="Loading…" />
        ) : dbs.length === 0 ? (
          <EmptyState text="No databases yet. Create one — connection string ready in seconds." />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <Th>Name</Th>
                <Th>State</Th>
                <Th>Engine</Th>
                <Th>Size</Th>
                <Th>Endpoint</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {dbs.map((db) => (
                <tr
                  key={db.name}
                  onClick={() => setSelected(db.name === selected ? null : db.name)}
                  className={`cursor-pointer border-b border-white/5 last:border-0 hover:bg-white/[0.03] ${selected === db.name ? 'bg-amber-500/5' : ''}`}
                >
                  <Td className="font-medium text-stone-100">{db.name}</Td>
                  <Td><StateDot state={db.state} /></Td>
                  <Td>{db.engineLabel}</Td>
                  <Td className="text-stone-400">{db.planLabel}</Td>
                  <Td>
                    <Mono>
                      {db.externalHost && db.externalPort
                        ? `${db.externalHost}:${db.externalPort}`
                        : `${db.host}:${db.port} (internal)`}
                    </Mono>
                  </Td>
                  <Td className="text-stone-500">{timeAgo(db.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {detail ? (
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display text-sm font-semibold text-stone-100">{detail.name}</p>
            <DangerButton onClick={() => remove(detail)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </DangerButton>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <CopyRow label="Connection URI" value={detail.connectionUri} secret />
            <CopyRow label="Password" value={detail.password} secret />
            <CopyRow label="User" value={detail.user} />
            <CopyRow label="Database" value={detail.database} />
          </div>
          <Snippet title="Connect from your terminal" code={dbSnippet(detail)} />
          <LogPane fetchLogs={() => databaseLogs(instance, detail.name)} />
        </Card>
      ) : null}
    </PageShell>
  );
}

// ————— Caches —————

export function CachesPage({ instance, notify }: PageProps) {
  const { data, error, swarmOnly, loading, refresh } = useComputeData(
    useCallback(() => listCaches(instance), [instance]),
  );
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [engine, setEngine] = useState<CacheEngineId>('redis-7');
  const [plan, setPlan] = useState<ServicePlanId>('small');
  const [external, setExternal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const caches = data?.caches ?? [];
  const detail = caches.find((c) => c.name === selected) ?? null;

  const submit = async () => {
    setBusy(true);
    try {
      const cache = await createCache(instance, { name: name.trim(), engine, plan, external });
      notify(`Cache ${cache.name} provisioning`);
      setName('');
      setShowCreate(false);
      setSelected(cache.name);
      refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (cache: CacheInfo) => {
    try {
      await deleteCache(instance, cache.name);
      notify(`Cache ${cache.name} deleted`);
      setSelected(null);
      refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    }
  };

  if (swarmOnly) return <PageShell icon={Zap} title="Cache" subtitle="Managed Redis & Valkey"><SwarmOnlyNote /></PageShell>;

  return (
    <PageShell
      icon={Zap}
      title="Cache"
      subtitle="Managed Redis and Valkey — password auth, optional public endpoint"
      onRefresh={() => refresh()}
      actions={
        <PrimaryButton onClick={() => setShowCreate((v) => !v)}>
          <Plus className="h-4 w-4" /> Create cache
        </PrimaryButton>
      }
    >
      {error && !swarmOnly ? <ErrorNote message={error} /> : null}
      <CreatePanel open={showCreate}>
        <div className="grid gap-3 sm:grid-cols-4">
          <label>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="sessions" />
          </label>
          <label>
            <Label>Engine</Label>
            <Select value={engine} onChange={(e) => setEngine(e.target.value as CacheEngineId)}>
              {CACHE_ENGINES.map((e2) => (
                <option key={e2.id} value={e2.id}>
                  {e2.label}
                </option>
              ))}
            </Select>
          </label>
          <label>
            <Label>Size</Label>
            <Select value={plan} onChange={(e) => setPlan(e.target.value as ServicePlanId)}>
              {CACHE_PLANS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-end gap-2 pb-2">
            <input
              type="checkbox"
              checked={external}
              onChange={(e) => setExternal(e.target.checked)}
              className="h-4 w-4 accent-amber-500"
            />
            <span className="text-sm text-stone-300">Public endpoint</span>
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <PrimaryButton onClick={submit} disabled={busy || !name.trim()}>
            {busy ? 'Provisioning…' : 'Create'}
          </PrimaryButton>
        </div>
      </CreatePanel>

      <Card>
        {loading && caches.length === 0 ? (
          <EmptyState text="Loading…" />
        ) : caches.length === 0 ? (
          <EmptyState text="No caches yet. Redis PING in under 10 seconds." />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <Th>Name</Th>
                <Th>State</Th>
                <Th>Engine</Th>
                <Th>Size</Th>
                <Th>Endpoint</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {caches.map((c) => (
                <tr
                  key={c.name}
                  onClick={() => setSelected(c.name === selected ? null : c.name)}
                  className={`cursor-pointer border-b border-white/5 last:border-0 hover:bg-white/[0.03] ${selected === c.name ? 'bg-amber-500/5' : ''}`}
                >
                  <Td className="font-medium text-stone-100">{c.name}</Td>
                  <Td><StateDot state={c.state} /></Td>
                  <Td>{c.engineLabel}</Td>
                  <Td className="text-stone-400">{c.planLabel}</Td>
                  <Td>
                    <Mono>
                      {c.externalHost && c.externalPort
                        ? `${c.externalHost}:${c.externalPort}`
                        : `${c.host}:${c.port} (internal)`}
                    </Mono>
                  </Td>
                  <Td className="text-stone-500">{timeAgo(c.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {detail ? (
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display text-sm font-semibold text-stone-100">{detail.name}</p>
            <DangerButton onClick={() => remove(detail)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </DangerButton>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <CopyRow label="Connection URI" value={detail.connectionUri} secret />
            <CopyRow label="Password" value={detail.password} secret />
          </div>
          <Snippet
            title="Test it"
            code={`redis-cli -u '${detail.connectionUri}' PING`}
          />
        </Card>
      ) : null}
    </PageShell>
  );
}

// ————— DNS (Route53-style zone) —————

export function DnsPage({ instance, notify }: PageProps) {
  const { data, error, swarmOnly, loading, refresh } = useComputeData(
    useCallback(() => listDns(instance), [instance]),
  );
  const [record, setRecord] = useState('');
  const [type, setType] = useState<DnsType>('ALIAS');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const records = data?.records ?? [];

  const submit = async () => {
    setBusy(true);
    try {
      const rec = await createDns(instance, { record: record.trim(), type, target: target.trim() });
      notify(
        rec.informational
          ? `${rec.fqdn} saved (informational — external resolvers won't serve it)`
          : `${rec.fqdn} live`,
      );
      setRecord('');
      setTarget('');
      refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (rec: DnsRecord) => {
    try {
      await deleteDns(instance, rec.record);
      notify(`${rec.fqdn} removed`);
      refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    }
  };

  if (swarmOnly) return <PageShell icon={Globe} title="DNS zone" subtitle="Per-workspace subdomain zone"><SwarmOnlyNote /></PageShell>;

  return (
    <PageShell
      icon={Globe}
      title="DNS zone"
      subtitle={`Your zone: *.${instance}.… — ALIAS records route traffic through the edge instantly`}
      onRefresh={() => refresh()}
    >
      {error && !swarmOnly ? <ErrorNote message={error} /> : null}
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <label>
            <Label>Record</Label>
            <Input value={record} onChange={(e) => setRecord(e.target.value)} placeholder="app" />
          </label>
          <label>
            <Label>Type</Label>
            <Select value={type} onChange={(e) => setType(e.target.value as DnsType)}>
              {DNS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </label>
          <label className="sm:col-span-2">
            <Label>Target</Label>
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={type === 'ALIAS' ? 'task:api or https://example.com' : 'value'}
            />
          </label>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-xs text-stone-500">
            ALIAS records are served immediately by the edge. A/CNAME/TXT/MX are stored for zone
            export.
          </p>
          <PrimaryButton onClick={submit} disabled={busy || !record.trim() || !target.trim()}>
            {busy ? 'Saving…' : 'Add record'}
          </PrimaryButton>
        </div>
      </Card>

      <Card>
        {loading && records.length === 0 ? (
          <EmptyState text="Loading…" />
        ) : records.length === 0 ? (
          <EmptyState text="No records yet. Add an ALIAS pointing to a container task or any URL." />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <Th>FQDN</Th>
                <Th>Type</Th>
                <Th>Target</Th>
                <Th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {records.map((rec) => (
                <tr key={rec.record} className="border-b border-white/5 last:border-0">
                  <Td>
                    <span className="inline-flex items-center gap-1">
                      <Mono className="text-stone-100">{rec.fqdn}</Mono>
                      <CopyButton value={rec.fqdn} />
                    </span>
                  </Td>
                  <Td>
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                        rec.informational
                          ? 'border-stone-500/30 bg-stone-500/10 text-stone-400'
                          : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300'
                      }`}
                    >
                      {rec.type}
                      {rec.informational ? ' · info' : ' · live'}
                    </span>
                  </Td>
                  <Td><Mono>{rec.target}</Mono></Td>
                  <Td>
                    <DangerButton onClick={() => remove(rec)} confirmLabel="Confirm">
                      <Trash2 className="h-3.5 w-3.5" />
                    </DangerButton>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </PageShell>
  );
}

// ————— API Gateway —————

function RoutesEditor({
  routes,
  onChange,
}: {
  routes: GatewayRoute[];
  onChange: (routes: GatewayRoute[]) => void;
}) {
  return (
    <div className="space-y-2">
      {routes.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={r.path}
            onChange={(e) =>
              onChange(routes.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))
            }
            placeholder="/api/*"
            className="!w-40"
          />
          <span className="text-stone-600">→</span>
          <Input
            value={r.target}
            onChange={(e) =>
              onChange(routes.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))
            }
            placeholder="task:api · svc:host:port · https://…"
          />
          <button
            type="button"
            onClick={() => onChange(routes.filter((_, j) => j !== i))}
            className="rounded-md p-1.5 text-stone-500 hover:bg-white/10 hover:text-rose-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <GhostButton onClick={() => onChange([...routes, { path: '', target: '' }])}>
        <Plus className="h-3.5 w-3.5" /> Add route
      </GhostButton>
    </div>
  );
}

export function GatewaysPage({ instance, notify }: PageProps) {
  const { data, error, swarmOnly, loading, refresh } = useComputeData(
    useCallback(() => listGateways(instance), [instance]),
  );
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [newRoutes, setNewRoutes] = useState<GatewayRoute[]>([{ path: '/*', target: '' }]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [editRoutes, setEditRoutes] = useState<GatewayRoute[] | null>(null);

  const gateways = data?.gateways ?? [];
  const detail = gateways.find((g) => g.name === selected) ?? null;

  useEffect(() => {
    setEditRoutes(detail ? detail.routes.map((r) => ({ ...r })) : null);
  }, [detail?.name]);

  const cleanRoutes = (routes: GatewayRoute[]) =>
    routes.filter((r) => r.path.trim() && r.target.trim());

  const submit = async () => {
    setBusy(true);
    try {
      const gw = await createGateway(instance, { name: name.trim(), routes: cleanRoutes(newRoutes) });
      notify(`Gateway ${gw.name} live at ${gw.url}`);
      setName('');
      setNewRoutes([{ path: '/*', target: '' }]);
      setShowCreate(false);
      setSelected(gw.name);
      refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const saveRoutes = async () => {
    if (!detail || !editRoutes) return;
    setBusy(true);
    try {
      await updateGateway(instance, detail.name, cleanRoutes(editRoutes));
      notify(`Gateway ${detail.name} routes updated`);
      refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (gw: GatewayInfo) => {
    try {
      await deleteGateway(instance, gw.name);
      notify(`Gateway ${gw.name} deleted`);
      setSelected(null);
      refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    }
  };

  if (swarmOnly) return <PageShell icon={Activity} title="API Gateway" subtitle="Path-based routing with HTTPS"><SwarmOnlyNote /></PageShell>;

  return (
    <PageShell
      icon={Activity}
      title="API Gateway"
      subtitle="Route paths to container tasks, internal services or external URLs — HTTPS included"
      onRefresh={() => refresh()}
      actions={
        <PrimaryButton onClick={() => setShowCreate((v) => !v)}>
          <Plus className="h-4 w-4" /> Create gateway
        </PrimaryButton>
      }
    >
      {error && !swarmOnly ? <ErrorNote message={error} /> : null}
      <CreatePanel open={showCreate}>
        <label className="block">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="main" className="sm:!w-64" />
        </label>
        <div className="mt-3">
          <Label>Routes (first match wins)</Label>
          <RoutesEditor routes={newRoutes} onChange={setNewRoutes} />
        </div>
        <div className="mt-3 flex justify-end">
          <PrimaryButton
            onClick={submit}
            disabled={busy || !name.trim() || cleanRoutes(newRoutes).length === 0}
          >
            {busy ? 'Creating…' : 'Create'}
          </PrimaryButton>
        </div>
      </CreatePanel>

      <Card>
        {loading && gateways.length === 0 ? (
          <EmptyState text="Loading…" />
        ) : gateways.length === 0 ? (
          <EmptyState text="No gateways yet. Compose one URL out of many backends." />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <Th>Name</Th>
                <Th>State</Th>
                <Th>URL</Th>
                <Th>Routes</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {gateways.map((gw) => (
                <tr
                  key={gw.name}
                  onClick={() => setSelected(gw.name === selected ? null : gw.name)}
                  className={`cursor-pointer border-b border-white/5 last:border-0 hover:bg-white/[0.03] ${selected === gw.name ? 'bg-amber-500/5' : ''}`}
                >
                  <Td className="font-medium text-stone-100">{gw.name}</Td>
                  <Td><StateDot state={gw.state} /></Td>
                  <Td>
                    <a
                      href={gw.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-amber-300 hover:underline"
                    >
                      {gw.url.replace('https://', '')}
                    </a>
                  </Td>
                  <Td>{gw.routes.length}</Td>
                  <Td className="text-stone-500">{timeAgo(gw.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {detail && editRoutes ? (
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display text-sm font-semibold text-stone-100">{detail.name}</p>
            <div className="flex gap-2">
              <PrimaryButton onClick={saveRoutes} disabled={busy}>
                Save routes
              </PrimaryButton>
              <DangerButton onClick={() => remove(detail)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </DangerButton>
            </div>
          </div>
          <CopyRow label="Gateway URL" value={detail.url} />
          <RoutesEditor routes={editRoutes} onChange={setEditRoutes} />
          <Snippet title="Test" code={`curl -s ${detail.url}${detail.routes[0]?.path.replace('*', '') ?? '/'}`} />
        </Card>
      ) : null}
    </PageShell>
  );
}

// ————— CDN (Varnish) —————

export function CdnPage({ instance, notify }: PageProps) {
  const { data, error, swarmOnly, loading, refresh } = useComputeData(
    useCallback(() => listCdns(instance), [instance]),
  );
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState('');
  const [ttl, setTtl] = useState('120');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const cdns = data?.cdns ?? [];
  const detail = cdns.find((c) => c.name === selected) ?? null;

  const submit = async () => {
    setBusy(true);
    try {
      const cdn = await createCdn(instance, {
        name: name.trim(),
        origin: origin.trim(),
        ttlSeconds: Number(ttl) || 120,
      });
      notify(`CDN ${cdn.name} live at ${cdn.url}`);
      setName('');
      setOrigin('');
      setShowCreate(false);
      setSelected(cdn.name);
      refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const purge = async (cdn: CdnInfo) => {
    try {
      await purgeCdn(instance, cdn.name);
      notify(`${cdn.name}: cache purged`);
    } catch (err) {
      notify(errMsg(err), 'err');
    }
  };

  const remove = async (cdn: CdnInfo) => {
    try {
      await deleteCdn(instance, cdn.name);
      notify(`CDN ${cdn.name} deleted`);
      setSelected(null);
      refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    }
  };

  if (swarmOnly) return <PageShell icon={HardDrive} title="CDN" subtitle="Varnish edge cache"><SwarmOnlyNote /></PageShell>;

  return (
    <PageShell
      icon={HardDrive}
      title="CDN"
      subtitle="Varnish 7 edge cache in front of any origin — real X-Cache HIT/MISS"
      onRefresh={() => refresh()}
      actions={
        <PrimaryButton onClick={() => setShowCreate((v) => !v)}>
          <Plus className="h-4 w-4" /> Create distribution
        </PrimaryButton>
      }
    >
      {error && !swarmOnly ? <ErrorNote message={error} /> : null}
      <CreatePanel open={showCreate}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="assets" />
          </label>
          <label>
            <Label>Origin</Label>
            <Input
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="task:web or https://origin.example.com"
            />
          </label>
          <label>
            <Label>TTL (seconds)</Label>
            <Input value={ttl} onChange={(e) => setTtl(e.target.value)} placeholder="120" />
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <PrimaryButton onClick={submit} disabled={busy || !name.trim() || !origin.trim()}>
            {busy ? 'Creating…' : 'Create'}
          </PrimaryButton>
        </div>
      </CreatePanel>

      <Card>
        {loading && cdns.length === 0 ? (
          <EmptyState text="Loading…" />
        ) : cdns.length === 0 ? (
          <EmptyState text="No distributions yet. Put Varnish in front of any origin in one step." />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <Th>Name</Th>
                <Th>State</Th>
                <Th>URL</Th>
                <Th>Origin</Th>
                <Th>TTL</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {cdns.map((c) => (
                <tr
                  key={c.name}
                  onClick={() => setSelected(c.name === selected ? null : c.name)}
                  className={`cursor-pointer border-b border-white/5 last:border-0 hover:bg-white/[0.03] ${selected === c.name ? 'bg-amber-500/5' : ''}`}
                >
                  <Td className="font-medium text-stone-100">{c.name}</Td>
                  <Td><StateDot state={c.state} /></Td>
                  <Td>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-amber-300 hover:underline"
                    >
                      {c.url.replace('https://', '')}
                    </a>
                  </Td>
                  <Td><Mono>{c.origin}</Mono></Td>
                  <Td>{c.ttlSeconds}s</Td>
                  <Td className="text-stone-500">{timeAgo(c.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {detail ? (
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display text-sm font-semibold text-stone-100">{detail.name}</p>
            <div className="flex gap-2">
              <GhostButton onClick={() => purge(detail)}>
                <RotateCw className="h-3.5 w-3.5" /> Purge cache
              </GhostButton>
              <DangerButton onClick={() => remove(detail)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </DangerButton>
            </div>
          </div>
          <CopyRow label="CDN URL" value={detail.url} />
          <Snippet
            title="See the cache work"
            code={[
              `curl -sI ${detail.url} | grep -i x-cache   # first: MISS`,
              `curl -sI ${detail.url} | grep -i x-cache   # then: HIT`,
            ].join('\n')}
          />
        </Card>
      ) : null}
    </PageShell>
  );
}

// ————— Observability (LGTM + OTel) —————

export function ObservabilityPage({ instance, notify }: PageProps) {
  const { data, error, swarmOnly, loading, refresh } = useComputeData(
    useCallback(() => getObservability(instance), [instance]),
  );
  const [busy, setBusy] = useState(false);
  const obs: ObsInfo | null = data?.observability ?? null;

  const enable = async () => {
    setBusy(true);
    try {
      await enableObservability(instance);
      notify('Observability stack deploying — Grafana ready in ~60s');
      refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await disableObservability(instance);
      notify('Observability stack removed');
      refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  if (swarmOnly) return <PageShell icon={Activity} title="Observability" subtitle="LGTM stack + OpenTelemetry"><SwarmOnlyNote /></PageShell>;

  return (
    <PageShell
      icon={Activity}
      title="Observability"
      subtitle="Grafana + Loki + Tempo + Mimir + OTel Collector — logs auto-discovered, zero config"
      onRefresh={() => refresh()}
    >
      {error && !swarmOnly ? <ErrorNote message={error} /> : null}
      {loading && !obs ? (
        <Card><EmptyState text="Loading…" /></Card>
      ) : !obs ? (
        <Card className="p-8 text-center">
          <Activity className="mx-auto h-10 w-10 text-amber-300/60" />
          <p className="mt-3 font-display text-base font-semibold text-stone-100">
            One click. Full LGTM stack.
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">
            Logs from every container in this workspace are discovered automatically. Metrics are
            scraped from tasks that declare a metrics port. Traces flow in via OTLP — endpoint and
            env vars injected into your containers for you.
          </p>
          <PrimaryButton onClick={enable} disabled={busy} className="mt-4">
            {busy ? 'Deploying…' : 'Enable observability'}
          </PrimaryButton>
        </Card>
      ) : (
        <>
          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <StateDot state={obs.state} />
              <DangerButton onClick={disable} disabled={busy} confirmLabel="Confirm disable">
                <Trash2 className="h-3.5 w-3.5" /> Disable
              </DangerButton>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <CopyRow label="Grafana" value={obs.grafanaUrl} />
              <CopyRow label="Grafana login" value={`${obs.grafanaUser} / ${obs.grafanaPassword}`} secret />
              <CopyRow label="OTLP endpoint (public)" value={obs.otlpUrl} />
              <CopyRow label="OTLP endpoint (in-cluster)" value={obs.otlpInternal} />
            </div>
            <a
              href={obs.grafanaUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-500/25 hover:brightness-110"
            >
              Open Grafana →
            </a>
          </Card>
          <Card className="space-y-3 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
              How data gets in — automatically
            </p>
            <ul className="space-y-1.5 text-sm text-stone-400">
              <li>
                <span className="text-emerald-300">Logs</span> — every container in this workspace is
                discovered by the node agents and shipped to Loki. Nothing to configure.
              </li>
              <li>
                <span className="text-sky-300">Metrics</span> — deploy a container with a metrics
                port and it is scraped automatically. {obs.scrapeTargets.length} target
                {obs.scrapeTargets.length === 1 ? '' : 's'} active.
              </li>
              <li>
                <span className="text-amber-300">Traces</span> — OTEL_EXPORTER_OTLP_ENDPOINT is
                injected into every container task. Instrument with any OTel SDK and traces appear
                in Tempo.
              </li>
            </ul>
            {obs.scrapeTargets.length > 0 ? (
              <div className="rounded-lg border border-white/5 bg-black/20 p-3">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-stone-500">
                  Metric scrape targets
                </p>
                {obs.scrapeTargets.map((t) => (
                  <p key={t.taskName} className="font-mono text-xs text-stone-400">
                    {t.taskName} → {t.serviceHost}:{t.port}
                    {t.path}
                  </p>
                ))}
              </div>
            ) : null}
            <Snippet
              title="Send traces from your app"
              code={[
                `export OTEL_EXPORTER_OTLP_ENDPOINT=${obs.otlpUrl}`,
                `export OTEL_SERVICE_NAME=my-app`,
                `# containers deployed here get these injected automatically`,
              ].join('\n')}
            />
          </Card>
        </>
      )}
    </PageShell>
  );
}

// ————— DevOps (Gitea + Woodpecker + GitOps) —————

const GITOPS_STATUS_STYLE: Record<string, string> = {
  Synced: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300',
  OutOfSync: 'border-amber-400/20 bg-amber-500/10 text-amber-300',
  Error: 'border-rose-400/20 bg-rose-500/10 text-rose-300',
  Unknown: 'border-stone-500/30 bg-stone-500/10 text-stone-400',
};

export function DevopsPage({ instance, notify }: PageProps) {
  const { data, error, swarmOnly, loading, refresh } = useComputeData(
    useCallback(() => getDevops(instance), [instance]),
  );
  const apps = useComputeData(useCallback(() => listGitopsApps(instance), [instance]));
  const [busy, setBusy] = useState(false);
  const [appName, setAppName] = useState('');
  const [appRepo, setAppRepo] = useState('');
  const [appBranch, setAppBranch] = useState('main');
  const [autoSync, setAutoSync] = useState(true);

  const status: DevopsStatus | null = data;
  const appList: GitopsApp[] = apps.data?.apps ?? [];

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      notify(okMsg);
      refresh(true);
      apps.refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  if (swarmOnly) return <PageShell icon={GitBranch} title="Sm4rt DevOps" subtitle="Git hosting, CI and GitOps"><SwarmOnlyNote /></PageShell>;

  return (
    <PageShell
      icon={GitBranch}
      title="Sm4rt DevOps"
      subtitle="Gitea repos + Woodpecker CI + pull-based GitOps — push code, watch it ship"
      onRefresh={() => {
        refresh();
        apps.refresh();
      }}
    >
      {error && !swarmOnly ? <ErrorNote message={error} /> : null}
      {loading && !status ? (
        <Card><EmptyState text="Loading…" /></Card>
      ) : !status?.enabled ? (
        <Card className="p-8 text-center">
          <GitBranch className="mx-auto h-10 w-10 text-amber-300/60" />
          <p className="mt-3 font-display text-base font-semibold text-stone-100">
            Your own DevOps platform, one click.
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">
            Git hosting with a built-in container registry, CI pipelines that run on the cluster,
            and a GitOps reconciler that deploys straight from your repo — Argo-style, pull-based.
          </p>
          <PrimaryButton onClick={() => run(() => enableDevops(instance), 'DevOps stack deploying — ready in ~60s')} disabled={busy} className="mt-4">
            {busy ? 'Deploying…' : 'Enable DevOps'}
          </PrimaryButton>
        </Card>
      ) : (
        <>
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StateDot state={status.state} />
              <div className="flex gap-2">
                {!status.bootstrapped ? (
                  <GhostButton
                    onClick={() =>
                      run(() => retryDevopsBootstrap(instance), 'Bootstrap retried')
                    }
                    disabled={busy}
                  >
                    <RotateCw className="h-3.5 w-3.5" /> Retry bootstrap
                  </GhostButton>
                ) : null}
                <DangerButton
                  onClick={() => run(() => disableDevops(instance), 'DevOps stack removed')}
                  disabled={busy}
                  confirmLabel="Confirm disable"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Disable
                </DangerButton>
              </div>
            </div>
            {status.message ? <p className="text-xs text-amber-300/80">{status.message}</p> : null}
            <div className="grid gap-2 sm:grid-cols-2">
              {status.gitUrl ? <CopyRow label="Git (Gitea)" value={status.gitUrl} /> : null}
              {status.ciUrl ? <CopyRow label="CI (Woodpecker)" value={status.ciUrl} /> : null}
              {status.adminUser && status.adminPassword ? (
                <CopyRow label="Admin login" value={`${status.adminUser} / ${status.adminPassword}`} secret />
              ) : null}
              {status.registry ? <CopyRow label="Container registry" value={status.registry} /> : null}
            </div>
            <div className="flex gap-2">
              {status.gitUrl ? (
                <a
                  href={status.gitUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-500/25 hover:brightness-110"
                >
                  Open Gitea →
                </a>
              ) : null}
              {status.ciUrl ? (
                <a
                  href={status.ciUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-stone-200 hover:border-white/20"
                >
                  Open CI →
                </a>
              ) : null}
            </div>
          </Card>

          <Card className="space-y-3 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
              GitOps applications
            </p>
            <div className="grid gap-3 sm:grid-cols-4">
              <label>
                <Label>App name</Label>
                <Input value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="web" />
              </label>
              <label>
                <Label>Repo (in your Gitea)</Label>
                <Input value={appRepo} onChange={(e) => setAppRepo(e.target.value)} placeholder="my-app" />
              </label>
              <label>
                <Label>Branch</Label>
                <Input value={appBranch} onChange={(e) => setAppBranch(e.target.value)} placeholder="main" />
              </label>
              <label className="flex items-end gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={autoSync}
                  onChange={(e) => setAutoSync(e.target.checked)}
                  className="h-4 w-4 accent-amber-500"
                />
                <span className="text-sm text-stone-300">Auto-sync</span>
              </label>
            </div>
            <div className="flex justify-end">
              <PrimaryButton
                onClick={() =>
                  run(
                    () =>
                      addGitopsApp(instance, {
                        name: appName.trim(),
                        repo: appRepo.trim(),
                        branch: appBranch.trim() || 'main',
                        autoSync,
                      }).then(() => {
                        setAppName('');
                        setAppRepo('');
                      }),
                    'GitOps app registered',
                  )
                }
                disabled={busy || !appName.trim() || !appRepo.trim()}
              >
                <Plus className="h-4 w-4" /> Add app
              </PrimaryButton>
            </div>

            {appList.length === 0 ? (
              <EmptyState text="No GitOps apps yet. Point one at a repo with deploy/sm4rt.yaml and push." />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5">
                    <Th>App</Th>
                    <Th>Repo</Th>
                    <Th>Status</Th>
                    <Th>Revision</Th>
                    <Th>Last sync</Th>
                    <Th className="w-40" />
                  </tr>
                </thead>
                <tbody>
                  {appList.map((app) => (
                    <tr key={app.name} className="border-b border-white/5 last:border-0">
                      <Td className="font-medium text-stone-100">
                        {app.name}
                        {app.autoSync ? (
                          <span className="ml-2 rounded border border-sky-400/20 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300">
                            auto
                          </span>
                        ) : null}
                      </Td>
                      <Td>
                        <Mono>
                          {app.repo}@{app.branch}
                        </Mono>
                      </Td>
                      <Td>
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${GITOPS_STATUS_STYLE[app.status ?? 'Unknown']}`}
                          title={app.lastError ?? undefined}
                        >
                          {app.status ?? 'Unknown'}
                        </span>
                      </Td>
                      <Td>
                        <Mono>{app.appliedRevision?.slice(0, 10) ?? '—'}</Mono>
                      </Td>
                      <Td className="text-stone-500">
                        {app.lastSyncAt ? timeAgo(app.lastSyncAt) : 'never'}
                      </Td>
                      <Td>
                        <div className="flex gap-1.5">
                          <GhostButton
                            onClick={() =>
                              run(() => syncGitopsApp(instance, app.name), `${app.name}: sync triggered`)
                            }
                            disabled={busy}
                            className="!px-2 !py-1 !text-xs"
                          >
                            Sync
                          </GhostButton>
                          <DangerButton
                            onClick={() =>
                              run(() => removeGitopsApp(instance, app.name), `${app.name} removed`)
                            }
                            confirmLabel="Confirm"
                          >
                            <Trash2 className="h-3 w-3" />
                          </DangerButton>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Snippet
              title="deploy/sm4rt.yaml — the whole contract"
              code={[
                'tasks:',
                '  - name: web',
                '    image: ${REGISTRY}/web:${COMMIT}',
                '    port: 8080',
                '    replicas: 2',
              ].join('\n')}
            />
          </Card>
        </>
      )}
    </PageShell>
  );
}

// ————— Container Registry (real registry:2, docker push) —————

export function RegistryPage({ instance, notify }: PageProps) {
  const { data, error, swarmOnly, loading, refresh } = useComputeData(
    useCallback(() => getRegistry(instance), [instance]),
  );
  const repos = useComputeData(
    useCallback(async () => {
      const status = await getRegistry(instance);
      if (!status.enabled || status.state !== 'running') return { repos: [] as RegistryRepo[] };
      return listRegistryRepos(instance);
    }, [instance]),
    15000,
  );
  const [busy, setBusy] = useState(false);
  const logs = useLogConsole();

  const status: RegistryStatus | null = data;
  const repoList: RegistryRepo[] = repos.data?.repos ?? [];

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      notify(okMsg);
      refresh(true);
      repos.refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  if (swarmOnly)
    return (
      <PageShell icon={Container} title="Container registry" subtitle="Private Docker registry">
        <SwarmOnlyNote />
      </PageShell>
    );

  const host = status?.host ?? '';
  const login = status?.user && status?.password
    ? `docker login ${host} -u ${status.user} -p ${status.password}`
    : '';

  return (
    <PageShell
      icon={Container}
      title="Container registry"
      subtitle="Private Docker registry with TLS — docker push straight from your laptop"
      onRefresh={() => {
        refresh();
        repos.refresh();
      }}
      actions={
        status?.enabled ? (
          <GhostButton
            onClick={() =>
              logs.open({
                instance,
                service: `sm4rt-registry-${instance}`,
                label: 'Container registry',
              })
            }
          >
            <ScrollText className="h-3.5 w-3.5" /> Logs
          </GhostButton>
        ) : null
      }
    >
      {error && !swarmOnly ? <ErrorNote message={error} /> : null}
      {loading && !status ? (
        <Card><EmptyState text="Loading…" /></Card>
      ) : !status?.enabled ? (
        <Card className="p-8 text-center">
          <Container className="mx-auto h-10 w-10 text-amber-300/60" />
          <p className="mt-3 font-display text-base font-semibold text-stone-100">
            Your own private registry, one click.
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">
            A real Docker registry served over HTTPS at your workspace domain — push, pull and
            browse images with the standard Docker CLI. Credentials generated automatically.
          </p>
          <PrimaryButton
            onClick={() => run(() => enableRegistry(instance), 'Registry deploying — ready in ~30s')}
            disabled={busy}
            className="mt-4"
          >
            {busy ? 'Deploying…' : 'Enable registry'}
          </PrimaryButton>
        </Card>
      ) : (
        <>
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StateDot state={status.state} />
              <DangerButton
                onClick={() => run(() => disableRegistry(instance), 'Registry removed')}
                disabled={busy}
                confirmLabel="Confirm disable"
              >
                <Trash2 className="h-3.5 w-3.5" /> Disable
              </DangerButton>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {status.url ? <CopyRow label="Registry URL" value={status.url} /> : null}
              {status.user ? <CopyRow label="Username" value={status.user} /> : null}
              {status.password ? <CopyRow label="Password" value={status.password} secret /> : null}
            </div>
          </Card>

          {host ? (
            <Card className="space-y-3 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
                Push an image
              </p>
              <div className="grid gap-2">
                <Snippet title="1 — Log in" code={login} />
                <Snippet title="2 — Tag" code={`docker tag alpine ${host}/alpine:v1`} />
                <Snippet title="3 — Push" code={`docker push ${host}/alpine:v1`} />
              </div>
            </Card>
          ) : null}

          <Card>
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
                Repositories
              </p>
              <GhostButton onClick={() => repos.refresh()} className="!px-2 !py-0.5 !text-xs">
                <RefreshCw className="h-3 w-3" />
              </GhostButton>
            </div>
            {repoList.length === 0 ? (
              <EmptyState text="No images yet — push one to see it here." />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5">
                    <Th>Repository</Th>
                    <Th>Tags</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {repoList.map((repo) => (
                    <tr key={repo.name}>
                      <Td><Mono className="text-stone-200">{repo.name}</Mono></Td>
                      <Td>
                        <div className="flex flex-wrap gap-1.5">
                          {repo.tags.length === 0 ? (
                            <span className="text-xs text-stone-600">no tags</span>
                          ) : (
                            repo.tags.map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-stone-300"
                              >
                                {tag}
                                <button
                                  type="button"
                                  title={`Delete ${repo.name}:${tag}`}
                                  onClick={() =>
                                    run(
                                      () => deleteRegistryTag(instance, repo.name, tag),
                                      `Deleted ${repo.name}:${tag}`,
                                    )
                                  }
                                  disabled={busy}
                                  className="text-stone-500 transition hover:text-rose-300 disabled:opacity-40"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </span>
                            ))
                          )}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </PageShell>
  );
}

export function ObjectStorePage({ instance, notify }: PageProps) {
  const { data, error, swarmOnly, loading, refresh } = useComputeData(
    useCallback(() => getObjectStore(instance), [instance]),
  );
  const buckets = useComputeData(
    useCallback(async () => {
      const status = await getObjectStore(instance);
      if (!status.enabled || status.state !== 'running') return { buckets: [] as BucketInfo[] };
      return listBuckets(instance);
    }, [instance]),
    15000,
  );
  const [busy, setBusy] = useState(false);
  const [newBucket, setNewBucket] = useState('');
  const logs = useLogConsole();

  const status: ObjectStoreStatus | null = data;
  const bucketList: BucketInfo[] = buckets.data?.buckets ?? [];

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      notify(okMsg);
      refresh(true);
      buckets.refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  if (swarmOnly)
    return (
      <PageShell icon={Archive} title="Object store" subtitle="S3-compatible buckets (MinIO)">
        <SwarmOnlyNote />
      </PageShell>
    );

  const endpoint = status?.url ?? '';

  return (
    <PageShell
      icon={Archive}
      title="Object store"
      subtitle="Real S3 API served by MinIO — aws cli, SDKs and mc work unchanged"
      onRefresh={() => {
        refresh();
        buckets.refresh();
      }}
      actions={
        status?.enabled ? (
          <GhostButton
            onClick={() =>
              logs.open({
                instance,
                service: `sm4rt-s3-${instance}`,
                label: 'Object store',
              })
            }
          >
            <ScrollText className="h-3.5 w-3.5" /> Logs
          </GhostButton>
        ) : null
      }
    >
      {error && !swarmOnly ? <ErrorNote message={error} /> : null}
      {loading && !status ? (
        <Card><EmptyState text="Loading…" /></Card>
      ) : !status?.enabled ? (
        <Card className="p-8 text-center">
          <Archive className="mx-auto h-10 w-10 text-amber-300/60" />
          <p className="mt-3 font-display text-base font-semibold text-stone-100">
            Real S3 buckets, one click.
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">
            A dedicated MinIO server at your workspace domain speaking the genuine S3 protocol —
            point the AWS CLI or any SDK at it and go. Credentials generated automatically.
          </p>
          <PrimaryButton
            onClick={() =>
              run(() => enableObjectStore(instance), 'Object store deploying — ready in ~30s')
            }
            disabled={busy}
            className="mt-4"
          >
            {busy ? 'Deploying…' : 'Enable object store'}
          </PrimaryButton>
        </Card>
      ) : (
        <>
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StateDot state={status.state} />
              <DangerButton
                onClick={() => run(() => disableObjectStore(instance), 'Object store removed')}
                disabled={busy}
                confirmLabel="Confirm disable"
              >
                <Trash2 className="h-3.5 w-3.5" /> Disable
              </DangerButton>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {status.url ? <CopyRow label="S3 endpoint" value={status.url} /> : null}
              {status.accessKey ? <CopyRow label="Access key" value={status.accessKey} /> : null}
              {status.secretKey ? <CopyRow label="Secret key" value={status.secretKey} secret /> : null}
            </div>
          </Card>

          {endpoint && status.accessKey ? (
            <Card className="space-y-3 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
                Use with the AWS CLI
              </p>
              <div className="grid gap-2">
                <Snippet
                  title="1 — Credentials"
                  code={`export AWS_ACCESS_KEY_ID=${status.accessKey}\nexport AWS_SECRET_ACCESS_KEY=${status.secretKey ?? ''}`}
                />
                <Snippet
                  title="2 — Make a bucket"
                  code={`aws --endpoint-url ${endpoint} s3 mb s3://my-bucket`}
                />
                <Snippet
                  title="3 — Copy files"
                  code={`aws --endpoint-url ${endpoint} s3 cp ./file.txt s3://my-bucket/`}
                />
              </div>
            </Card>
          ) : null}

          <Card>
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
                Buckets
              </p>
              <div className="flex items-center gap-2">
                <input
                  value={newBucket}
                  onChange={(e) => setNewBucket(e.target.value)}
                  placeholder="bucket-name"
                  className="w-44 rounded-lg border border-white/10 bg-stone-900 px-2.5 py-1 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
                />
                <GhostButton
                  onClick={() =>
                    run(async () => {
                      await createBucket(instance, newBucket.trim());
                      setNewBucket('');
                    }, `Bucket ${newBucket.trim()} created`)
                  }
                  disabled={busy || !newBucket.trim()}
                  className="!px-2 !py-0.5 !text-xs"
                >
                  <Plus className="h-3 w-3" /> Create
                </GhostButton>
                <GhostButton onClick={() => buckets.refresh()} className="!px-2 !py-0.5 !text-xs">
                  <RefreshCw className="h-3 w-3" />
                </GhostButton>
              </div>
            </div>
            {bucketList.length === 0 ? (
              <EmptyState text="No buckets yet — create one above or via the AWS CLI." />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5">
                    <Th>Bucket</Th>
                    <Th>Created</Th>
                    <Th> </Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {bucketList.map((bucket) => (
                    <tr key={bucket.name}>
                      <Td><Mono className="text-stone-200">{bucket.name}</Mono></Td>
                      <Td className="text-xs text-stone-500">
                        {bucket.createdAt ? new Date(bucket.createdAt).toLocaleString() : '—'}
                      </Td>
                      <Td className="text-right">
                        <button
                          type="button"
                          title={`Delete ${bucket.name}`}
                          onClick={() =>
                            run(
                              () => deleteBucket(instance, bucket.name),
                              `Bucket ${bucket.name} deleted`,
                            )
                          }
                          disabled={busy}
                          className="text-stone-500 transition hover:text-rose-300 disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </PageShell>
  );
}

export function TableStorePage({ instance, notify }: PageProps) {
  const { data, error, swarmOnly, loading, refresh } = useComputeData(
    useCallback(() => getTableStore(instance), [instance]),
  );
  const tables = useComputeData(
    useCallback(async () => {
      const status = await getTableStore(instance);
      if (!status.enabled || status.state !== 'running') return { tables: [] as TableInfo[] };
      return listTables(instance);
    }, [instance]),
    15000,
  );
  const [busy, setBusy] = useState(false);
  const [newTable, setNewTable] = useState('');
  const [hashKey, setHashKey] = useState('id');
  const logs = useLogConsole();

  const status: TableStoreStatus | null = data;
  const tableList: TableInfo[] = tables.data?.tables ?? [];

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      notify(okMsg);
      refresh(true);
      tables.refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  if (swarmOnly)
    return (
      <PageShell icon={Database} title="Table store" subtitle="DynamoDB-compatible tables (ScyllaDB)">
        <SwarmOnlyNote />
      </PageShell>
    );

  const endpoint = status?.url ?? '';

  return (
    <PageShell
      icon={Database}
      title="Table store"
      subtitle="Real DynamoDB wire protocol served by ScyllaDB Alternator"
      onRefresh={() => {
        refresh();
        tables.refresh();
      }}
      actions={
        status?.enabled ? (
          <GhostButton
            onClick={() =>
              logs.open({
                instance,
                service: `sm4rt-ddb-${instance}`,
                label: 'Table store',
              })
            }
          >
            <ScrollText className="h-3.5 w-3.5" /> Logs
          </GhostButton>
        ) : null
      }
    >
      {error && !swarmOnly ? <ErrorNote message={error} /> : null}
      {loading && !status ? (
        <Card><EmptyState text="Loading…" /></Card>
      ) : !status?.enabled ? (
        <Card className="p-8 text-center">
          <Database className="mx-auto h-10 w-10 text-amber-300/60" />
          <p className="mt-3 font-display text-base font-semibold text-stone-100">
            Real DynamoDB tables, one click.
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">
            A dedicated ScyllaDB node speaking the genuine DynamoDB protocol (Alternator) — point
            any AWS SDK or the CLI at your workspace endpoint and go.
          </p>
          <PrimaryButton
            onClick={() =>
              run(() => enableTableStore(instance), 'Table store deploying — ready in ~60s')
            }
            disabled={busy}
            className="mt-4"
          >
            {busy ? 'Deploying…' : 'Enable table store'}
          </PrimaryButton>
        </Card>
      ) : (
        <>
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StateDot state={status.state} />
              <DangerButton
                onClick={() => run(() => disableTableStore(instance), 'Table store removed')}
                disabled={busy}
                confirmLabel="Confirm disable"
              >
                <Trash2 className="h-3.5 w-3.5" /> Disable
              </DangerButton>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {status.url ? <CopyRow label="DynamoDB endpoint" value={status.url} /> : null}
              {status.accessKey ? <CopyRow label="Access key" value={status.accessKey} /> : null}
              {status.secretKey ? <CopyRow label="Secret key" value={status.secretKey} secret /> : null}
            </div>
          </Card>

          {endpoint && status.accessKey && status.secretKey ? (
            <Card className="space-y-3 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
                Use with the AWS CLI
              </p>
              <div className="grid gap-2">
                <Snippet
                  title="1 — Credentials"
                  code={`export AWS_ACCESS_KEY_ID=${status.accessKey}\nexport AWS_SECRET_ACCESS_KEY='${status.secretKey}'`}
                />
                <Snippet
                  title="2 — List tables"
                  code={`aws --endpoint-url ${endpoint} dynamodb list-tables`}
                />
                <Snippet
                  title="3 — Put an item"
                  code={`aws --endpoint-url ${endpoint} dynamodb put-item --table-name my-table --item '{"id":{"S":"1"}}'`}
                />
              </div>
            </Card>
          ) : null}

          <Card>
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
                Tables
              </p>
              <div className="flex items-center gap-2">
                <input
                  value={newTable}
                  onChange={(e) => setNewTable(e.target.value)}
                  placeholder="table-name"
                  className="w-36 rounded-lg border border-white/10 bg-stone-900 px-2.5 py-1 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
                />
                <input
                  value={hashKey}
                  onChange={(e) => setHashKey(e.target.value)}
                  placeholder="partition key"
                  className="w-28 rounded-lg border border-white/10 bg-stone-900 px-2.5 py-1 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
                />
                <GhostButton
                  onClick={() =>
                    run(async () => {
                      await createTable(instance, {
                        name: newTable.trim(),
                        hashKey: hashKey.trim() || 'id',
                        hashType: 'S',
                      });
                      setNewTable('');
                    }, `Table ${newTable.trim()} created`)
                  }
                  disabled={busy || !newTable.trim()}
                  className="!px-2 !py-0.5 !text-xs"
                >
                  <Plus className="h-3 w-3" /> Create
                </GhostButton>
                <GhostButton onClick={() => tables.refresh()} className="!px-2 !py-0.5 !text-xs">
                  <RefreshCw className="h-3 w-3" />
                </GhostButton>
              </div>
            </div>
            {tableList.length === 0 ? (
              <EmptyState text="No tables yet — create one above or via the AWS CLI." />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5">
                    <Th>Table</Th>
                    <Th>Key schema</Th>
                    <Th>Status</Th>
                    <Th> </Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {tableList.map((table) => (
                    <tr key={table.name}>
                      <Td><Mono className="text-stone-200">{table.name}</Mono></Td>
                      <Td>
                        <div className="flex flex-wrap gap-1.5">
                          {table.keySchema.map((k) => (
                            <span
                              key={k.attribute}
                              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-stone-300"
                            >
                              {k.attribute} · {k.type} · {k.role}
                            </span>
                          ))}
                        </div>
                      </Td>
                      <Td className="text-xs text-stone-500">{table.status ?? '—'}</Td>
                      <Td className="text-right">
                        <button
                          type="button"
                          title={`Delete ${table.name}`}
                          onClick={() =>
                            run(() => deleteTable(instance, table.name), `Table ${table.name} deleted`)
                          }
                          disabled={busy}
                          className="text-stone-500 transition hover:text-rose-300 disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </PageShell>
  );
}

export function BrokerPage({ instance, notify }: PageProps) {
  const { data, error, swarmOnly, loading, refresh } = useComputeData(
    useCallback(() => getBroker(instance), [instance]),
  );
  const queues = useComputeData(
    useCallback(async () => {
      const status = await getBroker(instance);
      if (!status.enabled || status.state !== 'running') return { queues: [] as QueueInfo[] };
      return listQueues(instance);
    }, [instance]),
    15000,
  );
  const [busy, setBusy] = useState(false);
  const [newQueue, setNewQueue] = useState('');
  const logs = useLogConsole();

  const status: BrokerStatus | null = data;
  const queueList: QueueInfo[] = queues.data?.queues ?? [];

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      notify(okMsg);
      refresh(true);
      queues.refresh(true);
    } catch (err) {
      notify(errMsg(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  if (swarmOnly)
    return (
      <PageShell icon={Box} title="Message broker" subtitle="Real RabbitMQ per workspace">
        <SwarmOnlyNote />
      </PageShell>
    );

  return (
    <PageShell
      icon={Box}
      title="Message broker"
      subtitle="Real RabbitMQ — AMQP endpoint + management UI at your workspace domain"
      onRefresh={() => {
        refresh();
        queues.refresh();
      }}
      actions={
        status?.enabled ? (
          <GhostButton
            onClick={() =>
              logs.open({ instance, service: `sm4rt-mq-${instance}`, label: 'Message broker' })
            }
          >
            <ScrollText className="h-3.5 w-3.5" /> Logs
          </GhostButton>
        ) : null
      }
    >
      {error && !swarmOnly ? <ErrorNote message={error} /> : null}
      {loading && !status ? (
        <Card><EmptyState text="Loading…" /></Card>
      ) : !status?.enabled ? (
        <Card className="p-8 text-center">
          <Box className="mx-auto h-10 w-10 text-amber-300/60" />
          <p className="mt-3 font-display text-base font-semibold text-stone-100">
            A real message broker, one click.
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">
            Dedicated RabbitMQ with a public AMQP endpoint and the full management UI — pika,
            amqplib, Spring AMQP and friends connect unchanged.
          </p>
          <PrimaryButton
            onClick={() => run(() => enableBroker(instance), 'Broker deploying — ready in ~30s')}
            disabled={busy}
            className="mt-4"
          >
            {busy ? 'Deploying…' : 'Enable broker'}
          </PrimaryButton>
        </Card>
      ) : (
        <>
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StateDot state={status.state} />
              <DangerButton
                onClick={() => run(() => disableBroker(instance), 'Broker removed')}
                disabled={busy}
                confirmLabel="Confirm disable"
              >
                <Trash2 className="h-3.5 w-3.5" /> Disable
              </DangerButton>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {status.amqpUrl ? <CopyRow label="AMQP URL" value={status.amqpUrl} secret /> : null}
              {status.managementUrl ? (
                <CopyRow label="Management UI" value={status.managementUrl} />
              ) : null}
              {status.user ? <CopyRow label="Username" value={status.user} /> : null}
              {status.password ? <CopyRow label="Password" value={status.password} secret /> : null}
            </div>
          </Card>

          {status.amqpUrl ? (
            <Card className="space-y-3 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
                Publish & consume
              </p>
              <div className="grid gap-2">
                <Snippet
                  title="Python (pika)"
                  code={`import pika\nconn = pika.BlockingConnection(pika.URLParameters('${status.amqpUrl}'))\nch = conn.channel()\nch.basic_publish(exchange='', routing_key='jobs', body=b'hello')`}
                />
                <Snippet
                  title="Node (amqplib)"
                  code={`const amqp = require('amqplib');\nconst conn = await amqp.connect('${status.amqpUrl}');`}
                />
              </div>
            </Card>
          ) : null}

          <Card>
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
                Queues
              </p>
              <div className="flex items-center gap-2">
                <input
                  value={newQueue}
                  onChange={(e) => setNewQueue(e.target.value)}
                  placeholder="queue-name"
                  className="w-44 rounded-lg border border-white/10 bg-stone-900 px-2.5 py-1 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
                />
                <GhostButton
                  onClick={() =>
                    run(async () => {
                      await createQueue(instance, newQueue.trim());
                      setNewQueue('');
                    }, `Queue ${newQueue.trim()} created`)
                  }
                  disabled={busy || !newQueue.trim()}
                  className="!px-2 !py-0.5 !text-xs"
                >
                  <Plus className="h-3 w-3" /> Create
                </GhostButton>
                <GhostButton onClick={() => queues.refresh()} className="!px-2 !py-0.5 !text-xs">
                  <RefreshCw className="h-3 w-3" />
                </GhostButton>
              </div>
            </div>
            {queueList.length === 0 ? (
              <EmptyState text="No queues yet — create one above or via AMQP." />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5">
                    <Th>Queue</Th>
                    <Th>Messages</Th>
                    <Th>Consumers</Th>
                    <Th>State</Th>
                    <Th> </Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {queueList.map((queue) => (
                    <tr key={`${queue.vhost}/${queue.name}`}>
                      <Td><Mono className="text-stone-200">{queue.name}</Mono></Td>
                      <Td className="font-mono text-xs">{queue.messages ?? '—'}</Td>
                      <Td className="font-mono text-xs">{queue.consumers ?? '—'}</Td>
                      <Td className="text-xs text-stone-500">{queue.state ?? '—'}</Td>
                      <Td className="text-right">
                        <button
                          type="button"
                          title={`Delete ${queue.name}`}
                          onClick={() =>
                            run(() => deleteQueue(instance, queue.name), `Queue ${queue.name} deleted`)
                          }
                          disabled={busy}
                          className="text-stone-500 transition hover:text-rose-300 disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </PageShell>
  );
}
