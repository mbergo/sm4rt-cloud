import { Check, Copy, Dices, Loader2, Terminal, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ApiError,
  createInstance,
  openProvisionEvents,
  type Instance,
  type ProvisionEvent,
} from '../lib/api';
import { GhostButton, PrimaryButton } from './bits';

const SUGGESTION_ADJECTIVES = [
  'amber', 'bold', 'brisk', 'calm', 'clever', 'cosmic', 'crisp', 'eager',
  'fleet', 'gentle', 'golden', 'happy', 'keen', 'lively', 'lunar', 'mellow',
  'nimble', 'polar', 'quiet', 'rapid', 'solar', 'sturdy', 'swift', 'vivid',
];
const SUGGESTION_ANIMALS = [
  'badger', 'bison', 'condor', 'coyote', 'dolphin', 'falcon', 'gecko',
  'heron', 'ibis', 'jaguar', 'koala', 'lemur', 'lynx', 'marmot', 'narwhal',
  'otter', 'panda', 'parakeet', 'puffin', 'quokka', 'raven', 'tapir',
  'toucan', 'wombat',
];

const TTL_OPTIONS: { label: string; value: number | null }[] = [
  { label: '1h', value: 1 },
  { label: '8h', value: 8 },
  { label: '24h', value: 24 },
  { label: '7d', value: 168 },
  { label: 'Never', value: null },
];

function suggestName(): string {
  const adjective = SUGGESTION_ADJECTIVES[Math.floor(Math.random() * SUGGESTION_ADJECTIVES.length)];
  const animal = SUGGESTION_ANIMALS[Math.floor(Math.random() * SUGGESTION_ANIMALS.length)];
  return `${adjective}-${animal}`;
}

export default function CreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (instance: Instance) => void;
}) {
  const [name, setName] = useState('');
  const [ttl, setTtl] = useState<number | null>(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [instance, setInstance] = useState<Instance | null>(null);
  const [events, setEvents] = useState<ProvisionEvent[]>([]);
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState('');
  const termRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => sourceRef.current?.close();
  }, []);

  useEffect(() => {
    termRef.current?.scrollTo({ top: termRef.current.scrollHeight });
  }, [events]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await createInstance({
        name: name.trim() || undefined,
        ttlHours: ttl,
      });
      setInstance(created);
      const source = await openProvisionEvents(created.name);
      sourceRef.current = source;
      source.onmessage = (message) => {
        const parsed = JSON.parse(message.data) as ProvisionEvent;
        setEvents((prev) => [...prev.slice(-299), parsed]);
        if (parsed.kind === 'done') {
          setReady(true);
          source.close();
        }
      };
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create the instance.');
      setBusy(false);
    }
  }

  function copy(value: string, key: string) {
    void navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(''), 1500);
  }

  function finish() {
    if (instance) {
      onCreated(instance);
    }
  }

  const awsCli = instance
    ? `aws --endpoint-url ${instance.endpoint} s3 mb s3://demo && aws --endpoint-url ${instance.endpoint} s3 ls`
    : '';

  if (instance) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
        <div
          className="animate-rise-in w-full max-w-2xl rounded-2xl border border-white/10 bg-stone-900/95 p-6 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display flex items-center gap-2 text-lg font-bold tracking-tight">
              <Terminal className="h-4 w-4 text-amber-300" />
              Provisioning {instance.name}
            </h2>
            {ready ? (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                <Check className="h-3 w-3" /> ready
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
                <Loader2 className="h-3 w-3 animate-spin" /> provisioning
              </span>
            )}
          </div>

          <div
            ref={termRef}
            className="mt-4 h-56 overflow-y-auto rounded-xl border border-white/10 bg-black/70 p-3 font-mono text-xs leading-relaxed"
          >
            {events.length === 0 ? (
              <p className="text-stone-500">waiting for events…</p>
            ) : (
              events.map((line, index) => (
                <p
                  key={index}
                  className={
                    line.kind === 'err'
                      ? 'text-rose-300'
                      : line.kind === 'ok' || line.kind === 'done'
                        ? 'text-emerald-300'
                        : 'text-stone-300'
                  }
                >
                  <span className="mr-2 text-stone-600">
                    {new Date(line.ts).toLocaleTimeString()}
                  </span>
                  {line.kind === 'ok' ? '✔ ' : line.kind === 'err' ? '✘ ' : ''}
                  {line.line}
                </p>
              ))
            )}
          </div>

          {ready ? (
            <div className="mt-4 space-y-2 rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                Instance details
              </p>
              {[
                { key: 'endpoint', label: 'AWS endpoint', value: instance.endpoint },
                { key: 'creds', label: 'Credentials', value: 'AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test' },
                { key: 'cli', label: 'Try it', value: awsCli },
              ].map((row) => (
                <div key={row.key} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-xs text-stone-400">{row.label}</span>
                  <code className="flex-1 truncate rounded bg-black/40 px-2 py-1 font-mono text-xs text-stone-200">
                    {row.value}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(row.value, row.key)}
                    className="rounded p-1 text-stone-500 transition hover:bg-white/10 hover:text-white"
                  >
                    {copied === row.key ? (
                      <Check className="h-3.5 w-3.5 text-emerald-300" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <PrimaryButton onClick={finish}>
              {ready ? 'Open console' : 'Continue in background'}
            </PrimaryButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="animate-rise-in w-full max-w-md rounded-2xl border border-white/10 bg-stone-900/95 p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold tracking-tight">New instance</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-500 transition hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-sm text-stone-400">
          An isolated AWS environment with its own endpoint and live provisioning terminal.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-stone-400">
              Name <span className="text-stone-600">(optional — generated if empty)</span>
            </span>
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value.toLowerCase())}
                placeholder="e.g. swift-otter"
                pattern="[a-z][a-z0-9\-]{0,27}"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-400/50 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
              />
              <GhostButton onClick={() => setName(suggestName())} className="shrink-0">
                <Dices className="h-4 w-4" />
              </GhostButton>
            </div>
          </label>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-stone-400">
              Auto-delete after
            </span>
            <div className="grid grid-cols-5 gap-1.5">
              {TTL_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => setTtl(option.value)}
                  className={`rounded-lg border px-2 py-1.5 text-sm font-medium transition ${
                    ttl === option.value
                      ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                      : 'border-white/10 bg-white/5 text-stone-400 hover:border-white/20 hover:text-stone-200'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {error ? <p className="text-sm text-rose-300">{error}</p> : null}

          <div className="flex justify-end gap-2 pt-1">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <PrimaryButton type="submit" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? 'Provisioning' : 'Create instance'}
            </PrimaryButton>
          </div>
        </form>
      </div>
    </div>
  );
}
