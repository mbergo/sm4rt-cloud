// Normalizes engine-reported status strings ("running:healthy",
// "exited:unhealthy", "restarting", ...) into a stable state bucket,
// a clean display label, and an optional health detail.

export type NormalizedState = 'running' | 'starting' | 'stopped' | 'error' | 'unknown';

export interface NormalizedStatus {
  state: NormalizedState;
  label: string;
  detail?: string;
}

const STATE_LABELS: Record<Exclude<NormalizedState, 'unknown'>, string> = {
  running: 'Running',
  starting: 'Starting',
  stopped: 'Stopped',
  error: 'Error',
};

export function normalizeStatus(raw: string | null | undefined): NormalizedStatus {
  const value = (raw ?? '').trim();
  if (!value) {
    return { state: 'unknown', label: 'Unknown' };
  }

  const [head, ...rest] = value.split(':');
  const key = head.trim().toLowerCase();
  const detail = rest.join(':').trim().toLowerCase() || undefined;

  let state: NormalizedState;
  if (key === 'running') {
    state = 'running';
  } else if (key === 'starting' || key === 'restarting') {
    state = 'starting';
  } else if (key === 'exited' || key === 'stopped') {
    state = 'stopped';
  } else if (key === 'degraded' || key === 'error') {
    state = 'error';
  } else {
    state = 'unknown';
  }

  const label =
    state === 'unknown' ? key.charAt(0).toUpperCase() + key.slice(1) : STATE_LABELS[state];

  return detail ? { state, label, detail } : { state, label };
}
