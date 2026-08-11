import { Check, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { UserButton } from '@clerk/react';
import type { Instance } from '../lib/api';
import { BrandMark, PrimaryButton } from './bits';
import { useConfig } from '../lib/config';

const STATUS_DOT: Record<Instance['status'], string> = {
  running: 'bg-emerald-400',
  provisioning: 'bg-amber-400 animate-pulse',
  error: 'bg-rose-400',
  deleting: 'bg-stone-500 animate-pulse',
};

function WorkspaceSwitcher({
  instances,
  selected,
  onSelect,
  onDelete,
  onCreate,
}: {
  instances: Instance[];
  selected: string | null;
  onSelect: (name: string) => void;
  onDelete: (name: string) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = instances.find((instance) => instance.name === selected) ?? null;

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-64 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-stone-200 transition hover:bg-white/10"
      >
        {current ? (
          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[current.status]}`} />
        ) : null}
        <span className="truncate font-medium">{selected ?? 'Select workspace'}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-stone-500 transition ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <div className="animate-rise-in absolute left-0 top-full z-40 mt-2 w-72 overflow-hidden rounded-xl border border-white/10 bg-stone-900 shadow-2xl">
          <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-widest text-stone-600">
            Workspaces
          </p>
          <div className="max-h-72 overflow-auto pb-1">
            {instances.length === 0 ? (
              <p className="px-3 py-2 text-xs text-stone-500">No workspaces yet</p>
            ) : (
              instances.map((instance) => {
                const active = instance.name === selected;
                return (
                  <div
                    key={instance.name}
                    className={`group flex items-center gap-2 px-2 py-0.5 ${active ? 'bg-amber-500/10' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(instance.name);
                        setOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-sm text-stone-200 transition hover:text-white"
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[instance.status]}`}
                      />
                      <span className="truncate">{instance.name}</span>
                      {active ? <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-amber-300" /> : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete workspace "${instance.name}"? This removes all its resources.`)) {
                          onDelete(instance.name);
                          setOpen(false);
                        }
                      }}
                      className="rounded-md p-1 text-stone-600 opacity-0 transition hover:bg-rose-500/10 hover:text-rose-300 group-hover:opacity-100"
                      aria-label={`Delete ${instance.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              onCreate();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 border-t border-white/10 px-3 py-2.5 text-sm text-amber-300 transition hover:bg-amber-500/10"
          >
            <Plus className="h-4 w-4" /> New workspace
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function Header({
  instances,
  selected,
  onSelect,
  onDelete,
  onCreate,
  showUserButton,
}: {
  instances: Instance[];
  selected: string | null;
  onSelect: (name: string) => void;
  onDelete: (name: string) => void;
  onCreate: () => void;
  showUserButton: boolean;
}) {
  const config = useConfig();
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-stone-950/70 backdrop-blur-xl">
      <div className="flex w-full items-center gap-4 px-6 py-4">
        <BrandMark />
        <div className="min-w-0">
          <h1 className="font-display text-lg font-bold leading-tight tracking-tight">
            SM4RT-CLOUD
          </h1>
          <p className="text-xs text-stone-500">
            {config.driver} · {config.instanceDomain}
          </p>
        </div>
        <div className="ml-2 h-8 w-px bg-white/10" />
        <WorkspaceSwitcher
          instances={instances}
          selected={selected}
          onSelect={onSelect}
          onDelete={onDelete}
          onCreate={onCreate}
        />
        <div className="ml-auto flex items-center gap-2.5">
          <span className="hidden rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-stone-400 sm:inline">
            {instances.length} {instances.length === 1 ? 'workspace' : 'workspaces'}
          </span>
          <PrimaryButton onClick={onCreate}>
            <Plus className="h-4 w-4" /> New workspace
          </PrimaryButton>
          {showUserButton ? (
            <UserButton
              appearance={{
                elements: { userButtonAvatarBox: 'h-8 w-8 ring-1 ring-white/15' },
              }}
            />
          ) : null}
        </div>
      </div>
    </header>
  );
}
