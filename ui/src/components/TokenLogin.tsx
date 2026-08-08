import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { BrandMark, PrimaryButton } from './bits';
import { setToken } from '../lib/api';
import { useConfig } from '../lib/config';

export default function TokenLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const config = useConfig();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const token = value.trim();
    if (!token) {
      setError('Enter the access token configured on this cloud.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/instances', {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        setError('Invalid token.');
        return;
      }
      setToken(token);
      onSignedIn();
    } catch {
      setError('Could not reach the API.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="animate-rise-in flex flex-col items-center text-center">
        <BrandMark size="lg" />
        <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">FLOCI CLOUD</h1>
        <p className="mt-1.5 text-sm text-stone-400">
          Your own cloud on {config.instanceDomain} · driver: {config.driver}
        </p>
      </div>
      <form
        className="animate-rise-in w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-stone-400">
          Access token
        </label>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="FLOCI_CLOUD_TOKEN"
          className="w-full rounded-xl border border-white/10 bg-stone-950/60 px-3.5 py-2.5 text-sm outline-none transition focus:border-amber-500/60"
        />
        {error ? <p className="mt-2 text-xs text-rose-400">{error}</p> : null}
        <PrimaryButton className="mt-4 w-full justify-center" disabled={busy} type="submit">
          <KeyRound className="h-4 w-4" /> {busy ? 'Checking…' : 'Sign in'}
        </PrimaryButton>
      </form>
    </main>
  );
}
