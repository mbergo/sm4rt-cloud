import { KeyRound, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError, setToken, validateToken } from '../lib/api';
import { BrandMark, PrimaryButton } from './bits';

export default function Login({ onAuthed }: { onAuthed: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const token = value.trim();
    if (!token || busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await validateToken(token);
      setToken(token);
      onAuthed();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Invalid access token.');
      } else {
        setError('Could not reach the SM4RT-CLOUD API.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="animate-rise-in w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
        <div className="flex flex-col items-center text-center">
          <BrandMark size="lg" />
          <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">SM4RT-CLOUD</h1>
          <p className="mt-1.5 text-sm text-stone-400">
            On-demand AWS emulator instances, running on your AKS cluster.
          </p>
        </div>
        <form onSubmit={submit} className="mt-8 space-y-3">
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-stone-400">
              <KeyRound className="h-3.5 w-3.5" /> Access token
            </span>
            <input
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="paste your token"
              autoFocus
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-400/50 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
            />
          </label>
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          <PrimaryButton type="submit" disabled={busy || !value.trim()} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Connect
          </PrimaryButton>
        </form>
      </div>
    </main>
  );
}
