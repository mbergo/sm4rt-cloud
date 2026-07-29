import { SignIn } from '@clerk/react';
import { BrandMark } from './bits';

export default function Login() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="animate-rise-in flex flex-col items-center text-center">
        <BrandMark size="lg" />
        <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">SM4RT-CLOUD</h1>
        <p className="mt-1.5 text-sm text-stone-400">
          On-demand AWS environments, running on your AKS cluster.
        </p>
      </div>
      <div className="animate-rise-in">
        <SignIn routing="hash" />
      </div>
    </main>
  );
}
