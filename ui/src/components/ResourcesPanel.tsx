import {
  Archive,
  Bell,
  Boxes,
  Database,
  KeyRound,
  ListTree,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  createResource,
  deleteResource,
  listResources,
  type ResourceItem,
  type ServiceId,
} from '../lib/api';
import { GhostButton } from './bits';

const SERVICE_TABS: {
  id: ServiceId;
  label: string;
  icon: typeof Archive;
  noun: string;
  placeholder: string;
  hint?: string;
}[] = [
  { id: 's3', label: 'Buckets', icon: Archive, noun: 'bucket', placeholder: 'bucket name' },
  { id: 'sqs', label: 'Queues', icon: ListTree, noun: 'queue', placeholder: 'queue name' },
  { id: 'sns', label: 'Topics', icon: Bell, noun: 'topic', placeholder: 'topic name' },
  {
    id: 'dynamodb',
    label: 'Tables',
    icon: Database,
    noun: 'table',
    placeholder: 'table name',
    hint: 'partition key "id" (string), on-demand billing',
  },
  {
    id: 'ec2',
    label: 'Servers',
    icon: Server,
    noun: 'server',
    placeholder: 'server name',
    hint: 't3.micro simulated instance',
  },
  { id: 'secrets', label: 'Secrets', icon: KeyRound, noun: 'secret', placeholder: 'secret name' },
];

export default function ResourcesPanel({ instance }: { instance: string }) {
  const [service, setService] = useState<ServiceId>('s3');
  const [items, setItems] = useState<ResourceItem[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [pendingDelete, setPendingDelete] = useState('');

  const tab = SERVICE_TABS.find((entry) => entry.id === service) ?? SERVICE_TABS[0];

  const refresh = useCallback(() => {
    setError('');
    listResources(instance, service)
      .then((data) => setItems(data.resources))
      .catch((err) => {
        setItems([]);
        setError(err instanceof Error ? err.message : 'failed to load resources');
      });
  }, [instance, service]);

  useEffect(() => {
    setItems(null);
    setPendingDelete('');
    refresh();
  }, [refresh]);

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) {
      return;
    }
    setBusy(true);
    setError('');
    createResource(instance, service, {
      name: name.trim(),
      ...(service === 'secrets' ? { value: secretValue } : {}),
    })
      .then(() => {
        setName('');
        setSecretValue('');
        refresh();
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'create failed'))
      .finally(() => setBusy(false));
  };

  const onDelete = (id: string) => {
    if (pendingDelete !== id) {
      setPendingDelete(id);
      return;
    }
    setPendingDelete('');
    setError('');
    deleteResource(instance, service, id)
      .then(refresh)
      .catch((err) => setError(err instanceof Error ? err.message : 'delete failed'));
  };

  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-stone-500">
          <Boxes className="h-3.5 w-3.5" /> Resources
        </h3>
        <GhostButton onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </GhostButton>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {SERVICE_TABS.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setService(entry.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                service === entry.id
                  ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                  : 'border-white/10 bg-white/5 text-stone-400 hover:text-stone-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {entry.label}
            </button>
          );
        })}
      </div>

      <form onSubmit={onCreate} className="mt-3 space-y-2">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={tab.placeholder}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-400/50 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!name.trim() || busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-3 py-1.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            Create {tab.noun}
          </button>
        </div>
        {service === 'secrets' ? (
          <input
            value={secretValue}
            onChange={(event) => setSecretValue(event.target.value)}
            placeholder="secret value"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-400/50 focus:outline-none"
          />
        ) : null}
        {tab.hint ? <p className="text-xs text-stone-600">{tab.hint}</p> : null}
      </form>

      {error ? (
        <p className="mt-2 rounded-lg border border-rose-400/30 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
          {error}
        </p>
      ) : null}

      <ul className="mt-3 space-y-1.5">
        {items === null ? (
          <li className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-sm text-stone-500">
            Loading…
          </li>
        ) : items.length === 0 ? (
          <li className="rounded-lg border border-dashed border-white/10 px-3 py-2 text-sm text-stone-500">
            No {tab.label.toLowerCase()} yet — create one above.
          </li>
        ) : (
          items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.03] py-1.5 pl-3 pr-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm text-stone-200">{item.name}</p>
                {item.detail ? (
                  <p className="truncate font-mono text-[11px] text-stone-500">{item.detail}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onDelete(item.id)}
                onBlur={() => setPendingDelete('')}
                className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium transition ${
                  pendingDelete === item.id
                    ? 'bg-rose-500/20 text-rose-200'
                    : 'text-stone-500 hover:bg-white/10 hover:text-rose-300'
                }`}
                aria-label={`Delete ${item.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {pendingDelete === item.id ? 'Confirm' : ''}
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
