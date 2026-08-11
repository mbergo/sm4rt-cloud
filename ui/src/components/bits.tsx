import { Check, Copy } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Instance } from '../lib/api';

export function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-12 w-12 rounded-2xl' : 'h-9 w-9 rounded-xl';
  const glyph = size === 'lg' ? 'text-lg' : 'text-sm';
  return (
    <div
      className={`${box} flex items-center justify-center bg-gradient-to-br from-amber-400 to-orange-600 shadow-lg shadow-orange-500/25`}
    >
      <span className={`${glyph} font-display font-bold text-white`}>S4</span>
    </div>
  );
}

/**
 * BrandLoader — the S4 provisioning spinner. Two counter-rotating orbit
 * rings around the breathing logo, with an animated status line.
 * Sizes: 'sm' inline (rows/cards), 'lg' hero (full-page provisioning).
 */
export function BrandLoader({
  label = 'Provisioning',
  sublabel,
  size = 'lg',
}: {
  label?: string;
  sublabel?: string;
  size?: 'sm' | 'lg';
}) {
  if (size === 'sm') {
    return (
      <span className="inline-flex items-center gap-2.5">
        <span className="relative inline-flex h-6 w-6 items-center justify-center">
          <span className="s4-orbit-ring absolute inset-0 rounded-full" />
          <span className="s4-breathe flex h-3.5 w-3.5 items-center justify-center rounded-[5px] bg-gradient-to-br from-amber-400 to-orange-600">
            <span className="text-[6px] font-display font-bold text-white">S4</span>
          </span>
        </span>
        <span className="s4-dots text-xs text-stone-400">{label}</span>
      </span>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-14">
      <div className="relative flex h-24 w-24 items-center justify-center">
        <div className="s4-orbit-ring absolute inset-0 rounded-full" />
        <div className="s4-orbit-ring-slow absolute inset-2 rounded-full" />
        <div className="s4-breathe flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 shadow-lg shadow-orange-500/40">
          <span className="font-display text-lg font-bold text-white">S4</span>
        </div>
      </div>
      <div className="text-center">
        <p className="s4-dots font-display text-sm font-semibold uppercase tracking-widest text-stone-200">
          {label}
        </p>
        {sublabel ? <p className="mt-1.5 text-xs text-stone-500">{sublabel}</p> : null}
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<Instance['status'], { dot: string; text: string; label: string }> = {
  running: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Running' },
  provisioning: { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-300', label: 'Provisioning' },
  error: { dot: 'bg-rose-400', text: 'text-rose-300', label: 'Error' },
  deleting: { dot: 'bg-zinc-400 animate-pulse', text: 'text-zinc-300', label: 'Deleting' },
};

export function StatusBadge({ status, detail }: { status: Instance['status']; detail?: string | null }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs font-medium ${style.text}`}
      title={detail ?? undefined}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
      {detail ? <span className="text-zinc-400">· {detail}</span> : null}
    </span>
  );
}

export function CopyButton({ value, className = '' }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => setCopied(true));
      }}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100 ${className}`}
      aria-label="Copy to clipboard"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function Toast({ message, tone }: { message: string; tone: 'ok' | 'err' }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
      <div
        className={`animate-rise-in rounded-xl border px-4 py-2.5 text-sm font-medium shadow-2xl backdrop-blur ${
          tone === 'ok'
            ? 'border-emerald-400/30 bg-emerald-950/80 text-emerald-200'
            : 'border-rose-400/30 bg-rose-950/80 text-rose-200'
        }`}
      >
        {message}
      </div>
    </div>
  );
}

export function GhostButton({
  children,
  onClick,
  disabled,
  className = '',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-zinc-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100 ${className}`}
    >
      {children}
    </button>
  );
}
