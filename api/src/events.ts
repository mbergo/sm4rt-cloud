// Per-instance provisioning event bus.
//
// Drivers emit real progress lines while creating/destroying instances; the
// server exposes them over SSE so the console can render a live terminal.
// A small ring buffer per instance lets late subscribers replay history.

export type EventKind = 'info' | 'ok' | 'err' | 'done';

export interface ProvisionEvent {
  ts: string;
  kind: EventKind;
  line: string;
}

type Listener = (event: ProvisionEvent) => void;

const HISTORY_LIMIT = 300;
const RETENTION_MS = 30 * 60_000;

interface Channel {
  history: ProvisionEvent[];
  listeners: Set<Listener>;
  lastTouch: number;
}

const channels = new Map<string, Channel>();

function channelFor(instance: string): Channel {
  let ch = channels.get(instance);
  if (!ch) {
    ch = { history: [], listeners: new Set(), lastTouch: Date.now() };
    channels.set(instance, ch);
  }
  ch.lastTouch = Date.now();
  return ch;
}

export function emit(instance: string, kind: EventKind, line: string): void {
  const ch = channelFor(instance);
  const event: ProvisionEvent = { ts: new Date().toISOString(), kind, line };
  ch.history.push(event);
  if (ch.history.length > HISTORY_LIMIT) {
    ch.history.splice(0, ch.history.length - HISTORY_LIMIT);
  }
  for (const listener of ch.listeners) {
    try {
      listener(event);
    } catch {
      // subscriber failures must not break provisioning
    }
  }
}

export function subscribe(instance: string, listener: Listener): () => void {
  const ch = channelFor(instance);
  for (const event of ch.history) {
    listener(event);
  }
  ch.listeners.add(listener);
  return () => {
    ch.listeners.delete(listener);
  };
}

export function clearHistory(instance: string): void {
  channels.delete(instance);
}

// prune idle channels so long-running processes don't accumulate
setInterval(() => {
  const cutoff = Date.now() - RETENTION_MS;
  for (const [name, ch] of channels) {
    if (ch.listeners.size === 0 && ch.lastTouch < cutoff) {
      channels.delete(name);
    }
  }
}, 5 * 60_000).unref();
