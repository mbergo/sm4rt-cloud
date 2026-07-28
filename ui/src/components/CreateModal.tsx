import { Dices, Loader2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError, createInstance, type Instance } from '../lib/api';
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const instance = await createInstance({
        name: name.trim() || undefined,
        ttlHours: ttl,
      });
      onCreated(instance);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create the instance.');
      setBusy(false);
    }
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
          An isolated Floci emulator with its own AWS endpoint, provisioned on AKS.
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
