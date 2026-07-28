import {
  Archive,
  ArrowLeft,
  Bell,
  Database,
  Eye,
  ExternalLink,
  KeyRound,
  LayoutDashboard,
  ListTree,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
  Send,
  Server,
  Square,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  actOnResource,
  createResource,
  deleteInstance,
  deleteResource,
  getInstance,
  getLogs,
  listResources,
  type InstanceDetail,
  REGIONS,
  type Region,
  type ResourceItem,
  type ServiceId,
} from '../lib/api';
import { snippets, timeAgo, timeUntil } from '../lib/format';
import { CopyButton, GhostButton, PrimaryButton, StatusBadge } from './bits';

type SectionId = 'overview' | ServiceId | 'logs';

const NAV: { id: SectionId; label: string; icon: typeof Archive; group?: string }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 's3', label: 'Buckets', icon: Archive, group: 'Storage & data' },
  { id: 'dynamodb', label: 'Tables', icon: Database, group: 'Storage & data' },
  { id: 'secrets', label: 'Secrets', icon: KeyRound, group: 'Storage & data' },
  { id: 'sqs', label: 'Queues', icon: ListTree, group: 'Messaging' },
  { id: 'sns', label: 'Topics', icon: Bell, group: 'Messaging' },
  { id: 'ec2', label: 'Servers', icon: Server, group: 'Compute' },
  { id: 'lambda', label: 'Functions', icon: Zap, group: 'Compute' },
  { id: 'logs', label: 'Instance logs', icon: ScrollText, group: 'Diagnostics' },
];

const NODE_TEMPLATE = `export const handler = async (event) => {
  return { ok: true, echo: event };
};
`;

const PYTHON_TEMPLATE = `def lambda_handler(event, context):
    return {"ok": True, "echo": event}
`;

const RegionContext = createContext<Region>('us-east-1');

function useRegion(): Region {
  return useContext(RegionContext);
}

export default function Console({
  name,
  onBack,
  notify,
}: {
  name: string;
  onBack: () => void;
  notify: (message: string, tone?: 'ok' | 'err') => void;
}) {
  const [detail, setDetail] = useState<InstanceDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [section, setSection] = useState<SectionId>('overview');
  const [region, setRegion] = useState<Region>('us-east-1');

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getInstance(name)
        .then((data) => {
          if (!cancelled) {
            setDetail(data);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setMissing(true);
          }
        });
    };
    load();
    const timer = setInterval(load, 6000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [name]);

  const running = detail?.status === 'running';
  const groups: { title: string | null; items: typeof NAV }[] = [];
  for (const item of NAV) {
    const title = item.group ?? null;
    const bucket = groups.find((group) => group.title === title);
    if (bucket) {
      bucket.items.push(item);
    } else {
      groups.push({ title, items: [item] });
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl gap-6 px-6 py-6">
      <aside className="w-56 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-stone-400 transition hover:bg-white/5 hover:text-stone-100"
        >
          <ArrowLeft className="h-4 w-4" /> All instances
        </button>
        <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
          <p className="truncate font-display text-sm font-bold tracking-tight">{name}</p>
          {detail ? (
            <div className="mt-1">
              <StatusBadge status={detail.status} detail={detail.statusDetail} />
            </div>
          ) : null}
          <label className="mt-2 block">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-600">
              Region
            </span>
            <select
              value={region}
              onChange={(event) => setRegion(event.target.value as Region)}
              className="mt-0.5 w-full rounded-lg border border-white/10 bg-stone-950 px-2 py-1 text-xs text-stone-200 outline-none transition focus:border-amber-500/50"
            >
              {REGIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <nav className="space-y-4">
          {groups.map((group) => (
            <div key={group.title ?? 'root'}>
              {group.title ? (
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-stone-600">
                  {group.title}
                </p>
              ) : null}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const disabled = item.id !== 'overview' && item.id !== 'logs' && !running;
                  const active = section === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => setSection(item.id)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
                        active
                          ? 'bg-amber-500/15 font-medium text-amber-200'
                          : disabled
                            ? 'cursor-not-allowed text-stone-700'
                            : 'text-stone-400 hover:bg-white/5 hover:text-stone-100'
                      }`}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        {missing ? (
          <p className="mt-8 text-sm text-stone-400">This instance no longer exists.</p>
        ) : !detail ? (
          <div className="mt-8 h-40 animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]" />
        ) : section === 'overview' ? (
          <Overview detail={detail} notify={notify} onDeleted={onBack} />
        ) : section === 'logs' ? (
          <LogsView name={name} />
        ) : (
          <RegionContext.Provider value={region}>
            <ServiceView key={`${section}:${region}`} instance={name} service={section} notify={notify} />
          </RegionContext.Provider>
        )}
      </div>
    </div>
  );
}

function Overview({
  detail,
  notify,
  onDeleted,
}: {
  detail: InstanceDetail;
  notify: (message: string, tone?: 'ok' | 'err') => void;
  onDeleted: () => void;
}) {
  const [snippet, setSnippet] = useState('cli');
  const [confirming, setConfirming] = useState(false);
  const healthServices =
    detail.health &&
    typeof detail.health === 'object' &&
    detail.health.services &&
    typeof detail.health.services === 'object'
      ? Object.entries(detail.health.services as Record<string, unknown>)
      : [];

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-stone-500">
          AWS endpoint
        </h3>
        <div className="mt-2 flex items-center gap-1 rounded-xl border border-white/10 bg-black/30 py-1.5 pl-3 pr-1.5">
          <code className="min-w-0 flex-1 truncate font-mono text-sm text-amber-200/90">
            {detail.endpoint}
          </code>
          <a
            href={`${detail.endpoint}/_floci/health`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition hover:bg-white/10 hover:text-stone-100"
            aria-label="Open health endpoint"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <CopyButton value={detail.endpoint} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
            <dt className="text-xs text-stone-500">Created</dt>
            <dd className="mt-0.5 text-stone-200">{timeAgo(detail.createdAt)}</dd>
          </div>
          <div className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
            <dt className="text-xs text-stone-500">Expires</dt>
            <dd className="mt-0.5 text-stone-200">{timeUntil(detail.expiresAt)}</dd>
          </div>
          <div className="col-span-2 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 sm:col-span-1">
            <dt className="text-xs text-stone-500">Image</dt>
            <dd className="mt-0.5 truncate font-mono text-xs text-stone-200">{detail.image}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-stone-500">Connect</h3>
        <div className="mt-2 flex gap-1.5">
          {snippets(detail.endpoint).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSnippet(item.id)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                snippet === item.id
                  ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                  : 'border-white/10 bg-white/5 text-stone-400 hover:text-stone-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {snippets(detail.endpoint)
          .filter((item) => item.id === snippet)
          .map((item) => (
            <div key={item.id} className="relative mt-2">
              <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-xs leading-relaxed text-stone-200">
                {item.code}
              </pre>
              <CopyButton value={item.code} className="absolute right-2 top-2 bg-stone-900/80" />
            </div>
          ))}
      </section>

      {healthServices.length > 0 ? (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-stone-500">
            Emulated services
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {healthServices.map(([service, state]) => (
              <span
                key={service}
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 font-mono text-xs text-stone-300"
                title={String(state)}
              >
                {service}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-rose-500/20 bg-rose-500/[0.04] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-rose-200">Delete instance</h3>
            <p className="text-xs text-stone-400">
              Destroys the namespace, all emulated resources and the endpoint.
            </p>
          </div>
          {confirming ? (
            <div className="flex gap-2">
              <GhostButton onClick={() => setConfirming(false)}>Cancel</GhostButton>
              <button
                type="button"
                onClick={() => {
                  deleteInstance(detail.name)
                    .then(() => {
                      notify(`Deleting ${detail.name}`);
                      onDeleted();
                    })
                    .catch(() => notify(`Failed to delete ${detail.name}`, 'err'));
                }}
                className="rounded-lg bg-rose-500/90 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-500"
              >
                Confirm delete
              </button>
            </div>
          ) : (
            <GhostButton onClick={() => setConfirming(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </GhostButton>
          )}
        </div>
      </section>
    </div>
  );
}

function LogsView({ name }: { name: string }) {
  const [logs, setLogs] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLPreElement>(null);

  const refresh = useCallback(() => {
    setBusy(true);
    getLogs(name, 500)
      .then((data) => {
        setLogs(data.logs || 'no log output yet');
        requestAnimationFrame(() => {
          ref.current?.scrollTo({ top: ref.current.scrollHeight });
        });
      })
      .catch(() => setLogs('failed to fetch logs'))
      .finally(() => setBusy(false));
  }, [name]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold tracking-tight">Instance logs</h2>
        <GhostButton onClick={refresh} disabled={busy}>
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> Refresh
        </GhostButton>
      </div>
      <pre
        ref={ref}
        className="mt-3 max-h-[70vh] overflow-auto rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-[11px] leading-relaxed text-stone-300"
      >
        {logs || 'loading logs…'}
      </pre>
    </div>
  );
}

const SERVICE_META: Record<
  ServiceId,
  { title: string; noun: string; placeholder: string; hint?: string }
> = {
  s3: { title: 'Buckets', noun: 'bucket', placeholder: 'bucket name' },
  sqs: { title: 'Queues', noun: 'queue', placeholder: 'queue name' },
  sns: { title: 'Topics', noun: 'topic', placeholder: 'topic name' },
  dynamodb: {
    title: 'Tables',
    noun: 'table',
    placeholder: 'table name',
    hint: 'partition key "id" (string), on-demand billing',
  },
  ec2: {
    title: 'Servers',
    noun: 'server',
    placeholder: 'server name',
    hint: 't3.micro container-backed instance',
  },
  lambda: { title: 'Functions', noun: 'function', placeholder: 'function name' },
  secrets: { title: 'Secrets', noun: 'secret', placeholder: 'secret name' },
};

function ServiceView({
  instance,
  service,
  notify,
}: {
  instance: string;
  service: ServiceId;
  notify: (message: string, tone?: 'ok' | 'err') => void;
}) {
  const meta = SERVICE_META[service];
  const region = useRegion();
  const [items, setItems] = useState<ResourceItem[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState('');
  const [pendingDelete, setPendingDelete] = useState('');
  const [name, setName] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [runtime, setRuntime] = useState('nodejs20.x');
  const [code, setCode] = useState(NODE_TEMPLATE);

  const refresh = useCallback(() => {
    setError('');
    listResources(instance, service, region)
      .then((data) => setItems(data.resources))
      .catch((err) => {
        setItems([]);
        setError(err instanceof Error ? err.message : 'failed to load resources');
      });
  }, [instance, service, region]);

  useEffect(() => {
    refresh();
    if (service !== 'lambda' && service !== 'ec2') {
      return;
    }
    const timer = setInterval(refresh, 8000);
    return () => clearInterval(timer);
  }, [refresh, service]);

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) {
      return;
    }
    setBusy(true);
    setError('');
    createResource(instance, service, region, {
      name: trimmed,
      ...(service === 'secrets' ? { value: secretValue } : {}),
      ...(service === 'lambda' ? { runtime, code } : {}),
    })
      .then(() => {
        setName('');
        setSecretValue('');
        setCreating(false);
        notify(`${meta.noun} ${trimmed} created`);
        refresh();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'create failed'))
      .finally(() => setBusy(false));
  };

  const onDelete = (id: string) => {
    if (pendingDelete !== id) {
      setPendingDelete(id);
      setTimeout(() => setPendingDelete((current) => (current === id ? '' : current)), 4000);
      return;
    }
    setPendingDelete('');
    deleteResource(instance, service, region, id)
      .then(() => {
        notify(`${meta.noun} deleted`);
        refresh();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'delete failed'));
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold tracking-tight">{meta.title}</h2>
        <div className="flex gap-2">
          <GhostButton onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </GhostButton>
          <PrimaryButton onClick={() => setCreating((value) => !value)} className="px-3 py-1.5 text-xs">
            {creating ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {creating ? 'Close' : `New ${meta.noun}`}
          </PrimaryButton>
        </div>
      </div>
      {meta.hint ? <p className="mt-1 text-xs text-stone-500">{meta.hint}</p> : null}

      {creating ? (
        <form
          onSubmit={onCreate}
          className="mt-3 space-y-2 rounded-xl border border-amber-400/20 bg-amber-500/[0.04] p-3"
        >
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={meta.placeholder}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-sm text-stone-100 outline-none transition focus:border-amber-400/50"
            />
            {service === 'lambda' ? (
              <select
                value={runtime}
                onChange={(event) => {
                  setRuntime(event.target.value);
                  setCode(event.target.value.startsWith('python') ? PYTHON_TEMPLATE : NODE_TEMPLATE);
                }}
                className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-stone-200 outline-none"
              >
                <option value="nodejs20.x">nodejs20.x</option>
                <option value="python3.12">python3.12</option>
              </select>
            ) : null}
            <PrimaryButton type="submit" disabled={busy} className="px-3 py-1.5 text-xs">
              {busy ? 'Creating…' : 'Create'}
            </PrimaryButton>
          </div>
          {service === 'secrets' ? (
            <input
              value={secretValue}
              onChange={(event) => setSecretValue(event.target.value)}
              placeholder="secret value"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-sm text-stone-100 outline-none transition focus:border-amber-400/50"
            />
          ) : null}
          {service === 'lambda' ? (
            <textarea
              value={code}
              onChange={(event) => setCode(event.target.value)}
              rows={8}
              spellCheck={false}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs leading-relaxed text-stone-100 outline-none transition focus:border-amber-400/50"
            />
          ) : null}
        </form>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </p>
      ) : null}

      <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
        {items === null ? (
          <div className="h-24 animate-pulse bg-white/[0.03]" />
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-stone-500">
            No {meta.title.toLowerCase()} yet.
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {items.map((item) => (
              <li key={item.id}>
                <div
                  className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition hover:bg-white/[0.03]"
                  onClick={() => setExpanded(expanded === item.id ? '' : item.id)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm text-stone-100">{item.name}</p>
                    {item.detail ? (
                      <p className="truncate text-xs text-stone-500">{item.detail}</p>
                    ) : null}
                  </div>
                  {item.createdAt ? (
                    <span className="hidden text-xs text-stone-500 sm:block">
                      {timeAgo(item.createdAt)}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(item.id);
                    }}
                    className={`rounded-lg p-1.5 text-xs transition ${
                      pendingDelete === item.id
                        ? 'bg-rose-500/90 px-2 font-semibold text-white'
                        : 'text-stone-500 hover:bg-white/10 hover:text-rose-300'
                    }`}
                  >
                    {pendingDelete === item.id ? 'Confirm?' : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
                {expanded === item.id ? (
                  <div className="border-t border-white/5 bg-black/20 px-4 py-3">
                    <ResourceDetail
                      instance={instance}
                      service={service}
                      item={item}
                      notify={notify}
                      refresh={refresh}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ResourceDetail(props: {
  instance: string;
  service: ServiceId;
  item: ResourceItem;
  notify: (message: string, tone?: 'ok' | 'err') => void;
  refresh: () => void;
}) {
  switch (props.service) {
    case 's3':
      return <BucketObjects {...props} />;
    case 'sqs':
      return <QueueActions {...props} />;
    case 'sns':
      return <TopicActions {...props} />;
    case 'dynamodb':
      return <TableItems {...props} />;
    case 'ec2':
      return <ServerActions {...props} />;
    case 'lambda':
      return <FunctionActions {...props} />;
    case 'secrets':
      return <SecretActions {...props} />;
  }
}

interface DetailProps {
  instance: string;
  item: ResourceItem;
  notify: (message: string, tone?: 'ok' | 'err') => void;
  refresh: () => void;
}

function ActionError({ message }: { message: string }) {
  if (!message) {
    return null;
  }
  return (
    <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-200">
      {message}
    </p>
  );
}

function ResultBox({ children }: { children: ReactNode }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs leading-relaxed text-stone-200">
      {children}
    </pre>
  );
}

function BucketObjects({ instance, item, notify }: DetailProps) {
  const region = useRegion();
  const [objects, setObjects] = useState<
    { key?: string; size?: number; lastModified?: string }[] | null
  >(null);
  const [error, setError] = useState('');
  const [key, setKey] = useState('');
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState<{ key: string; content: string } | null>(null);

  const load = useCallback(() => {
    setError('');
    actOnResource<{ objects: { key?: string; size?: number; lastModified?: string }[] }>(
      instance,
      's3', region,
      item.id,
      'objects',
    )
      .then((data) => setObjects(data.result.objects))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to list objects'));
  }, [instance, item.id]);

  useEffect(() => {
    load();
  }, [load]);

  const upload = (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) {
      return;
    }
    actOnResource(instance, 's3', region, item.id, 'putObject', { key: key.trim(), content })
      .then(() => {
        notify(`object ${key.trim()} uploaded`);
        setKey('');
        setContent('');
        load();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'upload failed'));
  };

  return (
    <div className="space-y-3">
      <form onSubmit={upload} className="flex flex-wrap gap-2">
        <input
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="object key (e.g. docs/hello.txt)"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
        />
        <input
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="text content"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
        />
        <GhostButton type="submit">
          <Upload className="h-3.5 w-3.5" /> Put object
        </GhostButton>
      </form>
      <ActionError message={error} />
      {objects === null ? (
        <p className="text-xs text-stone-500">loading objects…</p>
      ) : objects.length === 0 ? (
        <p className="text-xs text-stone-500">bucket is empty</p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
          {objects.map((object) => (
            <li key={object.key} className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-stone-200">
                {object.key}
              </span>
              <span className="text-[10px] text-stone-500">{object.size ?? 0} B</span>
              <button
                type="button"
                onClick={() => {
                  actOnResource<{ key: string; content: string }>(
                    instance,
                    's3', region,
                    item.id,
                    'getObject',
                    { key: object.key },
                  )
                    .then((data) => setPreview(data.result))
                    .catch((err) =>
                      setError(err instanceof Error ? err.message : 'failed to read object'),
                    );
                }}
                className="rounded p-1 text-stone-500 transition hover:bg-white/10 hover:text-stone-100"
                aria-label="Preview object"
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  actOnResource(instance, 's3', region, item.id, 'deleteObject', { key: object.key })
                    .then(() => {
                      notify(`object ${object.key} deleted`);
                      load();
                    })
                    .catch((err) =>
                      setError(err instanceof Error ? err.message : 'delete failed'),
                    );
                }}
                className="rounded p-1 text-stone-500 transition hover:bg-white/10 hover:text-rose-300"
                aria-label="Delete object"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {preview ? (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="font-mono text-xs text-stone-400">{preview.key}</p>
            <GhostButton onClick={() => setPreview(null)}>
              <X className="h-3 w-3" /> Close
            </GhostButton>
          </div>
          <ResultBox>{preview.content || '(empty object)'}</ResultBox>
        </div>
      ) : null}
    </div>
  );
}

function QueueActions({ instance, item, notify }: DetailProps) {
  const region = useRegion();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<{ id?: string; body?: string }[] | null>(null);
  const [error, setError] = useState('');

  return (
    <div className="space-y-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!message.trim()) {
            return;
          }
          actOnResource(instance, 'sqs', region, item.id, 'send', { message })
            .then(() => {
              notify('message sent');
              setMessage('');
            })
            .catch((err) => setError(err instanceof Error ? err.message : 'send failed'));
        }}
        className="flex gap-2"
      >
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="message body"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
        />
        <GhostButton type="submit">
          <Send className="h-3.5 w-3.5" /> Send
        </GhostButton>
        <GhostButton
          onClick={() => {
            setError('');
            actOnResource<{ messages: { id?: string; body?: string }[] }>(
              instance,
              'sqs', region,
              item.id,
              'receive',
            )
              .then((data) => setMessages(data.result.messages))
              .catch((err) => setError(err instanceof Error ? err.message : 'receive failed'));
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" /> Poll
        </GhostButton>
        <GhostButton
          onClick={() => {
            actOnResource(instance, 'sqs', region, item.id, 'purge')
              .then(() => {
                notify('queue purged');
                setMessages(null);
              })
              .catch((err) => setError(err instanceof Error ? err.message : 'purge failed'));
          }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Purge
        </GhostButton>
      </form>
      <ActionError message={error} />
      {messages !== null ? (
        messages.length === 0 ? (
          <p className="text-xs text-stone-500">no messages available</p>
        ) : (
          <ul className="space-y-1.5">
            {messages.map((entry) => (
              <li
                key={entry.id}
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-200"
              >
                {entry.body}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function TopicActions({ instance, item, notify }: DetailProps) {
  const region = useRegion();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  return (
    <div className="space-y-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!message.trim()) {
            return;
          }
          actOnResource(instance, 'sns', region, item.id, 'publish', { message })
            .then(() => {
              notify('message published');
              setMessage('');
            })
            .catch((err) => setError(err instanceof Error ? err.message : 'publish failed'));
        }}
        className="flex gap-2"
      >
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="message to publish"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
        />
        <GhostButton type="submit">
          <Send className="h-3.5 w-3.5" /> Publish
        </GhostButton>
      </form>
      <ActionError message={error} />
    </div>
  );
}

function TableItems({ instance, item, notify }: DetailProps) {
  const region = useRegion();
  const [items, setItems] = useState<Record<string, unknown>[] | null>(null);
  const [json, setJson] = useState('{\n  "id": "item-1",\n  "value": "hello"\n}');
  const [error, setError] = useState('');

  const scan = useCallback(() => {
    setError('');
    actOnResource<{ items: Record<string, unknown>[] }>(instance, 'dynamodb', region, item.id, 'scan')
      .then((data) => setItems(data.result.items))
      .catch((err) => setError(err instanceof Error ? err.message : 'scan failed'));
  }, [instance, item.id]);

  useEffect(() => {
    scan();
  }, [scan]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <textarea
          value={json}
          onChange={(event) => setJson(event.target.value)}
          rows={4}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
        />
        <div className="flex flex-col gap-2">
          <GhostButton
            onClick={() => {
              actOnResource(instance, 'dynamodb', region, item.id, 'putItem', { item: json })
                .then(() => {
                  notify('item saved');
                  scan();
                })
                .catch((err) => setError(err instanceof Error ? err.message : 'put failed'));
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Put item
          </GhostButton>
          <GhostButton onClick={scan}>
            <RefreshCw className="h-3.5 w-3.5" /> Scan
          </GhostButton>
        </div>
      </div>
      <ActionError message={error} />
      {items === null ? (
        <p className="text-xs text-stone-500">scanning…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-stone-500">table is empty</p>
      ) : (
        <ResultBox>{JSON.stringify(items, null, 2)}</ResultBox>
      )}
    </div>
  );
}

function ServerActions({ instance, item, notify, refresh }: DetailProps) {
  const region = useRegion();
  const [error, setError] = useState('');
  const run = (action: 'start' | 'stop') => {
    setError('');
    actOnResource(instance, 'ec2', region, item.id, action)
      .then(() => {
        notify(`server ${action} requested`);
        setTimeout(refresh, 1200);
      })
      .catch((err) => setError(err instanceof Error ? err.message : `${action} failed`));
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <GhostButton onClick={() => run('start')}>
          <Play className="h-3.5 w-3.5" /> Start
        </GhostButton>
        <GhostButton onClick={() => run('stop')}>
          <Square className="h-3.5 w-3.5" /> Stop
        </GhostButton>
        <span className="self-center font-mono text-xs text-stone-500">{item.id}</span>
      </div>
      <ActionError message={error} />
    </div>
  );
}

function FunctionActions({ instance, item }: DetailProps) {
  const region = useRegion();
  const [payload, setPayload] = useState('{\n  "nome": "mundo"\n}');
  const [result, setResult] = useState<{
    statusCode?: number;
    functionError?: string | null;
    payload?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <textarea
          value={payload}
          onChange={(event) => setPayload(event.target.value)}
          rows={4}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
        />
        <GhostButton
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            actOnResource<{ statusCode?: number; functionError?: string | null; payload?: string }>(
              instance,
              'lambda', region,
              item.id,
              'invoke',
              { payload },
            )
              .then((data) => setResult(data.result))
              .catch((err) => setError(err instanceof Error ? err.message : 'invoke failed'))
              .finally(() => setBusy(false));
          }}
        >
          <Play className={`h-3.5 w-3.5 ${busy ? 'animate-pulse' : ''}`} />
          {busy ? 'Invoking…' : 'Invoke'}
        </GhostButton>
      </div>
      <ActionError message={error} />
      {result ? (
        <div>
          <p className="mb-1 text-xs text-stone-400">
            status {result.statusCode}
            {result.functionError ? ` · error: ${result.functionError}` : ''}
          </p>
          <ResultBox>{formatPayload(result.payload)}</ResultBox>
        </div>
      ) : null}
    </div>
  );
}

function formatPayload(payload?: string): string {
  if (!payload) {
    return '(empty response)';
  }
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

function SecretActions({ instance, item }: DetailProps) {
  const region = useRegion();
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState('');

  return (
    <div className="space-y-2">
      {value === null ? (
        <GhostButton
          onClick={() => {
            setError('');
            actOnResource<{ value: string }>(instance, 'secrets', region, item.id, 'reveal')
              .then((data) => setValue(data.result.value))
              .catch((err) => setError(err instanceof Error ? err.message : 'reveal failed'));
          }}
        >
          <Eye className="h-3.5 w-3.5" /> Reveal value
        </GhostButton>
      ) : (
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-amber-200/90">
            {value || '(empty)'}
          </code>
          <CopyButton value={value} />
          <GhostButton onClick={() => setValue(null)}>Hide</GhostButton>
        </div>
      )}
      <ActionError message={error} />
    </div>
  );
}
