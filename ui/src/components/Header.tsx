import { Plus } from 'lucide-react';
import { UserButton } from '@clerk/react';
import { BrandMark, PrimaryButton } from './bits';

export default function Header({
  instanceCount,
  onCreate,
}: {
  instanceCount: number;
  onCreate: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-stone-950/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-4">
        <BrandMark />
        <div className="min-w-0">
          <h1 className="font-display text-lg font-bold leading-tight tracking-tight">
            SM4RT-CLOUD
          </h1>
          <p className="text-xs text-stone-500">AKS · sm4rt-aks · centralus</p>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          <span className="hidden rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-stone-400 sm:inline">
            {instanceCount} {instanceCount === 1 ? 'instance' : 'instances'}
          </span>
          <PrimaryButton onClick={onCreate}>
            <Plus className="h-4 w-4" /> New instance
          </PrimaryButton>
          <UserButton
            appearance={{
              elements: { userButtonAvatarBox: 'h-8 w-8 ring-1 ring-white/15' },
            }}
          />
        </div>
      </div>
    </header>
  );
}
