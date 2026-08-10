import { Cpu, MemoryStick, Server, ShieldCheck } from 'lucide-react';
import type { ClusterInfo, ClusterNode } from '../lib/api';

function cores(milli: number): string {
  return (milli / 1000).toFixed(milli % 1000 === 0 ? 0 : 1);
}

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(0)} GiB`;
}

function UsageBar({ used, total }: { used: number | null; total: number }) {
  const pct = used !== null && total > 0 ? Math.min(100, Math.round((used / total) * 100)) : null;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      {pct !== null ? (
        <div
          className={`h-full rounded-full ${pct > 85 ? 'bg-rose-400' : pct > 65 ? 'bg-amber-400' : 'bg-emerald-400'}`}
          style={{ width: `${pct}%` }}
        />
      ) : null}
    </div>
  );
}

function NodeChip({ node }: { node: ClusterNode }) {
  const ready = node.state === 'ready';
  return (
    <div
      className="flex min-w-[10.5rem] shrink-0 flex-col gap-1.5 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
      title={node.addr ?? undefined}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`h-2 w-2 rounded-full ${ready ? 'bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/60' : 'bg-rose-400'}`}
        />
        <span className="truncate font-mono text-xs font-semibold text-stone-200">
          {node.hostname}
        </span>
        {node.role === 'manager' ? (
          <ShieldCheck className="ml-auto h-3.5 w-3.5 shrink-0 text-amber-400/80" />
        ) : null}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-stone-500">
        <span className="inline-flex items-center gap-1">
          <Cpu className="h-3 w-3" /> {cores(node.cpuTotalMilli)}
        </span>
        <span className="inline-flex items-center gap-1">
          <MemoryStick className="h-3 w-3" /> {gb(node.memTotalBytes)}
        </span>
      </div>
      <UsageBar used={node.memUsedBytes} total={node.memTotalBytes} />
    </div>
  );
}

/**
 * The cloud foundation strip: one cluster, N nodes, aggregate capacity.
 * Environments below run *on top* of this shared substrate.
 */
export default function ClusterBar({ cluster }: { cluster: ClusterInfo | null }) {
  if (!cluster) {
    return (
      <section className="mb-8 h-28 animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]" />
    );
  }

  const ready = cluster.nodes.filter((n) => n.state === 'ready').length;
  const { capacity } = cluster;

  return (
    <section className="mb-8 rounded-2xl border border-amber-400/15 bg-gradient-to-b from-amber-500/[0.06] to-transparent p-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-400/20 bg-amber-500/10">
            <Server className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h2 className="font-display text-sm font-bold tracking-tight">Cluster</h2>
            <p className="text-xs text-stone-500">
              {ready}/{cluster.nodes.length} nodes ready · {cluster.driver}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-5 text-xs text-stone-400">
          <div className="flex flex-col gap-1">
            <span className="inline-flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-stone-500" />
              {capacity.cpuUsedMilli !== null ? `${cores(capacity.cpuUsedMilli)} / ` : ''}
              {cores(capacity.cpuTotalMilli)} vCPU
            </span>
            <div className="w-36">
              <UsageBar used={capacity.cpuUsedMilli} total={capacity.cpuTotalMilli} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="inline-flex items-center gap-1.5">
              <MemoryStick className="h-3.5 w-3.5 text-stone-500" />
              {capacity.memUsedBytes !== null ? `${gb(capacity.memUsedBytes)} / ` : ''}
              {gb(capacity.memTotalBytes)} RAM
            </span>
            <div className="w-36">
              <UsageBar used={capacity.memUsedBytes} total={capacity.memTotalBytes} />
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 overflow-x-auto pb-1">
          <div className="ml-auto flex gap-2.5">
            {cluster.nodes.map((node) => (
              <NodeChip key={node.id} node={node} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
