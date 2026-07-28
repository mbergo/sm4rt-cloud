import { Clock, Timer, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Instance } from '../lib/api';
import { timeAgo, timeUntil } from '../lib/format';
import { CopyButton, StatusBadge } from './bits';

export default function InstanceCard({
  instance,
  onSelect,
  onDelete,
}: {
  instance: Instance;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) {
      return;
    }
    const timer = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const deleting = instance.status === 'deleting';

  return (
    <article
      onClick={deleting ? undefined : onSelect}
      className={`group animate-rise-in rounded-2xl border border-white/10 bg-white/5 p-5 transition ${
        deleting
          ? 'opacity-50'
          : 'cursor-pointer hover:border-amber-400/30 hover:bg-white/[0.07] hover:shadow-xl hover:shadow-amber-500/5'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-base font-bold tracking-tight">
            {instance.name}
          </h3>
          <div className="mt-1.5">
            <StatusBadge status={instance.status} detail={instance.statusDetail} />
          </div>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (confirming) {
              setConfirming(false);
              onDelete();
            } else {
              setConfirming(true);
            }
          }}
          disabled={deleting}
          className={`inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-medium transition disabled:opacity-40 ${
            confirming
              ? 'border-rose-400/40 bg-rose-500/15 text-rose-300'
              : 'border-transparent text-stone-500 hover:border-white/10 hover:bg-white/5 hover:text-stone-300'
          }`}
          aria-label={confirming ? 'Confirm delete' : 'Delete instance'}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {confirming ? 'Sure?' : null}
        </button>
      </div>

      <div
        className="mt-4 flex items-center gap-1 rounded-lg border border-white/5 bg-black/30 py-1 pl-3 pr-1"
        onClick={(event) => event.stopPropagation()}
      >
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-amber-200/90">
          {instance.endpoint}
        </code>
        <CopyButton value={instance.endpoint} />
      </div>

      <div className="mt-3.5 flex items-center gap-4 text-xs text-stone-500">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" /> {timeAgo(instance.createdAt)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Timer className="h-3 w-3" /> expires {timeUntil(instance.expiresAt)}
        </span>
      </div>
    </article>
  );
}
