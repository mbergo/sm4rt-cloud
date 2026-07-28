import { ExternalLink, RefreshCw, ScrollText, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getInstance, getLogs, type InstanceDetail } from '../lib/api';
import { snippets, timeAgo, timeUntil } from '../lib/format';
import { CopyButton, GhostButton, StatusBadge } from './bits';
import ResourcesPanel from './ResourcesPanel';

export default function DetailDrawer({
  name,
  onClose,
}: {
  name: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<InstanceDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [snippet, setSnippet] = useState('cli');
  const [logs, setLogs] = useState('');
  const [logsBusy, setLogsBusy] = useState(false);
  const logsRef = useRef<HTMLPreElement>(null);

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

  const refreshLogs = useCallback(() => {
    setLogsBusy(true);
    getLogs(name)
      .then((data) => {
        setLogs(data.logs || 'no log output yet');
        requestAnimationFrame(() => {
          logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight });
        });
      })
      .catch(() => setLogs('failed to fetch logs'))
      .finally(() => setLogsBusy(false));
  }, [name]);

  useEffect(() => {
    refreshLogs();
  }, [refreshLogs]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const healthServices =
    detail?.health &&
    typeof detail.health === 'object' &&
    detail.health.services &&
    typeof detail.health.services === 'object'
      ? Object.entries(detail.health.services as Record<string, unknown>)
      : [];

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="animate-drawer-in flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-white/10 bg-stone-950 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/5 bg-stone-950/90 px-6 py-4 backdrop-blur">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-bold tracking-tight">{name}</h2>
            {detail ? (
              <div className="mt-1">
                <StatusBadge status={detail.status} detail={detail.statusDetail} />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-500 transition hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-6">
          {missing ? (
            <p className="text-sm text-stone-400">This instance no longer exists.</p>
          ) : null}

          {detail ? (
            <>
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
                    <dd className="mt-0.5 truncate font-mono text-xs text-stone-200">
                      {detail.image}
                    </dd>
                  </div>
                </dl>
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-stone-500">
                  Connect
                </h3>
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
                      <CopyButton
                        value={item.code}
                        className="absolute right-2 top-2 bg-stone-900/80"
                      />
                    </div>
                  ))}
              </section>

              {healthServices.length > 0 ? (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-stone-500">
                    Services
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

              {detail.status === 'running' ? <ResourcesPanel instance={name} /> : null}

              <section>
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-stone-500">
                    <ScrollText className="h-3.5 w-3.5" /> Logs
                  </h3>
                  <GhostButton onClick={refreshLogs} disabled={logsBusy}>
                    <RefreshCw className={`h-3.5 w-3.5 ${logsBusy ? 'animate-spin' : ''}`} />
                    Refresh
                  </GhostButton>
                </div>
                <pre
                  ref={logsRef}
                  className="mt-2 max-h-72 overflow-auto rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-[11px] leading-relaxed text-stone-300"
                >
                  {logs || 'loading logs…'}
                </pre>
              </section>
            </>
          ) : missing ? null : (
            <p className="text-sm text-stone-500">Loading…</p>
          )}
        </div>
      </aside>
    </div>
  );
}
