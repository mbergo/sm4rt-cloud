import {
  Activity,
  AlarmClock,
  AlertTriangle,
  Archive,
  ArrowLeft,
  AudioWaveform,
  Bell,
  BookOpen,
  Bot,
  Boxes,
  CalendarClock,
  Cat,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  Container,
  Cylinder,
  Database,
  Download,
  Droplets,
  Eye,
  ExternalLink,
  Feather,
  FileSearch,
  FileText,
  Flame,
  FlaskConical,
  GitBranch,
  GitPullRequest,
  Gauge,
  Globe,
  Globe2,
  HardDrive,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Layers,
  ListTree,
  Lock,
  Mail,
  MemoryStick,
  MessagesSquare,
  Network,
  NotebookPen,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Route,
  ScrollText,
  Search,
  Send,
  Server,
  ShieldCheck,
  Ship,
  SlidersHorizontal,
  Snowflake,
  Sofa,
  Square,
  Table2,
  TableProperties,
  TerminalSquare,
  Trash2,
  Upload,
  Users,
  Waypoints,
  Webhook,
  Wind,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  execCommand,
  exploreCall,
  getInstance,
  getInstanceMetrics,
  getLogs,
  getServiceConfig,
  isRealServiceId,
  getOtelAgentLogs,
  listOtelAgentRuns,
  listExplorerServices,
  listResources,
  listServices,
  listServiceTargets,
  openLogStream,
  putServiceEnv,
  startOtelAgent,
  startService,
  stopService,
  type AgentRun,
  type ClusterInfo,
  type ServiceTargetInfo,
  type InstanceDetail,
  type InstanceMetrics,
  type RealServiceId,
  type RealServiceInfo,
  type RealServiceStatus,
  type ServiceCategory,
  type ServiceConfigInfo,
  type ServiceInstanceRef,
  type ExplorerService,
  SERVICE_CATEGORIES,
  REGIONS,
  type Region,
  type ResourceItem,
  type ServiceId,
} from '../lib/api';
import { snippets, timeAgo, timeUntil } from '../lib/format';
import { BrandLoader, CopyButton, GhostButton, PrimaryButton, StatusBadge } from './bits';
import {
  CachesPage,
  CdnPage,
  ContainersPage,
  BrokerPage,
  DatabasesPage,
  DevopsPage,
  DnsPage,
  FunctionsRealPage,
  GatewaysPage,
  ObjectStorePage,
  ObservabilityPage,
  RegistryPage,
  ServersPage,
  TableStorePage,
} from './Compute';
import { computeSummary, computeDiscovery, getObservability, type DiscoveredService, type ObsInfo } from '../lib/compute';
import { LogConsoleContext, type LogConsoleApi, type LogTarget } from '../lib/log-console';
import ClusterBar from './ClusterBar';
import DomainsPage from './Domains';
import MarketplacePage, { MarketplaceAppPage } from './Marketplace';
import PaasPage from './Paas';
import { listApps as listMarketplaceApps, type MarketplaceApp as MarketplaceAppInfo } from '../lib/marketplace';

type SectionId =
  | 'overview'
  | ServiceId
  | 'services'
  | 'data-eng'
  | 'agents'
  | 'monitoring'
  | 'logs-instance'
  | 'explorer'
  | 'cdn'
  | 'domains'
  | 'observability'
  | 'devops'
  | 'marketplace'
  | 'objectstore'
  | 'tablestore'
  | 'broker'
  | 'functions-real'
  | 'paas'
  | `app:${string}`;

const NAV: { id: SectionId; label: string; icon: typeof Archive; group?: string }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'services', label: 'Service catalog', icon: Boxes },
  { id: 'data-eng', label: 'Data Engineering', icon: Landmark },
  { id: 's3', label: 'Buckets', icon: Archive, group: 'Storage & data' },
  { id: 'objectstore', label: 'Object store (S3)', icon: Archive, group: 'Storage & data' },
  { id: 'tablestore', label: 'Table store (DDB)', icon: Database, group: 'Storage & data' },
  { id: 'dynamodb', label: 'Tables', icon: Database, group: 'Storage & data' },
  { id: 'rds', label: 'Databases (RDS)', icon: Cylinder, group: 'Storage & data' },
  { id: 'elasticache', label: 'Cache clusters', icon: MemoryStick, group: 'Storage & data' },
  { id: 'secrets', label: 'Secrets', icon: KeyRound, group: 'Storage & data' },
  { id: 'ssm', label: 'Parameters', icon: SlidersHorizontal, group: 'Storage & data' },
  { id: 'sqs', label: 'Queues', icon: ListTree, group: 'Messaging' },
  { id: 'broker', label: 'Broker (AMQP)', icon: ListTree, group: 'Messaging' },
  { id: 'sns', label: 'Topics', icon: Bell, group: 'Messaging' },
  { id: 'events', label: 'Event rules', icon: CalendarClock, group: 'Messaging' },
  { id: 'kinesis', label: 'Streams', icon: AudioWaveform, group: 'Messaging' },
  { id: 'ses', label: 'Email (SES)', icon: Mail, group: 'Messaging' },
  { id: 'ec2', label: 'Servers', icon: Server, group: 'Compute' },
  { id: 'ecs', label: 'Containers', icon: Ship, group: 'Compute' },
  { id: 'lambda', label: 'Functions', icon: Zap, group: 'Compute' },
  { id: 'functions-real', label: 'Functions (FaaS)', icon: Zap, group: 'Compute' },
  { id: 'ecr', label: 'Container registry', icon: Container, group: 'Compute' },
  { id: 'athena', label: 'Athena SQL', icon: FileSearch, group: 'Analytics' },
  { id: 'glue', label: 'Glue catalog', icon: TableProperties, group: 'Analytics' },
  { id: 'firehose', label: 'Firehose', icon: Droplets, group: 'Analytics' },
  { id: 'apigw', label: 'API Gateway', icon: Webhook, group: 'Web & edge' },
  { id: 'route53', label: 'DNS zone', icon: Globe2, group: 'Web & edge' },
  { id: 'cdn', label: 'CDN', icon: HardDrive, group: 'Web & edge' },
  { id: 'domains', label: 'Custom domains', icon: Globe, group: 'Web & edge' },
  { id: 'devops', label: 'Sm4rt DevOps', icon: GitBranch, group: 'Platform' },
  { id: 'paas', label: 'Deploy from Git', icon: GitBranch, group: 'Platform' },
  { id: 'marketplace', label: 'Marketplace', icon: Boxes, group: 'Platform' },
  { id: 'observability', label: 'Observability', icon: Activity, group: 'Platform' },
  { id: 'iam', label: 'IAM', icon: ShieldCheck, group: 'Security & identity' },
  { id: 'kms', label: 'KMS keys', icon: Lock, group: 'Security & identity' },
  { id: 'cognito', label: 'User pools', icon: Users, group: 'Security & identity' },
  { id: 'states', label: 'State machines', icon: Route, group: 'Automation' },
  { id: 'cloudformation', label: 'Stacks', icon: Layers, group: 'Automation' },
  { id: 'scheduler', label: 'Schedules', icon: AlarmClock, group: 'Automation' },
  { id: 'agents', label: 'OTel PR agent', icon: GitPullRequest, group: 'Automation' },
  { id: 'explorer', label: 'API Explorer', icon: TerminalSquare, group: 'All services' },
  { id: 'logs', label: 'Log groups', icon: FileText, group: 'Diagnostics' },
  { id: 'monitoring', label: 'Monitoring', icon: Gauge, group: 'Diagnostics' },
  { id: 'logs-instance', label: 'Instance logs', icon: ScrollText, group: 'Diagnostics' },
];

const GROUP_ICON_COLOR: Record<string, string> = {
  'Storage & data': 'text-sky-400',
  Messaging: 'text-violet-400',
  Compute: 'text-amber-400',
  Analytics: 'text-fuchsia-400',
  'Web & edge': 'text-teal-400',
  Platform: 'text-emerald-400',
  'Security & identity': 'text-rose-400',
  Automation: 'text-orange-400',
  'All services': 'text-cyan-400',
  'Deployed by user': 'text-lime-400',
  Diagnostics: 'text-stone-400',
};

const GROUP_TITLE_COLOR: Record<string, string> = {
  'Storage & data': 'text-sky-500/80',
  Messaging: 'text-violet-500/80',
  Compute: 'text-amber-500/80',
  Analytics: 'text-fuchsia-500/80',
  'Web & edge': 'text-teal-500/80',
  Platform: 'text-emerald-500/80',
  'Security & identity': 'text-rose-500/80',
  Automation: 'text-orange-500/80',
  'All services': 'text-cyan-500/80',
  'Deployed by user': 'text-lime-500/80',
  Diagnostics: 'text-stone-500',
};

const CATEGORY_META: Record<ServiceCategory, string> = {
  messaging: 'Streaming & messaging',
  data: 'Databases & storage',
  analytics: 'Analytics & search',
  pipelines: 'Data lake & ETL',
  web: 'Web & integration',
  ai: 'AI & ML',
  observability: 'Monitoring & observability',
};

const SERVICE_ICON: Record<RealServiceId, typeof Archive> = {
  kafka: Waypoints,
  pulsar: Radio,
  activemq: MessagesSquare,
  zookeeper: Network,
  cassandra: Table2,
  couchdb: Sofa,
  ozone: HardDrive,
  flink: Activity,
  solr: Search,
  nifi: Workflow,
  tomcat: Cat,
  httpd: Globe,
  ollama: Bot,
  jupyter: NotebookPen,
  mlflow: FlaskConical,
  iceberg: Snowflake,
  trino: Database,
  airflow: Wind,
  spark: Flame,
  atlas: BookOpen,
  polaris: Compass,
  lgtm: Gauge,
};

const NODE_TEMPLATE = `export const handler = async (event) => {
  return { ok: true, echo: event };
};
`;

const PYTHON_TEMPLATE = `def lambda_handler(event, context):
    return {"ok": True, "echo": event}
`;

const ASL_TEMPLATE = `{
  "Comment": "Hello world state machine",
  "StartAt": "Hello",
  "States": {
    "Hello": { "Type": "Pass", "Result": "Hello from floci", "End": true }
  }
}
`;

const CFN_TEMPLATE = `{
  "AWSTemplateFormatVersion": "2010-09-09",
  "Resources": {
    "ConsoleBucket": {
      "Type": "AWS::S3::Bucket",
      "Properties": { "BucketName": "my-stack-bucket" }
    }
  }
}
`;

const RegionContext = createContext<Region>('us-east-1');

function useRegion(): Region {
  return useContext(RegionContext);
}

// — shared log console (single dock at the bottom, one stream at a time) —
// Context lives in ../lib/log-console.ts so Compute.tsx pages can use it too.

const LOG_BUFFER_MAX = 2000;

function LogDock({ target, onClose }: { target: LogTarget; onClose: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [large, setLarge] = useState(false);
  const [status, setStatus] = useState<'connecting' | 'live' | 'ended' | 'error'>('connecting');
  const preRef = useRef<HTMLPreElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    setLines([]);
    setStatus('connecting');
    let source: EventSource | null = null;
    let cancelled = false;
    openLogStream(target.instance, target.service, 200)
      .then((es) => {
        if (cancelled) {
          es.close();
          return;
        }
        source = es;
        es.onopen = () => setStatus('live');
        es.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data) as { chunk?: string; done?: boolean };
            if (payload.done) {
              setStatus('ended');
              es.close();
              return;
            }
            if (payload.chunk) {
              const next = payload.chunk.split('\n').filter((l) => l.length > 0);
              if (next.length > 0) {
                setLines((prev) => {
                  const merged = [...prev, ...next];
                  return merged.length > LOG_BUFFER_MAX
                    ? merged.slice(merged.length - LOG_BUFFER_MAX)
                    : merged;
                });
              }
            }
          } catch {
            // ignore malformed frames
          }
        };
        es.onerror = () => setStatus('error');
      })
      .catch(() => setStatus('error'));
    return () => {
      cancelled = true;
      source?.close();
    };
  }, [target.instance, target.service]);

  useEffect(() => {
    if (!pausedRef.current) {
      requestAnimationFrame(() => {
        preRef.current?.scrollTo({ top: preRef.current.scrollHeight });
      });
    }
  }, [lines]);

  const statusStyle =
    status === 'live'
      ? 'bg-emerald-400'
      : status === 'connecting'
        ? 'bg-amber-400 animate-pulse'
        : status === 'ended'
          ? 'bg-stone-500'
          : 'bg-rose-400';

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-stone-950/95 shadow-[0_-8px_30px_rgba(0,0,0,0.5)] backdrop-blur">
      <div className="flex w-full items-center justify-between gap-3 px-6 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <TerminalSquare className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusStyle}`} />
          <span className="truncate font-mono text-[11px] text-stone-300">{target.label}</span>
          <span className="hidden shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-stone-500 sm:inline">
            {status === 'live' ? 'streaming' : status}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPaused((v) => !v)}
            className={`rounded-md border p-1 transition ${
              paused
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                : 'border-white/10 bg-white/5 text-stone-400 hover:text-stone-200'
            }`}
            aria-label={paused ? 'Resume auto-scroll' : 'Pause auto-scroll'}
          >
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={() => setLines([])}
            className="rounded-md border border-white/10 bg-white/5 p-1 text-stone-400 transition hover:text-stone-200"
            aria-label="Clear logs"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setLarge((v) => !v)}
            className="rounded-md border border-white/10 bg-white/5 p-1 text-stone-400 transition hover:text-stone-200"
            aria-label={large ? 'Shrink console' : 'Expand console'}
          >
            {large ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 bg-white/5 p-1 text-stone-400 transition hover:text-rose-300"
            aria-label="Close console"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
      <pre
        ref={preRef}
        className={`w-full overflow-auto px-6 pb-3 font-mono text-[11px] leading-relaxed text-emerald-100/70 ${
          large ? 'h-[50vh]' : 'h-48'
        }`}
      >
        {lines.length > 0 ? lines.join('\n') : status === 'error' ? 'stream unavailable' : 'waiting for log output…'}
      </pre>
    </div>
  );
}

export default function Console({
  name,
  cluster,
  onBack,
  notify,
}: {
  name: string;
  cluster?: ClusterInfo | null;
  onBack: () => void;
  notify: (message: string, tone?: 'ok' | 'err') => void;
}) {
  const [detail, setDetail] = useState<InstanceDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [section, setSection] = useState<SectionId>('overview');
  const [region, setRegion] = useState<Region>('us-east-1');
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null);
  const [userApps, setUserApps] = useState<MarketplaceAppInfo[]>([]);

  const logApi = useMemo<LogConsoleApi>(
    () => ({
      open: setLogTarget,
      close: () => setLogTarget(null),
      target: logTarget,
    }),
    [logTarget],
  );

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

  // Marketplace apps deployed by the user become first-class sidebar entries.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      listMarketplaceApps(name)
        .then((data) => {
          if (!cancelled) setUserApps(data.apps);
        })
        .catch(() => {
          if (!cancelled) setUserApps([]);
        });
    };
    load();
    const timer = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [name]);

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
  if (userApps.length > 0) {
    // Right after Platform (where Marketplace lives), before Security.
    const idx = groups.findIndex((g) => g.title === 'Security & identity');
    const group = {
      title: 'Deployed by user',
      items: userApps.map((app) => ({
        id: `app:${app.uuid}` as SectionId,
        label: app.name,
        icon: Boxes,
        group: 'Deployed by user',
      })),
    };
    if (idx >= 0) groups.splice(idx, 0, group);
    else groups.push(group);
  }

  return (
    <LogConsoleContext.Provider value={logApi}>
      <div
        className="w-full px-8 py-6"
        style={logTarget ? { paddingBottom: '16rem' } : undefined}
      >
      {cluster !== undefined ? <ClusterBar cluster={cluster} /> : null}
      <div className="flex w-full gap-6">
      <aside className="w-56 shrink-0">
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
                <p
                  className={`px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest ${GROUP_TITLE_COLOR[group.title] ?? 'text-stone-600'}`}
                >
                  {group.title}
                </p>
              ) : null}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = section === item.id;
                  const iconColor = group.title
                    ? (GROUP_ICON_COLOR[group.title] ?? 'text-stone-400')
                    : 'text-stone-400';
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSection(item.id)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
                        active
                          ? 'bg-amber-500/15 font-medium text-amber-200'
                          : 'text-stone-400 hover:bg-white/5 hover:text-stone-100'
                      }`}
                    >
                      <item.icon
                        className={`h-4 w-4 shrink-0 ${active ? 'text-amber-300' : iconColor}`}
                      />
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
          <BrandLoader label="Loading workspace" sublabel={name} />
        ) : detail.status === 'provisioning' ? (
          <BrandLoader
            label="Provisioning workspace"
            sublabel={`${name} — spinning up your environment on the cluster`}
          />
        ) : section === 'overview' ? (
          <Overview detail={detail} notify={notify} onDeleted={onBack} onNavigate={setSection} />
        ) : section === 'logs-instance' ? (
          <LogsView name={name} />
        ) : section === 'services' ? (
          <ServicesCatalog instance={name} notify={notify} />
        ) : section === 'data-eng' ? (
          <DataEngineeringPage instance={name} notify={notify} />
        ) : section === 'agents' ? (
          <OtelAgentView instance={name} notify={notify} />
        ) : section === 'monitoring' ? (
          <MonitoringView instance={name} />
        ) : section === 'explorer' ? (
          <ApiExplorerView instance={name} />
        ) : section === 'ec2' ? (
          <ServersPage instance={name} notify={notify} />
        ) : section === 'ecs' ? (
          <ContainersPage instance={name} notify={notify} />
        ) : section === 'rds' ? (
          <DatabasesPage instance={name} notify={notify} />
        ) : section === 'elasticache' ? (
          <CachesPage instance={name} notify={notify} />
        ) : section === 'route53' ? (
          <DnsPage instance={name} notify={notify} />
        ) : section === 'apigw' ? (
          <GatewaysPage instance={name} notify={notify} />
        ) : section === 'cdn' ? (
          <CdnPage instance={name} notify={notify} />
        ) : section === 'domains' ? (
          <DomainsPage instance={name} notify={notify} />
        ) : section === 'observability' ? (
          <ObservabilityPage instance={name} notify={notify} />
        ) : section === 'devops' ? (
          <DevopsPage instance={name} notify={notify} />
        ) : section === 'marketplace' ? (
          <MarketplacePage instance={name} notify={notify} />
        ) : section === 'paas' ? (
          <PaasPage instance={name} notify={notify} />
        ) : section === 'objectstore' ? (
          <ObjectStorePage instance={name} notify={notify} />
        ) : section === 'tablestore' ? (
          <TableStorePage instance={name} notify={notify} />
        ) : section === 'broker' ? (
          <BrokerPage instance={name} notify={notify} />
        ) : section === 'functions-real' ? (
          <FunctionsRealPage instance={name} notify={notify} />
        ) : section.startsWith('app:') ? (
          <MarketplaceAppPage
            instance={name}
            uuid={section.slice(4)}
            notify={notify}
            onGone={() => setSection('marketplace')}
          />
        ) : section === 'ecr' ? (
          <RegistryPage instance={name} notify={notify} />
        ) : (
          <RegionContext.Provider value={region}>
            <ServiceView key={`${section}:${region}`} instance={name} service={section} notify={notify} />
          </RegionContext.Provider>
        )}
      </div>
      </div>
      </div>
      {logTarget ? <LogDock target={logTarget} onClose={() => setLogTarget(null)} /> : null}
    </LogConsoleContext.Provider>
  );
}

/**
 * InlineLogTerminal — always-on streaming log pane (SSE) embedded in a page.
 * Picks the first running target by default; the select switches services.
 */
function InlineLogTerminal({ instance }: { instance: string }) {
  const [targets, setTargets] = useState<ServiceTargetInfo[]>([]);
  const [target, setTarget] = useState<string>('');
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const preRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    let alive = true;
    listServiceTargets(instance)
      .then((data) => {
        if (!alive) return;
        setTargets(data.targets);
        setTarget((prev) => prev || data.targets[0]?.name || '');
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [instance]);

  useEffect(() => {
    if (!target) return;
    let source: EventSource | null = null;
    let alive = true;
    setLines([]);
    setStatus('connecting');
    openLogStream(instance, target, 80)
      .then((es) => {
        if (!alive) {
          es.close();
          return;
        }
        source = es;
        es.onmessage = (ev) => {
          setStatus('live');
          setLines((prev) => [...prev.slice(-499), ev.data as string]);
        };
        es.onerror = () => setStatus('error');
      })
      .catch(() => setStatus('error'));
    return () => {
      alive = false;
      source?.close();
    };
  }, [instance, target]);

  useEffect(() => {
    const pre = preRef.current;
    if (pre) pre.scrollTop = pre.scrollHeight;
  }, [lines]);

  if (targets.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-stone-500">
          <TerminalSquare className="h-3.5 w-3.5 text-amber-400" /> Live logs
          <span
            className={`h-2 w-2 rounded-full ${
              status === 'live'
                ? 'bg-emerald-400'
                : status === 'connecting'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-rose-400'
            }`}
          />
        </h3>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="rounded-lg border border-white/10 bg-stone-900 px-2.5 py-1 font-mono text-[11px] text-stone-300 outline-none focus:border-amber-400/50"
        >
          {targets.map((t) => (
            <option key={t.name} value={t.name}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <pre
        ref={preRef}
        className="mt-2 h-56 w-full overflow-auto rounded-xl border border-white/10 bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-emerald-100/70"
      >
        {lines.length > 0
          ? lines.join('\n')
          : status === 'error'
            ? 'stream unavailable'
            : 'waiting for log output…'}
      </pre>
    </section>
  );
}

/** Grafana-style line chart: grid, gradient area fill, amber/blue strokes. */
function LineChart({
  title,
  values,
  unit,
  stroke,
  height = 180,
  format,
}: {
  title: string;
  values: number[];
  unit?: string;
  stroke: string;
  height?: number;
  format: (v: number) => string;
}) {
  const w = 600;
  const h = height;
  const pad = { t: 10, r: 8, b: 18, l: 46 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const max = Math.max(...values, 1) * 1.15;
  const pts = values.length > 1 ? values : [...values, ...values];
  const step = iw / Math.max(pts.length - 1, 1);
  const x = (i: number) => pad.l + i * step;
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${(pad.t + ih).toFixed(1)} L${pad.l},${(pad.t + ih).toFixed(1)} Z`;
  const gridRows = [0.25, 0.5, 0.75];
  const gid = `g-${title.replace(/\W/g, '')}`;
  const last = values[values.length - 1] ?? 0;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">{title}</p>
        <p className="font-mono text-sm text-stone-100">
          {format(last)}
          {unit ? <span className="ml-1 text-[10px] text-stone-500">{unit}</span> : null}
        </p>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 w-full" preserveAspectRatio="none" role="img" aria-label={title}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridRows.map((r) => (
          <g key={r}>
            <line
              x1={pad.l}
              x2={w - pad.r}
              y1={pad.t + ih * r}
              y2={pad.t + ih * r}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="1"
            />
            <text
              x={pad.l - 6}
              y={pad.t + ih * r + 3}
              textAnchor="end"
              fontSize="9"
              fill="rgba(168,162,158,0.6)"
              fontFamily="monospace"
            >
              {format(max * (1 - r))}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={w - pad.r} y1={pad.t + ih} y2={pad.t + ih} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
        {values.length > 0 ? (
          <>
            <path d={area} fill={`url(#${gid})`} />
            <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="3" fill={stroke} />
          </>
        ) : (
          <text x={w / 2} y={h / 2} textAnchor="middle" fontSize="11" fill="rgba(168,162,158,0.5)">
            collecting…
          </text>
        )}
      </svg>
    </div>
  );
}

function Overview({
  detail,
  notify,
  onDeleted,
  onNavigate,
}: {
  detail: InstanceDetail;
  notify: (message: string, tone?: 'ok' | 'err') => void;
  onDeleted: () => void;
  onNavigate: (section: SectionId) => void;
}) {
  const [snippet, setSnippet] = useState('cli');
  const [confirming, setConfirming] = useState(false);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredService[] | null>(null);
  const [services, setServices] = useState<RealServiceInfo[] | null>(null);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [memHistory, setMemHistory] = useState<number[]>([]);
  const [svcMetrics, setSvcMetrics] = useState<
    Array<{ service: string; cpuMilli: number; memoryBytes: number }>
  >([]);
  const [obs, setObs] = useState<ObsInfo | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      listServices(detail.name)
        .then((data) => {
          if (alive) setServices(data.services);
        })
        .catch(() => undefined);
      getInstanceMetrics(detail.name)
        .then((data) => {
          if (!alive) return;
          const cpu = data.services.reduce((sum, svc) => sum + svc.cpuMilli, 0);
          const mem = data.services.reduce((sum, svc) => sum + svc.memoryBytes, 0);
          setCpuHistory((prev) => [...prev.slice(-(METRIC_HISTORY_LIMIT - 1)), cpu]);
          setMemHistory((prev) => [...prev.slice(-(METRIC_HISTORY_LIMIT - 1)), mem]);
          setSvcMetrics(
            [...data.services].sort((a, b) => b.cpuMilli - a.cpuMilli || b.memoryBytes - a.memoryBytes),
          );
        })
        .catch(() => undefined);
      getObservability(detail.name)
        .then((data) => {
          if (alive) setObs(data.observability);
        })
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [detail.name]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      computeSummary(detail.name)
        .then((counts) => {
          if (alive) setSummary(counts);
        })
        .catch(() => {
          if (alive) setSummary(null);
        });
    load();
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [detail.name]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      computeDiscovery(detail.name)
        .then((data) => {
          if (alive) setDiscovered(data.services);
        })
        .catch(() => {
          if (alive) setDiscovered(null);
        });
    load();
    const timer = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [detail.name]);

  const tiles: { key: string; label: string; section: SectionId; icon: typeof Server }[] = [
    { key: 'vm', label: 'Servers', section: 'ec2', icon: Server },
    { key: 'task', label: 'Containers', section: 'ecs', icon: Ship },
    { key: 'db', label: 'Databases', section: 'rds', icon: Cylinder },
    { key: 'cache', label: 'Caches', section: 'elasticache', icon: MemoryStick },
    { key: 'dns-records', label: 'DNS records', section: 'route53', icon: Globe2 },
    { key: 'gateway', label: 'API gateways', section: 'apigw', icon: Webhook },
    { key: 'cdn', label: 'CDN', section: 'cdn', icon: HardDrive },
    { key: 'obs', label: 'Observability', section: 'observability', icon: Activity },
    { key: 'devops', label: 'DevOps', section: 'devops', icon: GitBranch },
  ];

  const runningServices = services?.filter((svc) => svc.status === 'running') ?? [];
  const errorServices = services?.filter((svc) => svc.status === 'error') ?? [];
  const currentCpu = cpuHistory.length > 0 ? cpuHistory[cpuHistory.length - 1] : null;
  const currentMem = memHistory.length > 0 ? memHistory[memHistory.length - 1] : null;
  const cpuMax = Math.max(...cpuHistory, 1);
  const memMax = Math.max(...memHistory, 1);
  const alerts: string[] = [];
  if (detail.status !== 'running') alerts.push(`Environment status is "${detail.status}"`);
  for (const svc of errorServices) {
    alerts.push(`${svc.label} is in error${svc.statusDetail ? `: ${svc.statusDetail}` : ''}`);
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-stone-500">Environment</p>
          <div className="mt-1.5 flex items-center gap-2">
            {detail.status === 'running' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-400" />
            )}
            <span className="text-lg font-semibold capitalize text-stone-100">{detail.status}</span>
          </div>
          <p className="mt-1 text-[11px] text-stone-500">expires {timeUntil(detail.expiresAt)}</p>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-stone-500">Services healthy</p>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span
              className={`text-lg font-semibold tabular-nums ${errorServices.length > 0 ? 'text-rose-300' : 'text-emerald-300'}`}
            >
              {services === null ? '–' : runningServices.length}
            </span>
            <span className="text-xs text-stone-500">
              running{errorServices.length > 0 ? ` · ${errorServices.length} error` : ''}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-stone-500">
            {services === null ? 'loading…' : `${services.length} in catalog`}
          </p>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-stone-500">CPU</p>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-lg font-semibold tabular-nums text-stone-100">
              {currentCpu === null ? '–' : formatCpu(currentCpu)}
            </span>
            <Sparkline values={cpuHistory} max={cpuMax} stroke="#fbbf24" />
          </div>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-stone-500">Memory</p>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-lg font-semibold tabular-nums text-stone-100">
              {currentMem === null ? '–' : formatMemory(currentMem)}
            </span>
            <Sparkline values={memHistory} max={memMax} stroke="#38bdf8" />
          </div>
        </div>
      </section>

      {alerts.length > 0 ? (
        <section className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
            <h3 className="text-sm font-semibold text-amber-200">System alerts</h3>
          </div>
          <ul className="mt-1.5 space-y-1 pl-6 text-xs text-amber-100/90">
            {alerts.map((alert) => (
              <li key={alert} className="list-disc">
                {alert}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {services !== null && services.some((svc) => svc.status !== 'stopped') ? (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-stone-500">
            Service health
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {services
              .filter((svc) => svc.status !== 'stopped')
              .map((svc) => (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() => onNavigate('services')}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition hover:border-amber-400/40 ${SERVICE_STATUS_STYLE[svc.status]}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${SERVICE_STATUS_DOT[svc.status]}`} />
                  {svc.label}
                </button>
              ))}
          </div>
        </section>
      ) : null}

      {summary ? (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-stone-500">
            Cloud resources
          </h3>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-9">
            {tiles.map((tile) => {
              const count = summary[tile.key] ?? 0;
              const Icon = tile.icon;
              return (
                <button
                  key={tile.key}
                  type="button"
                  onClick={() => onNavigate(tile.section)}
                  className="group rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5 text-left transition hover:border-amber-400/30 hover:bg-white/[0.06]"
                >
                  <div className="flex items-center justify-between">
                    <Icon className="h-3.5 w-3.5 text-stone-500 transition group-hover:text-amber-300" />
                    <span
                      className={`text-lg font-semibold tabular-nums ${count > 0 ? 'text-amber-200' : 'text-stone-500'}`}
                    >
                      {count}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-stone-400">{tile.label}</p>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
      {discovered && discovered.length > 0 ? (
        <section>
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-stone-500">
            <Activity className="h-3.5 w-3.5 text-emerald-400" /> Live services
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] normal-case tracking-normal text-stone-400">
              {discovered.filter((d) => d.state === 'running').length}/{discovered.length} running
            </span>
          </h3>
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
            {discovered.map((svc) => (
              <div
                key={svc.service}
                className="flex items-center gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    svc.state === 'running' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                  }`}
                />
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-stone-200">{svc.name}</p>
                  <p className="truncate text-[10px] uppercase tracking-wider text-stone-500">
                    {svc.kind}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
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

      <section>
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-stone-500">
          <Gauge className="h-3.5 w-3.5 text-amber-400" /> Monitoring
          {obs?.grafanaUrl ? (
            <a
              href={obs.grafanaUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] normal-case tracking-normal text-amber-300 transition hover:bg-white/10"
            >
              <ExternalLink className="h-3 w-3" /> Open Grafana
            </a>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('observability')}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] normal-case tracking-normal text-stone-400 transition hover:bg-white/10 hover:text-amber-200"
            >
              Enable full observability (Grafana + OTel)
            </button>
          )}
        </h3>
        <div className="mt-2 grid gap-4 lg:grid-cols-2">
          <LineChart
            title="CPU — all services"
            values={cpuHistory}
            stroke="#fbbf24"
            format={(v) => formatCpu(v)}
          />
          <LineChart
            title="Memory — all services"
            values={memHistory}
            stroke="#38bdf8"
            format={(v) => formatMemory(v)}
          />
        </div>
        {svcMetrics.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.04] text-left text-[10px] uppercase tracking-wider text-stone-500">
                <tr>
                  <th className="px-4 py-2">Service</th>
                  <th className="px-4 py-2">CPU</th>
                  <th className="px-4 py-2 w-1/3"> </th>
                  <th className="px-4 py-2">Memory</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {svcMetrics.slice(0, 10).map((m) => {
                  const maxCpu = Math.max(...svcMetrics.map((x) => x.cpuMilli), 1);
                  const pct = Math.max(2, Math.round((m.cpuMilli / maxCpu) * 100));
                  return (
                    <tr key={m.service} className="bg-white/[0.02]">
                      <td className="px-4 py-2 font-mono text-xs text-stone-200">{m.service}</td>
                      <td className="px-4 py-2 font-mono text-xs tabular-nums">{formatCpu(m.cpuMilli)}</td>
                      <td className="px-4 py-2">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs tabular-nums">
                        {formatMemory(m.memoryBytes)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <InlineLogTerminal instance={detail.name} />

      <section className="rounded-xl border border-rose-500/20 bg-rose-500/[0.04] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-rose-200">Delete instance</h3>
            <p className="text-xs text-stone-400">
              Destroys the namespace, all services and resources, and the endpoint.
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

function ServicePanel({
  instance,
  target,
  label,
}: {
  instance: string;
  target: string;
  label: string;
}) {
  const [tab, setTab] = useState<'config' | 'exec'>('config');
  const [config, setConfig] = useState<ServiceConfigInfo | null>(null);
  const [configErr, setConfigErr] = useState<string | null>(null);
  const [envText, setEnvText] = useState('');
  const [savingEnv, setSavingEnv] = useState(false);
  const [envMsg, setEnvMsg] = useState<string | null>(null);
  const [cmdText, setCmdText] = useState('');
  const [execBusy, setExecBusy] = useState(false);
  const [execOut, setExecOut] = useState<{ output: string; exitCode: number | null; timedOut?: boolean } | null>(null);
  const logConsole = useLogConsole();

  useEffect(() => {
    let cancelled = false;
    setConfig(null);
    setConfigErr(null);
    setEnvMsg(null);
    setExecOut(null);
    getServiceConfig(instance, target)
      .then((data) => {
        if (!cancelled) {
          setConfig(data);
          setEnvText(data.env.join('\n'));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setConfigErr(err instanceof Error ? err.message : 'failed to load config');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [instance, target]);

  const saveEnv = () => {
    const env = envText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    setSavingEnv(true);
    setEnvMsg(null);
    putServiceEnv(instance, target, env)
      .then((data) => {
        setConfig(data);
        setEnvText(data.env.join('\n'));
        setEnvMsg('saved — service restarting with new env');
      })
      .catch((err: unknown) => {
        setEnvMsg(err instanceof Error ? err.message : 'failed to save');
      })
      .finally(() => setSavingEnv(false));
  };

  const runCmd = () => {
    const cmd = cmdText.trim().split(/\s+/).filter(Boolean);
    if (cmd.length === 0 || execBusy) {
      return;
    }
    setExecBusy(true);
    setExecOut(null);
    execCommand(instance, target, cmd)
      .then(setExecOut)
      .catch((err: unknown) => {
        setExecOut({
          output: err instanceof Error ? err.message : 'exec failed',
          exitCode: null,
        });
      })
      .finally(() => setExecBusy(false));
  };

  return (
    <section className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-3 py-2">
        <div className="flex items-center gap-1">
          {(['config', 'exec'] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest transition ${
                tab === id
                  ? 'bg-amber-500/15 text-amber-200'
                  : 'text-stone-500 hover:bg-white/5 hover:text-stone-300'
              }`}
            >
              {id}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => logConsole.open({ instance, service: target, label })}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-stone-300 transition hover:border-amber-400/40 hover:text-amber-200"
        >
          <ScrollText className="h-3 w-3" /> Stream logs
        </button>
      </div>
      <div className="p-3">
        {tab === 'config' ? (
          configErr ? (
            <p className="text-xs text-rose-300">{configErr}</p>
          ) : !config ? (
            <div className="h-24 animate-pulse rounded-lg bg-white/[0.03]" />
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-400">
                <span>
                  image <span className="font-mono text-stone-200">{config.image}</span>
                </span>
                {config.ports.length > 0 ? (
                  <span>
                    ports{' '}
                    <span className="font-mono text-stone-200">
                      {config.ports.map((p) => `${p.published ?? '?'}→${p.target}`).join(', ')}
                    </span>
                  </span>
                ) : null}
                {config.mounts.length > 0 ? (
                  <span>
                    mounts{' '}
                    <span className="font-mono text-stone-200">
                      {config.mounts.map((m) => m.target).join(', ')}
                    </span>
                  </span>
                ) : null}
              </div>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-600">
                  Environment (one KEY=value per line)
                </span>
                <textarea
                  value={envText}
                  onChange={(event) => setEnvText(event.target.value)}
                  rows={Math.min(10, Math.max(4, envText.split('\n').length + 1))}
                  spellCheck={false}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-stone-950 px-2.5 py-2 font-mono text-[11px] text-stone-200 outline-none transition focus:border-amber-500/50"
                />
              </label>
              <div className="flex items-center gap-3">
                <PrimaryButton onClick={saveEnv} disabled={savingEnv}>
                  {savingEnv ? 'Saving…' : 'Save env'}
                </PrimaryButton>
                {envMsg ? <span className="text-xs text-stone-400">{envMsg}</span> : null}
              </div>
            </div>
          )
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                value={cmdText}
                onChange={(event) => setCmdText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    runCmd();
                  }
                }}
                placeholder="command to run inside the container, e.g. ls -la /data"
                spellCheck={false}
                className="w-full rounded-lg border border-white/10 bg-stone-950 px-2.5 py-1.5 font-mono text-[11px] text-stone-200 outline-none transition focus:border-amber-500/50"
              />
              <PrimaryButton onClick={runCmd} disabled={execBusy || cmdText.trim().length === 0}>
                {execBusy ? 'Running…' : 'Run'}
              </PrimaryButton>
            </div>
            {execOut ? (
              <div>
                <div className="mb-1 flex items-center gap-2 text-[11px] text-stone-500">
                  <span>
                    exit{' '}
                    <span
                      className={`font-mono ${execOut.exitCode === 0 ? 'text-emerald-300' : 'text-rose-300'}`}
                    >
                      {execOut.exitCode ?? '—'}
                    </span>
                  </span>
                  {execOut.timedOut ? <span className="text-rose-300">timed out</span> : null}
                </div>
                <pre className="max-h-64 overflow-auto rounded-lg border border-white/10 bg-black/60 p-3 font-mono text-[11px] leading-relaxed text-emerald-100/70">
                  {execOut.output || '(no output)'}
                </pre>
              </div>
            ) : (
              <p className="text-[11px] text-stone-600">
                One-shot exec inside the running container. Output is captured for 30s max.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

const SERVICE_STATUS_STYLE: Record<RealServiceStatus, string> = {  stopped: 'border-white/10 bg-white/5 text-stone-400',
  starting: 'border-amber-500/30 bg-amber-500/10 text-amber-300 animate-pulse',
  running: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  error: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
};

const SERVICE_STATUS_DOT: Record<RealServiceStatus, string> = {
  stopped: 'bg-stone-600',
  starting: 'bg-amber-400 animate-pulse',
  running: 'bg-emerald-400',
  error: 'bg-rose-400',
};

const AGENT_STATUS_STYLE: Record<AgentRun['status'], string> = {
  pending: 'border-stone-500/30 bg-stone-500/10 text-stone-300',
  running: 'animate-pulse border-amber-400/30 bg-amber-500/10 text-amber-200',
  succeeded: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
  failed: 'border-rose-400/30 bg-rose-500/10 text-rose-200',
};

function AgentRunRow({ instance, run }: { instance: string; run: AgentRun }) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState('');
  const active = run.status === 'pending' || run.status === 'running';

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    const load = () => {
      getOtelAgentLogs(instance, run.id)
        .then((data) => {
          if (!cancelled) {
            setLogs(data.logs || 'waiting for agent output…');
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLogs('failed to fetch agent logs');
          }
        });
    };
    load();
    const timer = active ? setInterval(load, 4000) : null;
    return () => {
      cancelled = true;
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [open, active, instance, run.id]);

  const prUrl = logs.match(/PR_URL:\s*(\S+)/)?.[1] ?? null;

  return (
    <li>
      <div
        className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition hover:bg-white/[0.03]"
        onClick={() => setOpen(!open)}
      >
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${AGENT_STATUS_STYLE[run.status]}`}
        >
          {run.status}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm text-stone-100">
            {run.repoUrl.replace('https://github.com/', '')}
          </p>
          <p className="truncate text-xs text-stone-500">
            {run.id} · {run.model}
          </p>
        </div>
        {prUrl ? (
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
          >
            <GitPullRequest className="h-3.5 w-3.5" /> View PR
          </a>
        ) : null}
        {run.startedAt ? (
          <span className="hidden shrink-0 text-xs text-stone-500 sm:block">
            {timeAgo(run.startedAt)}
          </span>
        ) : null}
      </div>
      {open ? (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-white/5 bg-black/40 px-4 py-3 font-mono text-xs leading-relaxed text-stone-300">
          {logs || 'loading agent logs…'}
        </pre>
      ) : null}
    </li>
  );
}

function OtelAgentView({
  instance,
  notify,
}: {
  instance: string;
  notify: (message: string, tone?: 'ok' | 'err') => void;
}) {
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [model, setModel] = useState('gemma3n:e4b');
  const [baseBranch, setBaseBranch] = useState('');
  const [maxFiles, setMaxFiles] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    listOtelAgentRuns(instance)
      .then((data) => setRuns(data.runs))
      .catch(() => setRuns([]));
  }, [instance]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 6000);
    return () => clearInterval(timer);
  }, [refresh]);

  const onRun = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    startOtelAgent(instance, {
      repoUrl: repoUrl.trim(),
      githubToken: githubToken.trim(),
      model: model.trim() || undefined,
      baseBranch: baseBranch.trim() || undefined,
      maxFiles,
    })
      .then((run) => {
        notify(`agent ${run.id} started`);
        setRepoUrl('');
        refresh();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to start agent'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2">
        <GitPullRequest className="h-5 w-5 text-amber-300" />
        <h2 className="font-display text-lg font-bold tracking-tight">OTel PR agent</h2>
      </div>
      <p className="mt-1 text-xs text-stone-500">
        Points a local LLM (Ollama · {model || 'gemma3n:e4b'}) at a GitHub repository, instruments
        code that talks to external systems (HTTP APIs, databases, queues, cloud SDKs) with
        OpenTelemetry spans, and opens a pull request with the changes.
      </p>

      <form
        onSubmit={onRun}
        className="mt-4 space-y-2 rounded-xl border border-amber-400/20 bg-amber-500/[0.04] p-3"
      >
        <input
          value={repoUrl}
          onChange={(event) => setRepoUrl(event.target.value)}
          placeholder="https://github.com/owner/repo"
          required
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-sm text-stone-100 outline-none transition focus:border-amber-400/50"
        />
        <input
          value={githubToken}
          onChange={(event) => setGithubToken(event.target.value)}
          placeholder="GitHub token (repo scope — used to push the branch and open the PR)"
          type="password"
          required
          autoComplete="off"
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-sm text-stone-100 outline-none transition focus:border-amber-400/50"
        />
        <div className="flex flex-wrap gap-2">
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="gemma3n:e4b"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-sm text-stone-100 outline-none transition focus:border-amber-400/50"
          />
          <input
            value={baseBranch}
            onChange={(event) => setBaseBranch(event.target.value)}
            placeholder="base branch (optional)"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-sm text-stone-100 outline-none transition focus:border-amber-400/50"
          />
          <select
            value={maxFiles}
            onChange={(event) => setMaxFiles(Number(event.target.value))}
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-stone-200 outline-none"
          >
            {[1, 2, 3, 4, 6, 8].map((count) => (
              <option key={count} value={count}>
                {count} file{count > 1 ? 's' : ''}
              </option>
            ))}
          </select>
          <PrimaryButton type="submit" disabled={busy} className="px-3 py-1.5 text-xs">
            {busy ? 'Starting…' : 'Run agent'}
          </PrimaryButton>
        </div>
        <p className="text-[11px] text-stone-500">
          Requires the Ollama service running on this instance. The token is only injected into the
          short-lived agent job — it is not stored.
        </p>
      </form>

      {error ? (
        <p className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </p>
      ) : null}

      <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
        {runs === null ? (
          <div className="h-24 animate-pulse bg-white/[0.03]" />
        ) : runs.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-stone-500">
            No agent runs yet. Start Ollama in the service catalog, then point the agent at a
            repository.
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {runs.map((run) => (
              <AgentRunRow key={run.id} instance={instance} run={run} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Sparkline({ values, max, stroke }: { values: number[]; max: number; stroke: string }) {
  const width = 120;
  const height = 30;
  if (values.length < 2) {
    return <div className="h-[30px] w-[120px] rounded bg-white/[0.03]" />;
  }
  const safeMax = Math.max(max, 1e-9);
  const step = width / (values.length - 1);
  const coords = values.map((value, index) => [
    Number((index * step).toFixed(1)),
    Number((height - 2 - (Math.min(value / safeMax, 1) * (height - 4))).toFixed(1)),
  ]);
  const points = coords.map(([x, y]) => `${x},${y}`).join(' ');
  const area = `0,${height} ${points} ${width},${height}`;
  return (
    <svg width={width} height={height} className="shrink-0">
      <polygon points={area} fill={stroke} opacity="0.12" />
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function formatMemory(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${Math.round(bytes)} B`;
}

function formatCpu(milli: number): string {
  return milli >= 1000 ? `${(milli / 1000).toFixed(2)} vCPU` : `${milli}m`;
}

const METRIC_HISTORY_LIMIT = 60;

function MonitoringView({ instance }: { instance: string }) {
  const [metrics, setMetrics] = useState<InstanceMetrics | null>(null);
  const [error, setError] = useState('');
  const [grafanaUrl, setGrafanaUrl] = useState<string | null>(null);
  const historyRef = useRef<Map<string, { cpu: number[]; mem: number[] }>>(new Map());
  const [, setTick] = useState(0);

  useEffect(() => {
    historyRef.current = new Map();
    let cancelled = false;
    const poll = () => {
      getInstanceMetrics(instance)
        .then((data) => {
          if (cancelled) return;
          for (const svc of data.services) {
            const entry = historyRef.current.get(svc.service) ?? { cpu: [], mem: [] };
            entry.cpu = [...entry.cpu.slice(-(METRIC_HISTORY_LIMIT - 1)), svc.cpuMilli];
            entry.mem = [...entry.mem.slice(-(METRIC_HISTORY_LIMIT - 1)), svc.memoryBytes];
            historyRef.current.set(svc.service, entry);
          }
          setMetrics(data);
          setError('');
          setTick((t) => t + 1);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        });
    };
    poll();
    const id = setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [instance]);

  useEffect(() => {
    let cancelled = false;
    listServices(instance)
      .then(({ services }) => {
        if (cancelled) return;
        const lgtm = services.find((svc) => svc.id === 'lgtm');
        const publicUrl = lgtm?.status === 'running'
          ? lgtm.endpoints.find((e) => e.label.toLowerCase().includes('public'))?.value ?? null
          : null;
        setGrafanaUrl(publicUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [instance]);

  const services = metrics?.services ?? [];
  const totalCpu = services.reduce((sum, svc) => sum + svc.cpuMilli, 0);
  const totalMem = services.reduce((sum, svc) => sum + svc.memoryBytes, 0);
  const totalPods = services.reduce((sum, svc) => sum + svc.pods, 0);
  const maxCpu = Math.max(...services.map((svc) => svc.cpuMilli), 1);
  const maxMem = Math.max(...services.map((svc) => svc.memoryBytes), 1);

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-100">Monitoring</h2>
          <p className="mt-1 text-sm text-stone-400">
            CloudWatch-style live metrics for every service in this instance. Samples every 10s.
          </p>
        </div>
        {grafanaUrl ? (
          <a
            href={grafanaUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-200 transition hover:bg-amber-500/20"
          >
            <Gauge className="h-4 w-4" /> Open Grafana (logs, traces, dashboards)
          </a>
        ) : (
          <span className="text-xs text-stone-500">
            Start the “Monitoring (LGTM)” service in the catalog for Grafana, logs &amp; traces.
          </span>
        )}
      </div>

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Total CPU', value: formatCpu(totalCpu) },
          { label: 'Total memory', value: formatMemory(totalMem) },
          { label: 'Running pods', value: String(totalPods) },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-wide text-stone-500">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold text-stone-100">{card.value}</p>
          </div>
        ))}
      </div>

      {!metrics ? (
        <div className="h-40 animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]" />
      ) : services.length === 0 ? (
        <p className="text-sm text-stone-400">No pods running in this instance yet.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.03]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-stone-500">
                <th className="px-4 py-2.5 font-medium">Service</th>
                <th className="px-4 py-2.5 font-medium">CPU</th>
                <th className="px-4 py-2.5 font-medium">CPU trend</th>
                <th className="px-4 py-2.5 font-medium">Memory</th>
                <th className="px-4 py-2.5 font-medium">Memory trend</th>
                <th className="px-4 py-2.5 font-medium">Pods</th>
              </tr>
            </thead>
            <tbody>
              {services.map((svc) => {
                const history = historyRef.current.get(svc.service) ?? { cpu: [], mem: [] };
                const Icon = isRealServiceId(svc.service) ? SERVICE_ICON[svc.service] : Boxes;
                const label = isRealServiceId(svc.service)
                  ? svc.service
                  : svc.service === 'floci'
                    ? 'floci core (AWS APIs)'
                    : svc.service;
                return (
                  <tr key={svc.service} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-2 text-stone-200">
                        <Icon className="h-4 w-4 text-stone-400" /> {label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-stone-300">{formatCpu(svc.cpuMilli)}</td>
                    <td className="px-4 py-2.5">
                      <Sparkline values={history.cpu} max={maxCpu} stroke="#fbbf24" />
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-stone-300">{formatMemory(svc.memoryBytes)}</td>
                    <td className="px-4 py-2.5">
                      <Sparkline values={history.mem} max={maxMem} stroke="#38bdf8" />
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-stone-400">{svc.pods}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {metrics ? (
        <p className="text-xs text-stone-500">Last sample: {new Date(metrics.sampledAt).toLocaleTimeString()}</p>
      ) : null}
    </div>
  );
}

function ServicesCatalog({
  instance,
  notify,
}: {
  instance: string;
  notify: (message: string, tone?: 'ok' | 'err') => void;
}) {
  const [services, setServices] = useState<RealServiceInfo[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<RealServiceId | null>(null);
  const [busyId, setBusyId] = useState<RealServiceId | null>(null);

  const refresh = useCallback(() => {
    listServices(instance)
      .then((data) => {
        setServices(data.services);
        setError('');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'failed to load services');
      });
  }, [instance]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const quickAct = async (service: RealServiceInfo, action: 'start' | 'stop') => {
    setBusyId(service.id);
    try {
      const next =
        action === 'start'
          ? await startService(instance, service.id)
          : await stopService(instance, service.id);
      setServices((prev) =>
        prev ? prev.map((entry) => (entry.id === next.id ? next : entry)) : prev,
      );
      notify(action === 'start' ? `${next.label} starting` : `${next.label} stopped`);
    } catch (err) {
      notify(err instanceof Error ? err.message : `failed to ${action} ${service.label}`, 'err');
    } finally {
      setBusyId(null);
    }
  };

  if (selected) {
    return (
      <RealServiceView
        instance={instance}
        service={selected}
        notify={notify}
        onBack={() => setSelected(null)}
      />
    );
  }

  if (!services) {
    if (error) {
      return <p className="text-sm text-stone-500">error: {error}</p>;
    }
    return (
      <div className="space-y-6">
        <div className="h-12 w-64 animate-pulse rounded-xl border border-white/5 bg-white/[0.03]" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-white/5 bg-white/[0.03]" />
          ))}
        </div>
      </div>
    );
  }

  const runningCount = services.filter((entry) => entry.status === 'running').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight">Service catalog</h2>
          <p className="mt-0.5 text-sm text-stone-400">
            Real open-source services provisioned on demand inside this instance.
          </p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-stone-400">
          {runningCount} running · {services.length} available
        </span>
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2 font-mono text-xs text-rose-200">
          {error}
        </p>
      ) : null}

      {SERVICE_CATEGORIES.map((category) => {
        const entries = services.filter((entry) => entry.category === category);
        if (entries.length === 0) {
          return null;
        }
        return (
          <section key={category}>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-stone-500">
              {CATEGORY_META[category]}
            </h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {entries.map((service) => {
                const Icon = SERVICE_ICON[service.id];
                const canStart = service.status === 'stopped' || service.status === 'error';
                const busy = busyId === service.id;
                return (
                  <div
                    key={service.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(service.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelected(service.id);
                      }
                    }}
                    className="group cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-amber-500/30 hover:bg-white/[0.05]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-stone-300 transition group-hover:border-amber-500/30 group-hover:text-amber-200">
                          <Icon className="h-4.5 w-4.5" />
                        </span>
                        <div>
                          <p className="flex items-center gap-1.5 text-sm font-semibold text-stone-100">
                            {service.label}
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${SERVICE_STATUS_DOT[service.status]}`}
                            />
                          </p>
                          <p className="font-mono text-[10px] text-stone-500">
                            {service.image.split('/').pop()}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          void quickAct(service, canStart ? 'start' : 'stop');
                        }}
                        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition disabled:opacity-50 ${
                          canStart
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                            : 'border-white/10 bg-white/5 text-stone-400 hover:text-rose-300'
                        }`}
                        aria-label={canStart ? `Start ${service.label}` : `Stop ${service.label}`}
                      >
                        {busy ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : canStart ? (
                          <Play className="h-3.5 w-3.5" />
                        ) : (
                          <Square className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <p className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-stone-400">
                      {service.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

type DataEngItem = {
  id: RealServiceId | 'griffin';
  name: string;
  poweredBy: string;
  role: string;
  essential: boolean;
  deployable: boolean;
};

type DataEngStage = {
  id: string;
  step: string;
  title: string;
  blurb: string;
  items: DataEngItem[];
};

const DATA_ENGINEERING: DataEngStage[] = [
  {
    id: 'ingest',
    step: '01',
    title: 'Ingest & stream',
    blurb: 'Move data in — event streams, flow-based routing, and stream processing at the edge of the lake.',
    items: [
      {
        id: 'kafka',
        name: 'Kafka',
        poweredBy: 'Apache Kafka',
        role: 'Durable event backbone for producers and consumers.',
        essential: true,
        deployable: true,
      },
      {
        id: 'nifi',
        name: 'Iris',
        poweredBy: 'Apache NiFi',
        role: 'Visual dataflow — route, transform and deliver between systems.',
        essential: false,
        deployable: true,
      },
      {
        id: 'flink',
        name: 'Zephyros',
        poweredBy: 'Apache Flink',
        role: 'Stateful stream processing with exactly-once guarantees.',
        essential: false,
        deployable: true,
      },
    ],
  },
  {
    id: 'store',
    step: '02',
    title: 'Store',
    blurb: 'Land it durably — S3-compatible object storage and open table format on top.',
    items: [
      {
        id: 'ozone',
        name: 'Ozone',
        poweredBy: 'Apache Ozone',
        role: 'S3-compatible object store for the lake itself.',
        essential: true,
        deployable: true,
      },
      {
        id: 'iceberg',
        name: 'Iceberg',
        poweredBy: 'Apache Iceberg',
        role: 'Open table format — ACID, schema evolution, time travel.',
        essential: true,
        deployable: true,
      },
    ],
  },
  {
    id: 'catalog',
    step: '03',
    title: 'Catalog & governance',
    blurb: 'Know what you have — REST catalogs, metadata, lineage and data quality.',
    items: [
      {
        id: 'polaris',
        name: 'Ariadne',
        poweredBy: 'Apache Polaris',
        role: 'Iceberg REST catalog — the thread that guides engines to tables.',
        essential: false,
        deployable: true,
      },
      {
        id: 'atlas',
        name: 'Atlas',
        poweredBy: 'Apache Atlas',
        role: 'Metadata, classification and lineage across the platform.',
        essential: false,
        deployable: true,
      },
      {
        id: 'griffin',
        name: 'Griffin',
        poweredBy: 'Apache Griffin',
        role: 'Data quality measurement — accuracy, completeness, timeliness.',
        essential: false,
        deployable: false,
      },
    ],
  },
  {
    id: 'process',
    step: '04',
    title: 'Process',
    blurb: 'Transform at scale — batch and micro-batch compute over the lake.',
    items: [
      {
        id: 'spark',
        name: 'Spark',
        poweredBy: 'Apache Spark',
        role: 'Distributed compute engine for ETL, ML and SQL workloads.',
        essential: true,
        deployable: true,
      },
    ],
  },
  {
    id: 'orchestrate',
    step: '05',
    title: 'Orchestrate',
    blurb: 'Schedule and connect every step into reliable, observable pipelines.',
    items: [
      {
        id: 'airflow',
        name: 'Airflow',
        poweredBy: 'Apache Airflow',
        role: 'DAG scheduling and monitoring for the whole pipeline.',
        essential: true,
        deployable: true,
      },
    ],
  },
  {
    id: 'query',
    step: '06',
    title: 'Query',
    blurb: 'Serve answers — federated interactive SQL directly over lake tables.',
    items: [
      {
        id: 'trino',
        name: 'Trino',
        poweredBy: 'Trino',
        role: 'Interactive SQL over Iceberg, Kafka and more.',
        essential: true,
        deployable: true,
      },
    ],
  },
];

const DATA_ENG_ICON: Record<string, typeof Archive> = {
  griffin: Feather,
};

function DataEngineeringPage({
  instance,
  notify,
}: {
  instance: string;
  notify: (message: string, tone?: 'ok' | 'err') => void;
}) {
  const [services, setServices] = useState<RealServiceInfo[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<RealServiceId | null>(null);
  const [busyId, setBusyId] = useState<RealServiceId | null>(null);

  const refresh = useCallback(() => {
    listServices(instance)
      .then((data) => {
        setServices(data.services);
        setError('');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'failed to load services');
      });
  }, [instance]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const quickAct = async (service: RealServiceInfo, action: 'start' | 'stop') => {
    setBusyId(service.id);
    try {
      const next =
        action === 'start'
          ? await startService(instance, service.id)
          : await stopService(instance, service.id);
      setServices((prev) =>
        prev ? prev.map((entry) => (entry.id === next.id ? next : entry)) : prev,
      );
      notify(action === 'start' ? `${next.label} starting` : `${next.label} stopped`);
    } catch (err) {
      notify(err instanceof Error ? err.message : `failed to ${action} ${service.label}`, 'err');
    } finally {
      setBusyId(null);
    }
  };

  if (selected) {
    return (
      <RealServiceView
        instance={instance}
        service={selected}
        notify={notify}
        onBack={() => setSelected(null)}
      />
    );
  }

  const byId = new Map((services ?? []).map((entry) => [entry.id, entry]));
  const allItems = DATA_ENGINEERING.flatMap((stage) => stage.items);
  const runningCount = allItems.filter(
    (item) => item.deployable && byId.get(item.id as RealServiceId)?.status === 'running',
  ).length;
  const deployableCount = allItems.filter((item) => item.deployable).length;

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-amber-500/[0.07] via-white/[0.03] to-transparent p-6">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-400/90">
              Data lake &amp; ETL
            </p>
            <h2 className="mt-1 font-display text-xl font-bold tracking-tight text-stone-100">
              Data Engineering
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-400">
              A complete lakehouse, assembled from the Apache data stack. Every stage below is a
              real service you can start in this workspace — ingest events, land them in object
              storage, catalog them, transform, orchestrate, then query with SQL.
            </p>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-stone-400">
            {runningCount} running · {deployableCount} available
          </span>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-stone-400">
          {DATA_ENGINEERING.map((stage, index) => (
            <span key={stage.id} className="flex items-center gap-1.5">
              <a
                href={`#de-${stage.id}`}
                className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 transition hover:border-amber-500/30 hover:text-amber-200"
              >
                <span className="mr-1 font-mono text-[9px] text-amber-500/80">{stage.step}</span>
                {stage.title}
              </a>
              {index < DATA_ENGINEERING.length - 1 ? (
                <span className="text-stone-600">→</span>
              ) : null}
            </span>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2 font-mono text-xs text-rose-200">
          {error}
        </p>
      ) : null}

      {DATA_ENGINEERING.map((stage) => (
        <section key={stage.id} id={`de-${stage.id}`}>
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono text-xs font-semibold text-amber-500/80">{stage.step}</span>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-stone-500">
              {stage.title}
            </h3>
          </div>
          <p className="mt-1 pl-7 text-xs text-stone-500">{stage.blurb}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {stage.items.map((item) => {
              const live = item.deployable ? byId.get(item.id as RealServiceId) : undefined;
              const Icon = item.deployable
                ? SERVICE_ICON[item.id as RealServiceId]
                : (DATA_ENG_ICON[item.id] ?? Archive);
              const canStart = live ? live.status === 'stopped' || live.status === 'error' : false;
              const busy = live ? busyId === live.id : false;
              if (!item.deployable) {
                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-dashed border-white/10 bg-white/[0.015] p-4 text-left opacity-80"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-stone-500">
                          <Icon className="h-4.5 w-4.5" />
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-stone-300">{item.name}</p>
                          <p className="font-mono text-[10px] text-stone-500">
                            powered by {item.poweredBy}
                          </p>
                        </div>
                      </div>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-stone-500">
                        Roadmap
                      </span>
                    </div>
                    <p className="mt-2.5 text-xs leading-relaxed text-stone-500">{item.role}</p>
                  </div>
                );
              }
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(item.id as RealServiceId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelected(item.id as RealServiceId);
                    }
                  }}
                  className="group cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-amber-500/30 hover:bg-white/[0.05]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-stone-300 transition group-hover:border-amber-500/30 group-hover:text-amber-200">
                        <Icon className="h-4.5 w-4.5" />
                      </span>
                      <div>
                        <p className="flex items-center gap-1.5 text-sm font-semibold text-stone-100">
                          {item.name}
                          {item.essential ? (
                            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-amber-300">
                              Core
                            </span>
                          ) : null}
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${SERVICE_STATUS_DOT[live?.status ?? 'stopped']}`}
                          />
                        </p>
                        <p className="font-mono text-[10px] text-stone-500">
                          powered by {item.poweredBy}
                        </p>
                      </div>
                    </div>
                    {live ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          void quickAct(live, canStart ? 'start' : 'stop');
                        }}
                        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition disabled:opacity-50 ${
                          canStart
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                            : 'border-white/10 bg-white/5 text-stone-400 hover:text-rose-300'
                        }`}
                        aria-label={canStart ? `Start ${item.name}` : `Stop ${item.name}`}
                      >
                        {busy ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : canStart ? (
                          <Play className="h-3.5 w-3.5" />
                        ) : (
                          <Square className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-stone-400">
                    {item.role}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function RealServiceView({
  instance,
  service,
  notify,
  onBack,
}: {
  instance: string;
  service: RealServiceId;
  notify: (message: string, tone?: 'ok' | 'err') => void;
  onBack: () => void;
}) {
  const [info, setInfo] = useState<RealServiceInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const logConsole = useLogConsole();

  const refresh = useCallback(() => {
    listServices(instance)
      .then((data) => {
        const match = data.services.find((entry) => entry.id === service) ?? null;
        setInfo(match);
        setError(match ? '' : 'service not found');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'failed to load service');
      });
  }, [instance, service]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const act = async (action: 'start' | 'stop', instanceName?: string) => {
    setBusy(true);
    try {
      const next =
        action === 'start'
          ? await startService(instance, service, instanceName)
          : await stopService(instance, service, instanceName);
      setInfo(next);
      const suffix = instanceName ? ` (${instanceName})` : '';
      notify(action === 'start' ? `${next.label}${suffix} starting` : `${next.label}${suffix} stopped`);
    } catch (err) {
      notify(err instanceof Error ? err.message : `failed to ${action} service`, 'err');
    } finally {
      setBusy(false);
    }
  };

  const createInstance = async () => {
    const name = newName.trim();
    if (!/^[a-z0-9][a-z0-9-]{0,20}$/.test(name)) {
      notify('instance name: lowercase letters, digits and dashes (max 21 chars)', 'err');
      return;
    }
    await act('start', name);
    setNewName('');
  };

  if (!info) {
    return (
      <p className="text-sm text-stone-500">{error ? `error: ${error}` : 'loading service…'}</p>
    );
  }

  const status = info.status;
  const canStart = status === 'stopped' || status === 'error';

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-stone-400 transition hover:bg-white/5 hover:text-stone-100"
      >
        <ArrowLeft className="h-4 w-4" /> Service catalog
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-lg font-bold tracking-tight">{info.label}</h2>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${SERVICE_STATUS_STYLE[status]}`}
            >
              {status}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-stone-400">
              {CATEGORY_META[info.category]}
            </span>
          </div>
          <p className="mt-1 text-sm text-stone-400">{info.description}</p>
          <p className="mt-1 font-mono text-xs text-stone-500">{info.image}</p>
        </div>
        <div className="flex items-center gap-2">
          <GhostButton onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </GhostButton>
          {canStart ? (
            <PrimaryButton onClick={() => act('start')} disabled={busy}>
              <Play className="h-3.5 w-3.5" /> Start
            </PrimaryButton>
          ) : (
            <GhostButton onClick={() => act('stop')} disabled={busy}>
              <Square className="h-3.5 w-3.5" /> Stop
            </GhostButton>
          )}
        </div>
      </div>

      {info.statusDetail ? (
        <p className="rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2 font-mono text-xs text-rose-200">
          {info.statusDetail}
        </p>
      ) : null}

      {status === 'stopped' ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-stone-400">
          This service is not running. Start it to provision a dedicated {info.label} workload
          inside this instance.
        </p>
      ) : null}

      {info.endpoints.length > 0 ? (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-stone-500">
            Endpoints
          </h3>
          <div className="mt-2 space-y-2">
            {[...info.endpoints]
              .sort((a, b) => {
                const aPub = a.value.startsWith('https://') ? 0 : 1;
                const bPub = b.value.startsWith('https://') ? 0 : 1;
                return aPub - bPub;
              })
              .map((endpoint) => (
              <div
                key={endpoint.label}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-xs text-stone-500">{endpoint.label}</p>
                  {endpoint.value.startsWith('https://') ? (
                    <a
                      href={endpoint.value}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate font-mono text-xs text-amber-300 hover:underline"
                    >
                      {endpoint.value.replace('https://', '')}
                    </a>
                  ) : (
                    <p className="truncate font-mono text-xs text-stone-200">{endpoint.value}</p>
                  )}
                </div>
                <CopyButton value={endpoint.value} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {(() => {
        const instances = info.instances ?? [];
        const running = instances.filter((inst) => inst.status !== 'stopped');
        const selectedInst =
          running.find((inst) => (inst.name ?? '') === (selected ?? '')) ??
          running.find((inst) => inst.name === null) ??
          running[0] ??
          null;
        return (
          <>
            <section>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-stone-500">
                  Instances
                </h3>
                <span className="text-[11px] text-stone-600">
                  {running.length}/{instances.length || 1} running
                </span>
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {instances.map((inst) => {
                  const key = inst.name ?? '__default__';
                  const isSelected = selectedInst
                    ? (selectedInst.name ?? '__default__') === key
                    : false;
                  return (
                    <div
                      key={key}
                      className={`rounded-xl border p-3 transition ${
                        isSelected
                          ? 'border-amber-500/40 bg-amber-500/[0.04]'
                          : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setSelected(inst.name ?? '')}
                          className="flex min-w-0 items-center gap-2 text-left"
                        >
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${SERVICE_STATUS_DOT[inst.status]}`}
                          />
                          <span className="truncate font-mono text-sm text-stone-100">
                            {inst.name ?? 'default'}
                          </span>
                        </button>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${SERVICE_STATUS_STYLE[inst.status]}`}
                        >
                          {inst.status}
                        </span>
                      </div>
                      {inst.host ? (
                        <p className="mt-1.5 truncate font-mono text-[11px] text-stone-500">
                          {inst.host}
                        </p>
                      ) : null}
                      {inst.statusDetail ? (
                        <p className="mt-1.5 truncate font-mono text-[11px] text-rose-300">
                          {inst.statusDetail}
                        </p>
                      ) : null}
                      <div className="mt-2.5 flex items-center gap-1.5">
                        {inst.status !== 'stopped' ? (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                logConsole.open({
                                  instance,
                                  service: inst.serviceName,
                                  label: `${info.label} / ${inst.name ?? 'default'}`,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-stone-300 transition hover:border-amber-400/40 hover:text-amber-200"
                            >
                              <ScrollText className="h-3 w-3" /> Logs
                            </button>
                            <button
                              type="button"
                              onClick={() => act('stop', inst.name ?? undefined)}
                              disabled={busy}
                              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-stone-300 transition hover:border-rose-400/40 hover:text-rose-200 disabled:opacity-50"
                            >
                              <Square className="h-3 w-3" /> Stop
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => act('start', inst.name ?? undefined)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-stone-300 transition hover:border-emerald-400/40 hover:text-emerald-200 disabled:opacity-50"
                          >
                            <Play className="h-3 w-3" /> Start
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div className="flex flex-col justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-transparent p-3">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-600">
                    New instance
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      value={newName}
                      onChange={(event) => setNewName(event.target.value.toLowerCase())}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          void createInstance();
                        }
                      }}
                      placeholder="replica-name"
                      spellCheck={false}
                      className="w-full min-w-0 rounded-lg border border-white/10 bg-stone-950 px-2.5 py-1.5 font-mono text-[11px] text-stone-200 outline-none transition focus:border-amber-500/50"
                    />
                    <PrimaryButton
                      onClick={() => void createInstance()}
                      disabled={busy || newName.trim().length === 0}
                    >
                      <Play className="h-3.5 w-3.5" />
                    </PrimaryButton>
                  </div>
                </div>
              </div>
            </section>

            {selectedInst ? (
              <ServicePanel
                key={`${instance}/${selectedInst.serviceName}`}
                instance={instance}
                target={selectedInst.serviceName}
                label={`${info.label} / ${selectedInst.name ?? 'default'}`}
              />
            ) : null}

            {selectedInst ? <InlineLogTerminal instance={instance} /> : null}
          </>
        );
      })()}
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
  iam: {
    title: 'IAM',
    noun: 'identity',
    placeholder: 'user / role / policy name',
    hint: 'users, roles and customer-managed policies',
  },
  ssm: {
    title: 'Parameters',
    noun: 'parameter',
    placeholder: '/app/config/name',
    hint: 'SSM Parameter Store (String)',
  },
  logs: {
    title: 'Log groups',
    noun: 'log group',
    placeholder: '/app/service',
    hint: 'CloudWatch Logs',
  },
  kms: {
    title: 'KMS keys',
    noun: 'key',
    placeholder: 'key description',
    hint: 'symmetric encrypt/decrypt keys',
  },
  events: {
    title: 'Event rules',
    noun: 'rule',
    placeholder: 'rule name',
    hint: 'default event bus',
  },
  states: {
    title: 'State machines',
    noun: 'state machine',
    placeholder: 'machine name',
    hint: 'Step Functions (ASL definition)',
  },
  kinesis: {
    title: 'Streams',
    noun: 'stream',
    placeholder: 'stream name',
    hint: 'created with 1 shard',
  },
  apigw: {
    title: 'API Gateway',
    noun: 'API',
    placeholder: 'api name',
    hint: 'HTTP APIs (API Gateway v2)',
  },
  cognito: {
    title: 'User pools',
    noun: 'user pool',
    placeholder: 'pool name',
    hint: 'Cognito user pools and users',
  },
  route53: {
    title: 'Hosted zones',
    noun: 'hosted zone',
    placeholder: 'example.com',
    hint: 'public DNS zones and records',
  },
  cloudformation: {
    title: 'Stacks',
    noun: 'stack',
    placeholder: 'stack name',
    hint: 'CloudFormation (JSON template)',
  },
  ecr: {
    title: 'Container registry',
    noun: 'repository',
    placeholder: 'repository name',
    hint: 'ECR docker repositories',
  },
  ses: {
    title: 'Email identities',
    noun: 'identity',
    placeholder: 'sender@example.com',
    hint: 'SES sender identities · sandbox outbox',
  },
  scheduler: {
    title: 'Schedules',
    noun: 'schedule',
    placeholder: 'schedule name',
    hint: 'EventBridge Scheduler',
  },
  rds: {
    title: 'Databases (RDS)',
    noun: 'database',
    placeholder: 'db identifier',
    hint: 'db.t3.micro · master user "admin" / "password123"',
  },
  ecs: {
    title: 'ECS clusters',
    noun: 'cluster',
    placeholder: 'cluster name',
    hint: 'Elastic Container Service clusters',
  },
  athena: {
    title: 'Athena SQL',
    noun: 'workgroup',
    placeholder: 'workgroup name',
    hint: 'expand a workgroup to run SQL queries',
  },
  glue: {
    title: 'Glue catalog',
    noun: 'database',
    placeholder: 'database_name',
    hint: 'Glue Data Catalog databases and tables',
  },
  elasticache: {
    title: 'Cache clusters',
    noun: 'cache cluster',
    placeholder: 'cluster id',
    hint: 'memcached · cache.t3.micro · 1 node',
  },
  firehose: {
    title: 'Firehose',
    noun: 'delivery stream',
    placeholder: 'stream name',
    hint: 'DirectPut streams delivering to S3',
  },
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
  const [iamKind, setIamKind] = useState('user');
  const [aslCode, setAslCode] = useState(ASL_TEMPLATE);
  const [cfnCode, setCfnCode] = useState(CFN_TEMPLATE);
  const [rdsEngine, setRdsEngine] = useState('postgres');

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
      ...(service === 'secrets' || service === 'ssm' || service === 'events' || service === 'scheduler' ||
      service === 'glue' || service === 'firehose'
        ? { value: secretValue }
        : {}),
      ...(service === 'iam' ? { value: iamKind } : {}),
      ...(service === 'rds' ? { value: rdsEngine } : {}),
      ...(service === 'lambda' ? { runtime, code } : {}),
      ...(service === 'states' ? { code: aslCode } : {}),
      ...(service === 'cloudformation' ? { code: cfnCode } : {}),
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
            {service === 'iam' ? (
              <select
                value={iamKind}
                onChange={(event) => setIamKind(event.target.value)}
                className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-stone-200 outline-none"
              >
                <option value="user">user</option>
                <option value="role">role</option>
                <option value="policy">policy</option>
              </select>
            ) : null}
            {service === 'rds' ? (
              <select
                value={rdsEngine}
                onChange={(event) => setRdsEngine(event.target.value)}
                className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-stone-200 outline-none"
              >
                <option value="postgres">postgres</option>
                <option value="mysql">mysql</option>
                <option value="mariadb">mariadb</option>
              </select>
            ) : null}
            <PrimaryButton type="submit" disabled={busy} className="px-3 py-1.5 text-xs">
              {busy ? 'Creating…' : 'Create'}
            </PrimaryButton>
          </div>
          {service === 'secrets' || service === 'ssm' || service === 'events' || service === 'scheduler' ||
          service === 'glue' || service === 'firehose' ? (
            <input
              value={secretValue}
              onChange={(event) => setSecretValue(event.target.value)}
              placeholder={
                service === 'secrets'
                  ? 'secret value'
                  : service === 'ssm'
                    ? 'parameter value'
                    : service === 'scheduler'
                      ? 'rate(5 minutes) · cron(0 12 * * ? *)'
                      : service === 'glue'
                        ? 'description (optional)'
                        : service === 'firehose'
                          ? 'destination bucket (default: firehose-data)'
                          : 'rate(5 minutes) · cron(…) · or JSON event pattern'
              }
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
          {service === 'states' ? (
            <textarea
              value={aslCode}
              onChange={(event) => setAslCode(event.target.value)}
              rows={8}
              spellCheck={false}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs leading-relaxed text-stone-100 outline-none transition focus:border-amber-400/50"
            />
          ) : null}
          {service === 'cloudformation' ? (
            <textarea
              value={cfnCode}
              onChange={(event) => setCfnCode(event.target.value)}
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
    case 'iam':
      return <IamActions {...props} />;
    case 'ssm':
      return <ParameterActions {...props} />;
    case 'logs':
      return <LogGroupActions {...props} />;
    case 'kms':
      return <KeyActions {...props} />;
    case 'events':
      return <RuleActions {...props} />;
    case 'states':
      return <StateMachineActions {...props} />;
    case 'kinesis':
      return <StreamActions {...props} />;
    case 'apigw':
      return <ApiActions {...props} />;
    case 'cognito':
      return <UserPoolActions {...props} />;
    case 'route53':
      return <ZoneActions {...props} />;
    case 'cloudformation':
      return <StackActions {...props} />;
    case 'ecr':
      return <RepoImages {...props} />;
    case 'ses':
      return <EmailActions {...props} />;
    case 'scheduler':
      return <ScheduleActions {...props} />;
    case 'rds':
      return <RdsActions {...props} />;
    case 'ecs':
      return <EcsActions {...props} />;
    case 'athena':
      return <AthenaQuery {...props} />;
    case 'glue':
      return <GlueTables {...props} />;
    case 'elasticache':
      return <CacheActions {...props} />;
    case 'firehose':
      return <FirehoseActions {...props} />;
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [objects, setObjects] = useState<
    { key?: string; size?: number; lastModified?: string }[] | null
  >(null);
  const [error, setError] = useState('');
  const [key, setKey] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState('');
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
  }, [instance, item.id, region]);

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

  const uploadFile = (file: File) => {
    if (file.size > 25 * 1024 * 1024) {
      setError('file larger than 25 MiB — use the AWS CLI for big uploads');
      return;
    }
    setBusy(file.name);
    setError('');
    const reader = new FileReader();
    reader.onerror = () => {
      setBusy('');
      setError('could not read the selected file');
    };
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.slice(result.indexOf(',') + 1);
      actOnResource(instance, 's3', region, item.id, 'putObject', {
        key: file.name,
        contentBase64: base64,
        contentType: file.type || 'application/octet-stream',
      })
        .then(() => {
          notify(`file ${file.name} uploaded`);
          load();
        })
        .catch((err) => setError(err instanceof Error ? err.message : 'upload failed'))
        .finally(() => setBusy(''));
    };
    reader.readAsDataURL(file);
  };

  const download = (objectKey: string) => {
    setBusy(objectKey);
    setError('');
    actOnResource<{ key: string; contentBase64: string; contentType: string }>(
      instance,
      's3', region,
      item.id,
      'downloadObject',
      { key: objectKey },
    )
      .then((data) => {
        const bytes = Uint8Array.from(atob(data.result.contentBase64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: data.result.contentType });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = objectKey.split('/').pop() ?? objectKey;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'download failed'))
      .finally(() => setBusy(''));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              uploadFile(file);
            }
            event.target.value = '';
          }}
        />
        <GhostButton onClick={() => fileRef.current?.click()} disabled={busy !== ''}>
          <Upload className="h-3.5 w-3.5" /> {busy ? `Uploading ${busy}…` : 'Upload file'}
        </GhostButton>
        <span className="text-[10px] text-stone-500">up to 25 MiB, key = file name</span>
      </div>
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
          <Upload className="h-3.5 w-3.5" /> Put text
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
              {object.lastModified ? (
                <span className="hidden text-[10px] text-stone-600 sm:inline">
                  {new Date(object.lastModified).toLocaleString()}
                </span>
              ) : null}
              <span className="text-[10px] text-stone-500">
                {formatMemory(object.size ?? 0)}
              </span>
              <button
                type="button"
                onClick={() => object.key && download(object.key)}
                disabled={busy !== ''}
                className="rounded p-1 text-stone-500 transition hover:bg-white/10 hover:text-stone-100 disabled:opacity-40"
                aria-label="Download object"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
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

function IamActions({ instance, item, notify }: DetailProps) {
  const region = useRegion();
  const isRole = item.id.startsWith('role/');
  const [policies, setPolicies] = useState<{ name?: string; arn?: string }[] | null>(null);
  const [policyArn, setPolicyArn] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!isRole) {
      return;
    }
    setError('');
    actOnResource<{ policies: { name?: string; arn?: string }[] }>(
      instance,
      'iam', region,
      item.id,
      'attached',
    )
      .then((data) => setPolicies(data.result.policies))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to list policies'));
  }, [instance, region, item.id, isRole]);

  useEffect(() => {
    load();
  }, [load]);

  if (!isRole) {
    return (
      <p className="font-mono text-xs text-stone-400">
        {item.detail ?? item.id}
      </p>
    );
  }

  const attach = (event: FormEvent) => {
    event.preventDefault();
    if (!policyArn.trim()) {
      return;
    }
    actOnResource(instance, 'iam', region, item.id, 'attachPolicy', { policyArn: policyArn.trim() })
      .then(() => {
        notify('policy attached');
        setPolicyArn('');
        load();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'attach failed'));
  };

  return (
    <div className="space-y-3">
      <form onSubmit={attach} className="flex flex-wrap gap-2">
        <input
          value={policyArn}
          onChange={(event) => setPolicyArn(event.target.value)}
          placeholder="policy ARN to attach"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
        />
        <GhostButton type="submit">
          <Plus className="h-3.5 w-3.5" /> Attach policy
        </GhostButton>
      </form>
      <ActionError message={error} />
      {policies === null ? (
        <p className="text-xs text-stone-500">loading attached policies…</p>
      ) : policies.length === 0 ? (
        <p className="text-xs text-stone-500">no policies attached</p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
          {policies.map((policy) => (
            <li key={policy.arn} className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-stone-200">
                {policy.name}
              </span>
              <span className="truncate text-[10px] text-stone-500">{policy.arn}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ParameterActions({ instance, item }: DetailProps) {
  const region = useRegion();
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState('');

  return (
    <div className="space-y-2">
      {value === null ? (
        <GhostButton
          onClick={() => {
            setError('');
            actOnResource<{ value: string }>(instance, 'ssm', region, item.id, 'reveal')
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

function LogGroupActions({ instance, item }: DetailProps) {
  const region = useRegion();
  const [streams, setStreams] = useState<{ name?: string; lastEvent?: string | null }[] | null>(
    null,
  );
  const [events, setEvents] = useState<
    { timestamp?: string | null; stream?: string; message?: string }[] | null
  >(null);
  const [error, setError] = useState('');

  const loadStreams = useCallback(() => {
    setError('');
    actOnResource<{ streams: { name?: string; lastEvent?: string | null }[] }>(
      instance,
      'logs', region,
      item.id,
      'streams',
    )
      .then((data) => setStreams(data.result.streams))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to list streams'));
  }, [instance, region, item.id]);

  useEffect(() => {
    loadStreams();
  }, [loadStreams]);

  const tail = () => {
    setError('');
    actOnResource<{ events: { timestamp?: string | null; stream?: string; message?: string }[] }>(
      instance,
      'logs', region,
      item.id,
      'tail',
    )
      .then((data) => setEvents(data.result.events))
      .catch((err) => setError(err instanceof Error ? err.message : 'tail failed'));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <GhostButton onClick={loadStreams}>
          <RefreshCw className="h-3.5 w-3.5" /> Streams
        </GhostButton>
        <GhostButton onClick={tail}>
          <ScrollText className="h-3.5 w-3.5" /> Tail events
        </GhostButton>
        <span className="text-[10px] text-stone-500">
          {streams === null ? '' : `${streams.length} stream${streams.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <ActionError message={error} />
      {streams !== null && streams.length > 0 ? (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
          {streams.map((stream) => (
            <li key={stream.name} className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-stone-200">
                {stream.name}
              </span>
              <span className="text-[10px] text-stone-500">
                {stream.lastEvent ? timeAgo(stream.lastEvent) : 'no events'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {events !== null ? (
        events.length === 0 ? (
          <p className="text-xs text-stone-500">no log events yet</p>
        ) : (
          <ResultBox>
            {events
              .map((event) => `${event.timestamp ?? ''}  [${event.stream ?? ''}]  ${event.message ?? ''}`)
              .join('\n')}
          </ResultBox>
        )
      ) : null}
    </div>
  );
}

function KeyActions({ instance, item, notify }: DetailProps) {
  const region = useRegion();
  const [plaintext, setPlaintext] = useState('');
  const [ciphertext, setCiphertext] = useState('');
  const [decrypted, setDecrypted] = useState<string | null>(null);
  const [error, setError] = useState('');

  const encrypt = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setDecrypted(null);
    actOnResource<{ ciphertext: string }>(instance, 'kms', region, item.id, 'encrypt', {
      plaintext,
    })
      .then((data) => {
        setCiphertext(data.result.ciphertext);
        notify('encrypted with ' + item.id.slice(0, 8));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'encrypt failed'));
  };

  const decrypt = () => {
    setError('');
    actOnResource<{ plaintext: string }>(instance, 'kms', region, item.id, 'decrypt', {
      ciphertext,
    })
      .then((data) => setDecrypted(data.result.plaintext))
      .catch((err) => setError(err instanceof Error ? err.message : 'decrypt failed'));
  };

  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] text-stone-500">key id: {item.id}</p>
      <form onSubmit={encrypt} className="flex flex-wrap gap-2">
        <input
          value={plaintext}
          onChange={(event) => setPlaintext(event.target.value)}
          placeholder="plaintext to encrypt"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
        />
        <GhostButton type="submit">
          <Lock className="h-3.5 w-3.5" /> Encrypt
        </GhostButton>
      </form>
      {ciphertext ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-[10px] text-amber-200/80">
              {ciphertext}
            </code>
            <CopyButton value={ciphertext} />
            <GhostButton onClick={decrypt}>
              <Eye className="h-3.5 w-3.5" /> Decrypt
            </GhostButton>
          </div>
          {decrypted !== null ? (
            <p className="font-mono text-xs text-emerald-300">→ {decrypted || '(empty)'}</p>
          ) : null}
        </div>
      ) : null}
      <ActionError message={error} />
    </div>
  );
}

function RuleActions({ instance, item, notify }: DetailProps) {
  const region = useRegion();
  const [source, setSource] = useState('floci.console');
  const [detailType, setDetailType] = useState('test-event');
  const [detail, setDetail] = useState('{"hello":"world"}');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const send = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    actOnResource<{ failed: number; entries: { eventId?: string }[] }>(
      instance,
      'events', region,
      item.id,
      'putEvents',
      { source, detailType, detail },
    )
      .then((data) => {
        const entry = data.result.entries[0];
        setResult(entry?.eventId ?? '');
        notify('event published to default bus');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'put-events failed'));
  };

  return (
    <div className="space-y-3">
      {item.detail ? <p className="font-mono text-[10px] text-stone-500">{item.detail}</p> : null}
      <form onSubmit={send} className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="source"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
          />
          <input
            value={detailType}
            onChange={(event) => setDetailType(event.target.value)}
            placeholder="detail-type"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
          />
          <GhostButton type="submit">
            <Send className="h-3.5 w-3.5" /> Put event
          </GhostButton>
        </div>
        <input
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          placeholder="detail JSON"
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
        />
      </form>
      {result ? <p className="font-mono text-xs text-emerald-300">event id: {result}</p> : null}
      <ActionError message={error} />
    </div>
  );
}

function StateMachineActions({ instance, item, notify }: DetailProps) {
  const region = useRegion();
  const [input, setInput] = useState('{}');
  const [executions, setExecutions] = useState<
    { arn?: string; name?: string; status?: string; started?: string; stopped?: string | null }[] | null
  >(null);
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    actOnResource<{
      executions: { arn?: string; name?: string; status?: string; started?: string; stopped?: string | null }[];
    }>(instance, 'states', region, item.id, 'executions')
      .then((data) => setExecutions(data.result.executions))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to list executions'));
  }, [instance, region, item.id]);

  useEffect(() => {
    load();
  }, [load]);

  const start = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    actOnResource(instance, 'states', region, item.id, 'start', { input })
      .then(() => {
        notify('execution started');
        setTimeout(load, 800);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'start failed'));
  };

  const inspect = (arn?: string) => {
    if (!arn) {
      return;
    }
    setError('');
    actOnResource<{ status?: string; output?: string | null }>(
      instance,
      'states', region,
      item.id,
      'describeExecution',
      { arn },
    )
      .then((data) => setOutput(`${data.result.status}: ${data.result.output ?? '(no output)'}`))
      .catch((err) => setError(err instanceof Error ? err.message : 'describe failed'));
  };

  return (
    <div className="space-y-3">
      <form onSubmit={start} className="flex flex-wrap gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="execution input JSON"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
        />
        <GhostButton type="submit">
          <Play className="h-3.5 w-3.5" /> Start execution
        </GhostButton>
        <GhostButton type="button" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" />
        </GhostButton>
      </form>
      <ActionError message={error} />
      {output ? <p className="font-mono text-xs text-emerald-300">{output}</p> : null}
      {executions === null ? (
        <p className="text-xs text-stone-500">loading executions…</p>
      ) : executions.length === 0 ? (
        <p className="text-xs text-stone-500">no executions yet</p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
          {executions.map((execution) => (
            <li key={execution.arn} className="flex items-center gap-2 px-3 py-1.5">
              <button
                type="button"
                onClick={() => inspect(execution.arn)}
                className="min-w-0 flex-1 truncate text-left font-mono text-xs text-stone-200 hover:text-amber-200"
              >
                {execution.name}
              </button>
              <span
                className={`rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px] ${
                  execution.status === 'SUCCEEDED'
                    ? 'bg-emerald-500/10 text-emerald-300'
                    : execution.status === 'FAILED'
                      ? 'bg-rose-500/10 text-rose-300'
                      : 'bg-amber-500/10 text-amber-200'
                }`}
              >
                {execution.status?.toLowerCase()}
              </span>
              <span className="text-[10px] text-stone-500">
                {execution.started ? timeAgo(execution.started) : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StreamActions({ instance, item, notify }: DetailProps) {
  const region = useRegion();
  const [key, setKey] = useState('');
  const [data, setData] = useState('');
  const [records, setRecords] = useState<
    { partitionKey?: string; data?: string; arrived?: string }[] | null
  >(null);
  const [error, setError] = useState('');

  const put = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    actOnResource(instance, 'kinesis', region, item.id, 'putRecord', {
      key: key.trim() || 'console',
      data,
    })
      .then(() => {
        notify('record published');
        setData('');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'put-record failed'));
  };

  const read = () => {
    setError('');
    actOnResource<{ records: { partitionKey?: string; data?: string; arrived?: string }[] }>(
      instance,
      'kinesis', region,
      item.id,
      'read',
    )
      .then((response) => setRecords(response.result.records))
      .catch((err) => setError(err instanceof Error ? err.message : 'read failed'));
  };

  return (
    <div className="space-y-3">
      <form onSubmit={put} className="flex flex-wrap gap-2">
        <input
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="partition key"
          className="w-36 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
        />
        <input
          value={data}
          onChange={(event) => setData(event.target.value)}
          placeholder="record data"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
        />
        <GhostButton type="submit">
          <Send className="h-3.5 w-3.5" /> Put record
        </GhostButton>
        <GhostButton type="button" onClick={read}>
          <Eye className="h-3.5 w-3.5" /> Read
        </GhostButton>
      </form>
      <ActionError message={error} />
      {records !== null ? (
        records.length === 0 ? (
          <p className="text-xs text-stone-500">stream is empty</p>
        ) : (
          <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
            {records.map((record, index) => (
              <li key={index} className="flex items-center gap-2 px-3 py-1.5">
                <span className="w-24 truncate font-mono text-[10px] text-stone-500">
                  {record.partitionKey}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-stone-200">
                  {record.data}
                </span>
                <span className="text-[10px] text-stone-500">
                  {record.arrived ? timeAgo(record.arrived) : ''}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function ApiActions({ instance, item, notify }: DetailProps) {
  const region = useRegion();
  const [routes, setRoutes] = useState<{ id?: string; key?: string; target?: string | null }[] | null>(null);
  const [routeKey, setRouteKey] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    actOnResource<{ routes: { id?: string; key?: string; target?: string | null }[] }>(
      instance,
      'apigw', region,
      item.id,
      'routes',
    )
      .then((data) => setRoutes(data.result.routes))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to list routes'));
  }, [instance, region, item.id]);

  useEffect(() => {
    load();
  }, [load]);

  const addRoute = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    actOnResource(instance, 'apigw', region, item.id, 'addRoute', {
      routeKey: routeKey.trim() || 'GET /',
    })
      .then(() => {
        notify('route added');
        setRouteKey('');
        load();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'add route failed'));
  };

  return (
    <div className="space-y-3">
      <form onSubmit={addRoute} className="flex flex-wrap gap-2">
        <input
          value={routeKey}
          onChange={(event) => setRouteKey(event.target.value)}
          placeholder="GET /orders"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
        />
        <GhostButton type="submit">
          <Plus className="h-3.5 w-3.5" /> Add route
        </GhostButton>
        <GhostButton type="button" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" />
        </GhostButton>
      </form>
      <ActionError message={error} />
      {routes === null ? (
        <p className="text-xs text-stone-500">loading routes…</p>
      ) : routes.length === 0 ? (
        <p className="text-xs text-stone-500">no routes yet</p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
          {routes.map((route) => (
            <li key={route.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-stone-200">{route.key}</span>
              <span className="truncate text-[10px] text-stone-500">{route.target ?? 'no integration'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UserPoolActions({ instance, item, notify }: DetailProps) {
  const region = useRegion();
  const [users, setUsers] = useState<
    { username?: string; status?: string; email?: string | null; created?: string }[] | null
  >(null);
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    actOnResource<{
      users: { username?: string; status?: string; email?: string | null; created?: string }[];
    }>(instance, 'cognito', region, item.id, 'users')
      .then((data) => setUsers(data.result.users))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to list users'));
  }, [instance, region, item.id]);

  useEffect(() => {
    load();
  }, [load]);

  const createUser = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) {
      return;
    }
    setError('');
    actOnResource(instance, 'cognito', region, item.id, 'createUser', { username: trimmed })
      .then(() => {
        notify(`user ${trimmed} created`);
        setUsername('');
        load();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'create user failed'));
  };

  const removeUser = (name?: string) => {
    if (!name) {
      return;
    }
    setError('');
    actOnResource(instance, 'cognito', region, item.id, 'deleteUser', { username: name })
      .then(() => {
        notify(`user ${name} deleted`);
        load();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'delete user failed'));
  };

  return (
    <div className="space-y-3">
      <form onSubmit={createUser} className="flex flex-wrap gap-2">
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="username or email"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
        />
        <GhostButton type="submit">
          <Plus className="h-3.5 w-3.5" /> Create user
        </GhostButton>
        <GhostButton type="button" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" />
        </GhostButton>
      </form>
      <ActionError message={error} />
      {users === null ? (
        <p className="text-xs text-stone-500">loading users…</p>
      ) : users.length === 0 ? (
        <p className="text-xs text-stone-500">no users yet</p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
          {users.map((user) => (
            <li key={user.username} className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-stone-200">
                {user.username}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-stone-400">
                {user.status?.toLowerCase().replace(/_/g, ' ')}
              </span>
              <button
                type="button"
                onClick={() => removeUser(user.username)}
                className="rounded-lg p-1 text-stone-500 transition hover:bg-white/10 hover:text-rose-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ZoneActions({ instance, item, notify }: DetailProps) {
  const region = useRegion();
  const [records, setRecords] = useState<
    { name?: string; type?: string; ttl?: number | null; values?: string[] }[] | null
  >(null);
  const [recordName, setRecordName] = useState('');
  const [recordType, setRecordType] = useState('A');
  const [recordValue, setRecordValue] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    actOnResource<{
      records: { name?: string; type?: string; ttl?: number | null; values?: string[] }[];
    }>(instance, 'route53', region, item.id, 'records')
      .then((data) => setRecords(data.result.records))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to list records'));
  }, [instance, region, item.id]);

  useEffect(() => {
    load();
  }, [load]);

  const upsert = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = recordName.trim();
    if (!trimmed) {
      return;
    }
    setError('');
    actOnResource(instance, 'route53', region, item.id, 'upsertRecord', {
      recordName: trimmed,
      type: recordType,
      value: recordValue.trim() || '127.0.0.1',
    })
      .then(() => {
        notify(`record ${trimmed} saved`);
        setRecordName('');
        setRecordValue('');
        load();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'upsert failed'));
  };

  return (
    <div className="space-y-3">
      <form onSubmit={upsert} className="flex flex-wrap gap-2">
        <input
          value={recordName}
          onChange={(event) => setRecordName(event.target.value)}
          placeholder={`app.${item.name.replace(/\.$/, '')}`}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
        />
        <select
          value={recordType}
          onChange={(event) => setRecordType(event.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-stone-200 outline-none"
        >
          <option value="A">A</option>
          <option value="AAAA">AAAA</option>
          <option value="CNAME">CNAME</option>
          <option value="TXT">TXT</option>
          <option value="MX">MX</option>
        </select>
        <input
          value={recordValue}
          onChange={(event) => setRecordValue(event.target.value)}
          placeholder="value"
          className="w-36 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
        />
        <GhostButton type="submit">
          <Plus className="h-3.5 w-3.5" /> Upsert
        </GhostButton>
        <GhostButton type="button" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" />
        </GhostButton>
      </form>
      <ActionError message={error} />
      {records === null ? (
        <p className="text-xs text-stone-500">loading records…</p>
      ) : records.length === 0 ? (
        <p className="text-xs text-stone-500">no records</p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
          {records.map((record, index) => (
            <li key={index} className="flex items-center gap-2 px-3 py-1.5">
              <span className="w-14 font-mono text-[10px] text-amber-200/80">{record.type}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-stone-200">
                {record.name}
              </span>
              <span className="min-w-0 flex-1 truncate text-right font-mono text-[10px] text-stone-500">
                {(record.values ?? []).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StackActions({ instance, item }: DetailProps) {
  const region = useRegion();
  const [status, setStatus] = useState('');
  const [resources, setResources] = useState<
    { logicalId?: string; physicalId?: string | null; type?: string; status?: string }[] | null
  >(null);
  const [events, setEvents] = useState<
    { at?: string; logicalId?: string; status?: string; reason?: string | null }[] | null
  >(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    actOnResource<{ status?: string }>(instance, 'cloudformation', region, item.id, 'describe')
      .then((data) => setStatus(data.result.status ?? ''))
      .catch((err) => setError(err instanceof Error ? err.message : 'describe failed'));
    actOnResource<{
      resources: { logicalId?: string; physicalId?: string | null; type?: string; status?: string }[];
    }>(instance, 'cloudformation', region, item.id, 'resources')
      .then((data) => setResources(data.result.resources))
      .catch(() => setResources([]));
  }, [instance, region, item.id]);

  useEffect(() => {
    load();
  }, [load]);

  const showEvents = () => {
    setError('');
    actOnResource<{
      events: { at?: string; logicalId?: string; status?: string; reason?: string | null }[];
    }>(instance, 'cloudformation', region, item.id, 'events')
      .then((data) => setEvents(data.result.events))
      .catch((err) => setError(err instanceof Error ? err.message : 'events failed'));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {status ? (
          <span
            className={`rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px] ${
              status.endsWith('COMPLETE') && !status.startsWith('DELETE')
                ? 'bg-emerald-500/10 text-emerald-300'
                : status.includes('FAILED') || status.startsWith('ROLLBACK')
                  ? 'bg-rose-500/10 text-rose-300'
                  : 'bg-amber-500/10 text-amber-200'
            }`}
          >
            {status.toLowerCase()}
          </span>
        ) : null}
        <GhostButton type="button" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </GhostButton>
        <GhostButton type="button" onClick={showEvents}>
          <ScrollText className="h-3.5 w-3.5" /> Events
        </GhostButton>
      </div>
      <ActionError message={error} />
      {resources === null ? (
        <p className="text-xs text-stone-500">loading resources…</p>
      ) : resources.length === 0 ? (
        <p className="text-xs text-stone-500">no resources</p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
          {resources.map((resource) => (
            <li key={resource.logicalId} className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-stone-200">
                {resource.logicalId}
              </span>
              <span className="truncate font-mono text-[10px] text-stone-500">{resource.type}</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-stone-400">
                {resource.status?.toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
      )}
      {events !== null ? (
        <ResultBox>
          {events
            .map((event) => `${event.at ?? ''}  ${event.status ?? ''}  ${event.logicalId ?? ''}${event.reason ? ` — ${event.reason}` : ''}`)
            .join('\n') || 'no events'}
        </ResultBox>
      ) : null}
    </div>
  );
}

function RepoImages({ instance, item }: DetailProps) {
  const region = useRegion();
  const [images, setImages] = useState<
    { tags?: string[]; digest?: string; sizeBytes?: number | null; pushed?: string }[] | null
  >(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    actOnResource<{
      images: { tags?: string[]; digest?: string; sizeBytes?: number | null; pushed?: string }[];
    }>(instance, 'ecr', region, item.id, 'images')
      .then((data) => setImages(data.result.images))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to list images'));
  }, [instance, region, item.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {item.detail ? <CopyButton value={item.detail} label="Copy URI" /> : null}
        <GhostButton type="button" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </GhostButton>
      </div>
      <ActionError message={error} />
      {images === null ? (
        <p className="text-xs text-stone-500">loading images…</p>
      ) : images.length === 0 ? (
        <p className="text-xs text-stone-500">no images pushed — docker push {item.detail ?? 'the repository URI'}</p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
          {images.map((image) => (
            <li key={image.digest} className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-stone-200">
                {(image.tags ?? []).join(', ') || 'untagged'}
              </span>
              <span className="truncate font-mono text-[10px] text-stone-500">
                {image.digest?.slice(0, 19)}
              </span>
              <span className="text-[10px] text-stone-500">
                {image.pushed ? timeAgo(image.pushed) : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmailActions({ instance, item, notify }: DetailProps) {
  const region = useRegion();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [messageId, setMessageId] = useState('');
  const [error, setError] = useState('');

  const send = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    actOnResource<{ messageId?: string }>(instance, 'ses', region, item.id, 'send', {
      to: to.trim() || item.id,
      subject: subject.trim() || 'Test from floci console',
      body: body.trim() || 'Hello from floci.',
    })
      .then((data) => {
        notify('email sent');
        setMessageId(data.result.messageId ?? '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'send failed'));
  };

  return (
    <div className="space-y-3">
      <form onSubmit={send} className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <input
            value={to}
            onChange={(event) => setTo(event.target.value)}
            placeholder="to@example.com"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
          />
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="subject"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="message body"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none focus:border-amber-400/50"
          />
          <GhostButton type="submit">
            <Send className="h-3.5 w-3.5" /> Send email
          </GhostButton>
        </div>
      </form>
      <ActionError message={error} />
      {messageId ? (
        <p className="font-mono text-xs text-emerald-300">sent · message id {messageId}</p>
      ) : null}
    </div>
  );
}

function ScheduleActions({ instance, item }: DetailProps) {
  const region = useRegion();
  const [detail, setDetail] = useState<{
    expression?: string;
    state?: string;
    target?: string | null;
  } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    actOnResource<{ expression?: string; state?: string; target?: string | null }>(
      instance,
      'scheduler', region,
      item.id,
      'describe',
    )
      .then((data) => setDetail(data.result))
      .catch((err) => setError(err instanceof Error ? err.message : 'describe failed'));
  }, [instance, region, item.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <GhostButton type="button" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </GhostButton>
      </div>
      <ActionError message={error} />
      {detail === null ? (
        <p className="text-xs text-stone-500">loading…</p>
      ) : (
        <div className="space-y-1 font-mono text-xs text-stone-300">
          <p>
            <span className="text-stone-500">expression </span>
            {detail.expression}
          </p>
          <p>
            <span className="text-stone-500">state </span>
            {detail.state?.toLowerCase()}
          </p>
          <p className="truncate">
            <span className="text-stone-500">target </span>
            {detail.target ?? 'none'}
          </p>
        </div>
      )}
    </div>
  );
}

function RdsActions({ instance, item }: DetailProps) {
  const region = useRegion();
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    actOnResource<Record<string, unknown>>(instance, 'rds', region, item.id, 'describe')
      .then((data) => setDetail(data.result))
      .catch((err) => setError(err instanceof Error ? err.message : 'describe failed'));
  }, [instance, region, item.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <GhostButton type="button" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </GhostButton>
      </div>
      <ActionError message={error} />
      {detail === null ? (
        <p className="text-xs text-stone-500">loading…</p>
      ) : (
        <div className="space-y-1 font-mono text-xs text-stone-300">
          {(['engine', 'class', 'status', 'endpoint', 'username', 'storageGb'] as const).map((field) => (
            <p key={field} className="truncate">
              <span className="text-stone-500">{field} </span>
              {String(detail[field] ?? '—')}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function EcsActions({ instance, item }: DetailProps) {
  const region = useRegion();
  const [detail, setDetail] = useState<{
    status?: string;
    runningTasks?: number;
    pendingTasks?: number;
    services?: string[];
    tasks?: string[];
  } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    actOnResource<{
      status?: string;
      runningTasks?: number;
      pendingTasks?: number;
      services?: string[];
      tasks?: string[];
    }>(instance, 'ecs', region, item.id, 'describe')
      .then((data) => setDetail(data.result))
      .catch((err) => setError(err instanceof Error ? err.message : 'describe failed'));
  }, [instance, region, item.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <GhostButton type="button" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </GhostButton>
      </div>
      <ActionError message={error} />
      {detail === null ? (
        <p className="text-xs text-stone-500">loading…</p>
      ) : (
        <div className="space-y-1 font-mono text-xs text-stone-300">
          <p>
            <span className="text-stone-500">status </span>
            {detail.status?.toLowerCase() ?? '—'}
          </p>
          <p>
            <span className="text-stone-500">tasks </span>
            {detail.runningTasks ?? 0} running · {detail.pendingTasks ?? 0} pending
          </p>
          <p className="truncate">
            <span className="text-stone-500">services </span>
            {detail.services?.length ? detail.services.join(', ') : 'none'}
          </p>
          <p className="truncate">
            <span className="text-stone-500">task list </span>
            {detail.tasks?.length ? detail.tasks.join(', ') : 'none'}
          </p>
        </div>
      )}
    </div>
  );
}

interface AthenaResult {
  executionId?: string;
  state?: string;
  reason?: string | null;
  columns?: string[];
  rows?: string[][];
}

function AthenaQuery({ instance, item }: DetailProps) {
  const region = useRegion();
  const [sql, setSql] = useState('SELECT 1 AS one, 2 AS two');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AthenaResult | null>(null);

  const run = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !sql.trim()) {
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    actOnResource<AthenaResult>(instance, 'athena', region, item.id, 'query', { sql })
      .then((data) => setResult(data.result))
      .catch((err) => setError(err instanceof Error ? err.message : 'query failed'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-3">
      <form onSubmit={run} className="space-y-2">
        <textarea
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          rows={4}
          spellCheck={false}
          placeholder="SELECT …"
          className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs leading-relaxed text-stone-100 outline-none transition focus:border-amber-400/50"
        />
        <PrimaryButton type="submit" disabled={busy} className="px-3 py-1.5 text-xs">
          <Play className="h-3.5 w-3.5" /> {busy ? 'Running…' : 'Run query'}
        </PrimaryButton>
      </form>
      <ActionError message={error} />
      {result ? (
        <div className="space-y-2">
          <p className="font-mono text-xs text-stone-400">
            <span
              className={
                result.state === 'SUCCEEDED'
                  ? 'text-emerald-300'
                  : result.state === 'FAILED'
                    ? 'text-rose-300'
                    : 'text-amber-300'
              }
            >
              {result.state?.toLowerCase()}
            </span>
            {result.executionId ? <span className="text-stone-600"> · {result.executionId}</span> : null}
          </p>
          {result.reason ? (
            <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 font-mono text-xs text-rose-200">
              {result.reason}
            </p>
          ) : null}
          {result.state === 'SUCCEEDED' ? (
            <div className="overflow-auto rounded-lg border border-white/10">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-white/[0.04] text-stone-400">
                  <tr>
                    {(result.columns ?? []).map((col) => (
                      <th key={col} className="px-3 py-1.5 font-medium">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-stone-200">
                  {(result.rows ?? []).map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="px-3 py-1.5">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {(result.rows ?? []).length === 0 ? (
                    <tr>
                      <td className="px-3 py-2 text-stone-500" colSpan={Math.max(result.columns?.length ?? 1, 1)}>
                        no rows
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function GlueTables({ instance, item }: DetailProps) {
  const region = useRegion();
  const [tables, setTables] = useState<
    { name?: string; location?: string | null; format?: string | null; columns?: string[] }[] | null
  >(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    actOnResource<{ tables: { name?: string; location?: string | null; format?: string | null; columns?: string[] }[] }>(
      instance,
      'glue', region,
      item.id,
      'tables',
    )
      .then((data) => setTables(data.result.tables))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to load tables'));
  }, [instance, region, item.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <GhostButton type="button" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh tables
        </GhostButton>
      </div>
      <ActionError message={error} />
      {tables === null ? (
        <p className="text-xs text-stone-500">loading…</p>
      ) : tables.length === 0 ? (
        <p className="text-xs text-stone-500">no tables in this database.</p>
      ) : (
        <ul className="space-y-2">
          {tables.map((table) => (
            <li key={table.name} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <p className="font-mono text-xs text-stone-100">{table.name}</p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-stone-500">
                {[table.format, table.location].filter(Boolean).join(' · ') || 'no storage descriptor'}
              </p>
              {table.columns?.length ? (
                <p className="mt-0.5 truncate font-mono text-[11px] text-stone-400">{table.columns.join(', ')}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CacheActions({ instance, item }: DetailProps) {
  const region = useRegion();
  const [detail, setDetail] = useState<{
    engine?: string;
    nodeType?: string;
    status?: string;
    nodes?: string[];
  } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    actOnResource<{ engine?: string; nodeType?: string; status?: string; nodes?: string[] }>(
      instance,
      'elasticache', region,
      item.id,
      'describe',
    )
      .then((data) => setDetail(data.result))
      .catch((err) => setError(err instanceof Error ? err.message : 'describe failed'));
  }, [instance, region, item.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <GhostButton type="button" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </GhostButton>
      </div>
      <ActionError message={error} />
      {detail === null ? (
        <p className="text-xs text-stone-500">loading…</p>
      ) : (
        <div className="space-y-1 font-mono text-xs text-stone-300">
          <p>
            <span className="text-stone-500">engine </span>
            {detail.engine ?? '—'}
          </p>
          <p>
            <span className="text-stone-500">node type </span>
            {detail.nodeType ?? '—'}
          </p>
          <p>
            <span className="text-stone-500">status </span>
            {detail.status ?? '—'}
          </p>
          <p className="truncate">
            <span className="text-stone-500">endpoints </span>
            {detail.nodes?.length ? detail.nodes.join(', ') : 'none yet'}
          </p>
        </div>
      )}
    </div>
  );
}

function FirehoseActions({ instance, item, notify }: DetailProps) {
  const region = useRegion();
  const [detail, setDetail] = useState<{
    status?: string;
    type?: string;
    arn?: string;
    destinations?: string[];
  } | null>(null);
  const [record, setRecord] = useState('{"event":"signup","user":"ada"}');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    actOnResource<{ status?: string; type?: string; arn?: string; destinations?: string[] }>(
      instance,
      'firehose', region,
      item.id,
      'describe',
    )
      .then((data) => setDetail(data.result))
      .catch((err) => setError(err instanceof Error ? err.message : 'describe failed'));
  }, [instance, region, item.id]);

  useEffect(() => {
    load();
  }, [load]);

  const putRecord = (event: FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setError('');
    actOnResource<{ recordId?: string }>(instance, 'firehose', region, item.id, 'put-record', {
      data: record,
    })
      .then((data) => notify(`record sent · ${(data.result.recordId ?? '').slice(0, 8)}…`))
      .catch((err) => setError(err instanceof Error ? err.message : 'put-record failed'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-3">
      <ActionError message={error} />
      {detail === null ? (
        <p className="text-xs text-stone-500">loading…</p>
      ) : (
        <div className="space-y-1 font-mono text-xs text-stone-300">
          <p>
            <span className="text-stone-500">status </span>
            {detail.status?.toLowerCase() ?? '—'}
            <span className="text-stone-500"> · type </span>
            {detail.type ?? '—'}
          </p>
          <p className="truncate">
            <span className="text-stone-500">destinations </span>
            {detail.destinations?.length ? detail.destinations.join(', ') : 'none'}
          </p>
        </div>
      )}
      <form onSubmit={putRecord} className="flex gap-2">
        <input
          value={record}
          onChange={(event) => setRecord(event.target.value)}
          placeholder="record payload"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-stone-100 outline-none transition focus:border-amber-400/50"
        />
        <PrimaryButton type="submit" disabled={busy} className="px-3 py-1.5 text-xs">
          <Send className="h-3.5 w-3.5" /> {busy ? 'Sending…' : 'Put record'}
        </PrimaryButton>
      </form>
    </div>
  );
}

function ApiExplorerView({ instance }: { instance: string }) {
  const region = useRegion();
  const [services, setServices] = useState<ExplorerService[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [operation, setOperation] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ status: number; contentType: string; body: string } | null>(
    null,
  );

  useEffect(() => {
    listExplorerServices(instance)
      .then((data) => {
        setServices(data.services);
        const first = data.services.find((s) => s.id === 'athena') ?? data.services[0];
        if (first) {
          setServiceId(first.id);
          setOperation(first.sampleOp);
          setBody(first.sampleBody);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to load services'));
  }, [instance]);

  const selected = services.find((s) => s.id === serviceId);

  const pickService = (id: string) => {
    setServiceId(id);
    setResult(null);
    setError('');
    const svc = services.find((s) => s.id === id);
    if (svc) {
      setOperation(svc.sampleOp);
      setBody(svc.sampleBody);
    }
  };

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!serviceId || !operation.trim() || busy) return;
    setBusy(true);
    setError('');
    exploreCall(instance, { service: serviceId, operation: operation.trim(), body, region })
      .then((res) => setResult(res))
      .catch((err) => setError(err instanceof Error ? err.message : 'call failed'))
      .finally(() => setBusy(false));
  };

  const prettyBody = (() => {
    if (!result) return '';
    if (result.contentType.includes('json')) {
      try {
        return JSON.stringify(JSON.parse(result.body), null, 2);
      } catch {
        return result.body;
      }
    }
    return result.body;
  })();

  const protoHint =
    selected?.proto === 'QUERY'
      ? 'Query protocol — operation is the Action name; body takes extra form params (Key=Value&…)'
      : selected?.proto === 'REST_JSON' || selected?.proto === 'REST_XML'
        ? selected.target
          ? 'JSON 1.1 via X-Amz-Target — operation name + JSON body, or "METHOD /path" for REST calls'
          : 'REST protocol — operation is "METHOD /path" (e.g. GET /2015-03-31/functions); body optional'
        : 'JSON protocol — operation is the API action name; body is the JSON request';

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-stone-100">API Explorer</h2>
      </div>
      <p className="mt-1 text-sm text-stone-500">
        Call any of the {services.length} AWS APIs on this instance — raw request, raw response.
      </p>

      <form onSubmit={send} className="mt-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={serviceId}
            onChange={(e) => pickService(e.target.value)}
            className="rounded-lg border border-white/10 bg-stone-900 px-3 py-2 font-mono text-xs text-stone-200 outline-none focus:border-emerald-500/50"
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </select>
          <input
            value={operation}
            onChange={(e) => setOperation(e.target.value)}
            placeholder={selected?.sampleOp || 'Operation or METHOD /path'}
            className="min-w-64 flex-1 rounded-lg border border-white/10 bg-stone-900 px-3 py-2 font-mono text-xs text-stone-200 outline-none placeholder:text-stone-600 focus:border-emerald-500/50"
          />
          <PrimaryButton type="submit" disabled={busy || !operation.trim()}>
            <Send className="h-3.5 w-3.5" /> {busy ? 'Calling…' : 'Send'}
          </PrimaryButton>
        </div>
        <p className="font-mono text-[11px] text-stone-600">{protoHint}</p>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          spellCheck={false}
          placeholder="request body"
          className="w-full rounded-lg border border-white/10 bg-stone-950 p-3 font-mono text-xs text-stone-300 outline-none placeholder:text-stone-700 focus:border-emerald-500/50"
        />
      </form>

      {error ? <p className="mt-3 text-xs text-rose-400">{error}</p> : null}

      {result ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-stone-950/60 p-4">
          <div className="flex items-center gap-3 font-mono text-xs">
            <span className={result.status < 400 ? 'text-emerald-300' : 'text-rose-300'}>
              HTTP {result.status}
            </span>
            <span className="text-stone-600">{result.contentType || 'no content-type'}</span>
          </div>
          <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-stone-300">
            {prettyBody || '(empty response)'}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
