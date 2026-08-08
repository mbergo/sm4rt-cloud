import { createContext, useContext } from 'react';

export interface CloudConfig {
  driver: 'kubernetes' | 'swarm';
  instanceDomain: string;
  scheme: string;
  authMode: 'clerk' | 'token' | 'open';
  clerkPublishableKey: string | null;
  maxInstances: number;
  maxTtlHours: number;
}

const buildTimeClerkKey = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined) ?? '';

/** used when the API predates /api/public/config (SaaS back-compat) */
export const fallbackConfig: CloudConfig = {
  driver: 'kubernetes',
  instanceDomain: 'floci.sm4rt.works',
  scheme: 'https',
  authMode: buildTimeClerkKey ? 'clerk' : 'token',
  clerkPublishableKey: buildTimeClerkKey || null,
  maxInstances: 20,
  maxTtlHours: 168,
};

export async function fetchConfig(): Promise<CloudConfig> {
  try {
    const res = await fetch('/api/public/config', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return fallbackConfig;
    }
    const data = (await res.json()) as Partial<CloudConfig>;
    return {
      ...fallbackConfig,
      ...data,
      clerkPublishableKey: data.clerkPublishableKey ?? buildTimeClerkKey ?? null,
    };
  } catch {
    return fallbackConfig;
  }
}

export const ConfigContext = createContext<CloudConfig>(fallbackConfig);

export function useConfig(): CloudConfig {
  return useContext(ConfigContext);
}
