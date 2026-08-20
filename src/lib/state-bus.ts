/**
 * src/lib/state-bus.ts — in-process KV + pub/sub on globalThis.
 *
 * Server-only. A tiny dependency-free state bus that survives hot-reload
 * (hoisted onto globalThis) and supports:
 *
 *   - TTL'd KV entries (pruned lazily on read)
 *   - channel-based pub/sub (publish/subscribe return unsub fns)
 *
 * Designed for ephemeral runtime state: lock tokens, debounce windows,
 * inter-request handoff, agent-to-agent state sharing that's too
 * short-lived to deserve a DB write.
 */

interface StateEntry {
  value: unknown;
  expiresAt?: number; // epoch ms; undefined = never expires
}

interface Bus {
  store: Map<string, StateEntry>;
  channels: Map<string, Set<(event: unknown) => void>>;
}

const globalForState = globalThis as unknown as {
  __ariaStateBus?: Bus;
};

function createBus(): Bus {
  return {
    store: new Map(),
    channels: new Map(),
  };
}

const bus: Bus = globalForState.__ariaStateBus ?? createBus();
if (!globalForState.__ariaStateBus) globalForState.__ariaStateBus = bus;

// ─── KV API ─────────────────────────────────────────────────────────

function pruneKey(key: string): void {
  const entry = bus.store.get(key);
  if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
    bus.store.delete(key);
  }
}

export function getState<T = unknown>(key: string): T | undefined {
  pruneKey(key);
  return bus.store.get(key)?.value as T | undefined;
}

export function setState(key: string, value: unknown, ttlMs?: number): void {
  const entry: StateEntry = { value };
  if (ttlMs !== undefined && ttlMs > 0) {
    entry.expiresAt = Date.now() + ttlMs;
  }
  bus.store.set(key, entry);
}

export function deleteState(key: string): void {
  bus.store.delete(key);
}

export function listState(): { key: string; value: unknown; expiresAt?: number }[] {
  // Prune everything before listing.
  for (const key of Array.from(bus.store.keys())) pruneKey(key);
  const out: { key: string; value: unknown; expiresAt?: number }[] = [];
  for (const [key, entry] of bus.store.entries()) {
    out.push({
      key,
      value: entry.value,
      expiresAt: entry.expiresAt,
    });
  }
  return out;
}

// ─── Pub/Sub API ────────────────────────────────────────────────────

export function subscribe(channel: string, cb: (event: unknown) => void): () => void {
  let set = bus.channels.get(channel);
  if (!set) {
    set = new Set();
    bus.channels.set(channel, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
    if (set && set.size === 0) bus.channels.delete(channel);
  };
}

export function publish(channel: string, event: unknown): void {
  const set = bus.channels.get(channel);
  if (!set) return;
  for (const cb of set) {
    try {
      cb(event);
    } catch {
      // A faulty subscriber must never poison the bus.
    }
  }
}

// ─── Status helper (for the API) ────────────────────────────────────

export function getStateBusStatus(): {
  keys: number;
  channels: number;
  subscribers: number;
} {
  return {
    keys: bus.store.size,
    channels: bus.channels.size,
    subscribers: Array.from(bus.channels.values()).reduce((s, set) => s + set.size, 0),
  };
}
