// CloudDriver — the contract every provisioning backend (Kubernetes, Docker
// Swarm, …) must fulfil. server.ts talks only to this interface so floci-cloud
// runs identically on a K8s cluster, a VM fleet, or bare-metal Ubuntu boxes.
import type { RealServiceId, RealServiceInfo } from './services.ts';

// `queued` means the request is accepted but the pool has nowhere to put it.
// It is not an error: both schedulers keep the task and place it as soon as a
// node fits, so the workspace comes up on its own once capacity is added.
export type InstanceStatus =
  | 'provisioning'
  | 'queued'
  | 'running'
  | 'error'
  | 'deleting';

export interface InstanceInfo {
  name: string;
  status: InstanceStatus;
  statusDetail: string | null;
  host: string;
  endpoint: string;
  createdAt: string | null;
  expiresAt: string | null;
  image: string;
  readyReplicas: number;
}

export type OtelAgentRunStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface OtelAgentRun {
  id: string;
  status: OtelAgentRunStatus;
  repoUrl: string;
  model: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface OtelAgentOptions {
  repoUrl: string;
  githubToken: string;
  model?: string;
  baseBranch?: string;
  maxFiles?: number;
}

export interface ServiceMetrics {
  service: string;
  cpuMilli: number;
  memoryBytes: number;
  pods: number;
}

export interface InstanceMetrics {
  instance: string;
  sampledAt: string;
  services: ServiceMetrics[];
}

export interface NodeInfo {
  id: string;
  hostname: string;
  role: 'manager' | 'worker';
  state: string;
  addr: string | null;
  cpuTotalMilli: number;
  memTotalBytes: number;
  /** live usage when the backend can measure it (metrics-server / local stats) */
  cpuUsedMilli: number | null;
  memUsedBytes: number | null;
}

/** Effective config of one running swarm service (post-provision panel). */
export interface ServiceConfigInfo {
  name: string;
  image: string;
  env: string[];
  mounts: { source: string; target: string; type: string }[];
  ports: { published: number | null; target: number; protocol: string }[];
  replicas: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** One owned service the shared log console can attach to. */
export interface ServiceTargetInfo {
  /** full swarm service name (target for logs/exec/config) */
  name: string;
  /** 'catalog' | 'compute' */
  kind: string;
  /** catalog service id or compute kind, when known */
  service: string | null;
  /** human label for pickers */
  label: string;
}

/** Thrown by drivers when an instance name is already taken. */
export class ConflictError extends Error {
  readonly statusCode = 409;
}

export function statusCodeOf(err: unknown): number | undefined {
  const candidate = err as { code?: unknown; statusCode?: unknown };
  if (typeof candidate?.statusCode === 'number') {
    return candidate.statusCode;
  }
  if (typeof candidate?.code === 'number') {
    return candidate.code;
  }
  return undefined;
}

export function isNotFound(err: unknown): boolean {
  return statusCodeOf(err) === 404;
}

export function isConflict(err: unknown): boolean {
  return err instanceof ConflictError || statusCodeOf(err) === 409;
}

export interface CloudDriver {
  /** which backend this driver drives — surfaced in /api/config and admin */
  readonly kind: 'kubernetes' | 'swarm';

  // — instance lifecycle —
  list(): Promise<InstanceInfo[]>;
  get(name: string): Promise<InstanceInfo | null>;
  create(name: string, ttlHours: number | null): Promise<InstanceInfo>;
  delete(name: string): Promise<boolean>;
  logs(name: string, tailLines: number): Promise<string>;
  reapExpired(): Promise<string[]>;

  // — addressing —
  /** public hostname of the instance's emulator endpoint */
  hostFor(name: string): string;
  scheme(): string;
  /** endpoint the API server itself should use to reach the emulator (internal network preferred) */
  awsEndpointFor(name: string): string;

  // — catalog services —
  listServices(name: string): Promise<RealServiceInfo[]>;
  getService(name: string, service: RealServiceId): Promise<RealServiceInfo>;
  serviceLogs(name: string, service: RealServiceId, tailLines: number): Promise<string>;
  startService(name: string, service: RealServiceId, instanceName?: string): Promise<void>;
  stopService(name: string, service: RealServiceId, instanceName?: string): Promise<void>;

  // — post-provision panel (optional; swarm only for now) —
  /** follow-mode log stream for any owned service; caller must close() */
  streamServiceLogs?(
    name: string,
    target: string,
    tailLines: number,
  ): Promise<{ stream: NodeJS.ReadableStream; close: () => void }>;
  /** one-shot exec inside the newest task's container */
  execInService?(
    name: string,
    target: string,
    cmd: string[],
    timeoutMs?: number,
  ): Promise<{ output: string; exitCode: number | null; timedOut: boolean }>;
  getServiceConfig?(name: string, target: string): Promise<ServiceConfigInfo>;
  updateServiceEnv?(name: string, target: string, env: string[]): Promise<void>;
  /** every owned swarm service, for the shared log console picker */
  listServiceTargets?(name: string): Promise<ServiceTargetInfo[]>;

  // — observability —
  instanceMetrics(name: string): Promise<InstanceMetrics>;
  /** cluster nodes + real capacity, for the admin dashboard */
  nodes(): Promise<NodeInfo[]>;
  /** command an operator runs on a fresh Ubuntu box to join this cluster (null on k8s) */
  joinCommand(): Promise<string | null>;

  // — agents —
  runOtelAgent(name: string, options: OtelAgentOptions): Promise<OtelAgentRun>;
  listOtelAgentRuns(name: string): Promise<OtelAgentRun[]>;
  otelAgentLogs(name: string, runId: string, tailLines: number): Promise<string>;
}
