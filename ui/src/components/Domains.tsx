import {
  AlertTriangle,
  BadgeCheck,
  Globe2,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  deleteDomain,
  getWorkspaceDomain,
  listDomains,
  registerDomain,
  setWorkspaceDomain,
  verifyDomain,
  type DomainInfo,
  type WorkspaceDomain,
} from '../lib/domains';
import { timeAgo } from '../lib/format';
import { CopyButton, GhostButton, PrimaryButton } from './bits';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'request failed';
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-white/5 bg-white/[0.03] ${className}`}>{children}</div>
  );
}

function StatusPill({ status }: { status: DomainInfo['status'] }) {
  if (status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
        <BadgeCheck className="h-3.5 w-3.5" /> Verified
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" /> Pending DNS setup
    </span>
  );
}

function RecordRow({ type, name, value }: { type: string; name: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-black/25 px-3 py-2">
      <span className="w-14 shrink-0 rounded-md bg-white/5 px-2 py-0.5 text-center font-mono text-[10px] font-semibold uppercase tracking-wider text-teal-300">
        {type}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <p className="truncate font-mono text-xs text-stone-200">{name}</p>
          <CopyButton value={name} />
        </div>
        <div className="flex items-center gap-1">
          <p className="truncate font-mono text-xs text-stone-400">→ {value}</p>
          <CopyButton value={value} />
        </div>
      </div>
    </div>
  );
}

function DomainCard({
  row,
  isDefault,
  notify,
  refresh,
  onSetDefault,
}: {
  row: DomainInfo;
  isDefault: boolean;
  notify: (message: string, tone?: 'ok' | 'err') => void;
  refresh: () => void;
  onSetDefault: (domain: string) => void;
}) {
  const [verifying, setVerifying] = useState(false);
  const [verifyDetail, setVerifyDetail] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);

  useEffect(() => {
    if (!pendingDelete) return;
    const timer = setTimeout(() => setPendingDelete(false), 3000);
    return () => clearTimeout(timer);
  }, [pendingDelete]);

  const runVerify = async () => {
    setVerifying(true);
    setVerifyDetail(null);
    try {
      const res = await verifyDomain(row.domain);
      if (res.ok) {
        notify(`${row.domain} verified — you can set it as the workspace default now.`);
        setVerifyDetail(null);
        refresh();
      } else {
        setVerifyDetail(res.detail);
      }
    } catch (err) {
      setVerifyDetail(errMsg(err));
    } finally {
      setVerifying(false);
    }
  };

  const runDelete = async () => {
    if (!pendingDelete) {
      setPendingDelete(true);
      return;
    }
    try {
      const res = await deleteDomain(row.domain);
      notify(
        res.workspacesReset.length
          ? `${row.domain} removed — endpoints moved back to the platform domain.`
          : `${row.domain} removed.`,
      );
      refresh();
    } catch (err) {
      notify(errMsg(err), 'err');
    }
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5">
            <Globe2 className="h-[18px] w-[18px] text-teal-300" />
          </div>
          <div>
            <p className="font-mono text-sm font-semibold text-stone-100">{row.domain}</p>
            <p className="text-xs text-stone-500">
              added {timeAgo(row.createdAt)}
              {row.verifiedAt ? ` · verified ${timeAgo(row.verifiedAt)}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isDefault ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-400/20 bg-teal-500/10 px-2.5 py-0.5 text-xs font-medium text-teal-300">
              <ShieldCheck className="h-3.5 w-3.5" /> Workspace default
            </span>
          ) : null}
          <StatusPill status={row.status} />
          <button
            type="button"
            onClick={() => void runDelete()}
            className={`rounded-lg p-1.5 text-xs transition ${
              pendingDelete
                ? 'bg-rose-500/90 px-2 font-semibold text-white'
                : 'text-stone-500 hover:bg-white/10 hover:text-rose-300'
            }`}
          >
            {pendingDelete ? 'Confirm?' : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {row.status !== 'verified' ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs leading-relaxed text-stone-400">
            Create these records at your DNS provider. This proves you own the domain and routes
            traffic to the platform edge — Sm4rt Cloud never touches your DNS.
          </p>
          <div className="space-y-2">
            {row.records.map((rec) => (
              <RecordRow key={`${rec.type}:${rec.name}`} type={rec.type} name={rec.name} value={rec.value} />
            ))}
          </div>
          {verifyDetail ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {verifyDetail}. DNS changes can take a few minutes (sometimes up to your record TTL)
                to propagate — try again shortly.
              </span>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <PrimaryButton onClick={() => void runVerify()} disabled={verifying}>
              {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
              {verifying ? 'Checking DNS…' : 'Verify'}
            </PrimaryButton>
          </div>
        </div>
      ) : !isDefault ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/20 px-3 py-2.5">
          <p className="text-xs leading-relaxed text-stone-400">
            Make this the workspace default — new and existing endpoints will move to{' '}
            <span className="font-mono text-stone-300">*.{row.domain}</span>.
          </p>
          <GhostButton onClick={() => onSetDefault(row.domain)}>
            <ShieldCheck className="h-3.5 w-3.5" /> Set as default
          </GhostButton>
        </div>
      ) : null}
    </Card>
  );
}

export default function DomainsPage({
  instance,
  notify,
}: {
  instance: string;
  notify: (message: string, tone?: 'ok' | 'err') => void;
}) {
  const [domains, setDomains] = useState<DomainInfo[] | null>(null);
  const [wsDomain, setWsDomain] = useState<WorkspaceDomain | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDefault, setConfirmDefault] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const refresh = useCallback(() => {
    Promise.all([listDomains(instance), getWorkspaceDomain(instance)])
      .then(([d, w]) => {
        setDomains(d.domains);
        setWsDomain(w);
        setError(null);
      })
      .catch((err) => setError(errMsg(err)));
  }, [instance]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const register = async () => {
    const domain = input.trim().toLowerCase();
    if (!domain) return;
    setBusy(true);
    try {
      await registerDomain(instance, domain);
      setInput('');
      notify(`${domain} registered — now create the DNS records shown below.`);
      refresh();
    } catch (err) {
      notify(errMsg(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const applyDefault = async (domain: string | null) => {
    setApplying(true);
    try {
      const res = await setWorkspaceDomain(instance, domain);
      const count = res.relabeled.length;
      notify(
        domain
          ? `Default domain set to ${domain}${count ? ` — ${count} endpoint${count === 1 ? '' : 's'} relabeled` : ''}.`
          : 'Endpoints moved back to the platform domain.',
      );
      setConfirmDefault(null);
      refresh();
    } catch (err) {
      notify(errMsg(err), 'err');
    } finally {
      setApplying(false);
    }
  };

  const effectiveDefault = wsDomain?.defaultDomain ?? null;

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5">
            <Globe2 className="h-5 w-5 text-amber-300" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-stone-100">Custom domains</h2>
            <p className="text-xs text-stone-500">
              Serve endpoints from your own domain instead of the platform DNS
            </p>
          </div>
        </div>
        <GhostButton onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </GhostButton>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
              Endpoints for this workspace use
            </p>
            <p className="mt-1 font-mono text-sm text-stone-100">
              {effectiveDefault
                ? `*.${effectiveDefault}`
                : `*.${instance}.${wsDomain?.platformDomain ?? '…'}`}
            </p>
            <p className="mt-0.5 text-xs text-stone-500">
              {effectiveDefault
                ? 'Custom domain (yours)'
                : 'Platform domain — register a domain below to use your own'}
            </p>
          </div>
          {effectiveDefault ? (
            <GhostButton onClick={() => void applyDefault(null)} disabled={applying}>
              {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Revert to platform domain
            </GhostButton>
          ) : null}
        </div>
      </Card>

      <Card className="p-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void register();
          }}
        >
          <label className="min-w-64 flex-1">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-stone-500">
              Register a domain you own
            </span>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="acme-corp.com"
              spellCheck={false}
              autoComplete="off"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-400/50 focus:outline-none"
            />
          </label>
          <PrimaryButton type="submit" disabled={busy || !input.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Register
          </PrimaryButton>
        </form>
        <p className="mt-2 text-xs text-stone-500">
          You keep full control of your DNS: we only give you the records to create and check they
          resolve. One default domain per workspace; extra domains stay available for manual use.
        </p>
      </Card>

      {domains === null && !error ? (
        <div className="h-24 animate-pulse rounded-xl border border-white/5 bg-white/[0.03]" />
      ) : domains && domains.length === 0 ? (
        <Card>
          <p className="px-4 py-8 text-center text-sm text-stone-500">
            No custom domains yet. Register one above to serve endpoints from your own DNS.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {domains?.map((row) => (
            <DomainCard
              key={row.domain}
              row={row}
              isDefault={effectiveDefault === row.domain}
              notify={notify}
              refresh={refresh}
              onSetDefault={(domain) => setConfirmDefault(domain)}
            />
          ))}
        </div>
      )}

      {confirmDefault ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
          <div className="animate-rise-in w-full max-w-md rounded-2xl border border-white/10 bg-stone-950 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-400/20 bg-amber-500/10">
                <AlertTriangle className="h-5 w-5 text-amber-300" />
              </div>
              <h3 className="font-display text-base font-semibold text-stone-100">
                Switch default domain?
              </h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-stone-400">
              All endpoints in <span className="font-mono text-stone-200">{instance}</span> — tasks,
              gateways, CDN, DevOps, observability — will move to{' '}
              <span className="font-mono text-stone-200">*.{confirmDefault}</span>. Old platform
              URLs stop working immediately.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <GhostButton onClick={() => setConfirmDefault(null)} disabled={applying}>
                Cancel
              </GhostButton>
              <PrimaryButton onClick={() => void applyDefault(confirmDefault)} disabled={applying}>
                {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {applying ? 'Relabeling…' : 'Switch domain'}
              </PrimaryButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
