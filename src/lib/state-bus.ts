// =====================================================================
// state-bus.ts — In-memory key-value store with TTL + EventEmitter pub/sub
// =====================================================================
// Phase 17 / Dimension 3 (Sakana Fugu isolation) — adapted for v10 app.
//
// Pure TypeScript. No external packages (no Redis, no better-sqlite3).
// Uses an in-process Map<key, {value, expiresAt?}> for ultra-fast reads
// + an EventEmitter for synchronous pub/sub within the same Node process.
//
// Designed as the foundation for the v2 orchestrator's Fugu isolation:
// sub-agents communicate via State Bus summaries rather than via prompt
// lineage. A periodic flush to MemoryItem (scope='state-bus') provides
// best-effort durability across process restarts without sacrificing
// hot-path latency.
//
// API:
//   get(key)                       → string | null
//   set(key, value, ttlMs?)        → void
//   delete(key)                    → void
//   getJson<T>(key)                → T | null
//   setJson(key, value, ttlMs?)    → void
//   list(prefix)                   → {key, value}[]
//   subscribe(pattern, cb)         → unsubscribe fn
//   cleanupExpired()               → number of purged entries
// =====================================================================

import { EventEmitter } from 'events';
import { db } from './db';

const emitter = new EventEmitter();
emitter.setMaxListeners(1000);

export interface StateBusEntry {
  key: string;
  value: string;
}

interface InternalEntry {
  value: string;
  expiresAt: number | null; // epoch ms; null = no TTL
  ttlTimer: NodeJS.Timeout | null;
}

export interface StateBus {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlMs?: number): Promise<void>;
  list(prefix: string): Promise<StateBusEntry[]>;
  subscribe(pattern: string, cb: (key: string, value: string) => void): () => void;
  cleanupExpired(): Promise<number>;
}

// Convert a glob-style pattern ("run:*:result") to a regex.
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
}

class InMemoryStateBus implements StateBus {
  private store = new Map<string, InternalEntry>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      // Expired — purge + return null.
      this.store.delete(key);
      if (entry.ttlTimer) {
        clearTimeout(entry.ttlTimer);
      }
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    // Clear any prior TTL timer for this key.
    const prev = this.store.get(key);
    if (prev?.ttlTimer) {
      clearTimeout(prev.ttlTimer);
    }

    const expiresAt = ttlMs && ttlMs > 0 ? Date.now() + ttlMs : null;
    const entry: InternalEntry = { value, expiresAt, ttlTimer: null };

    if (expiresAt !== null) {
      // Schedule auto-cleanup when the TTL elapses.
      entry.ttlTimer = setTimeout(() => {
        this.store.delete(key);
      }, ttlMs);
      // Don't keep the Node event loop alive just for a state-bus TTL.
      entry.ttlTimer.unref?.();
    }

    this.store.set(key, entry);

    // Emit synchronously — subscribers in the same process get notified
    // immediately, mirroring the zip's EventEmitter semantics.
    emitter.emit('change', { key, value });
    emitter.emit(`change:${key}`, value);
  }

  async delete(key: string): Promise<void> {
    const prev = this.store.get(key);
    if (prev?.ttlTimer) {
      clearTimeout(prev.ttlTimer);
    }
    this.store.delete(key);
    emitter.emit('delete', { key });
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlMs?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlMs);
  }

  async list(prefix: string): Promise<StateBusEntry[]> {
    const now = Date.now();
    const out: StateBusEntry[] = [];
    for (const [key, entry] of this.store) {
      if (!key.startsWith(prefix)) continue;
      if (entry.expiresAt !== null && entry.expiresAt < now) {
        // Stale — purge lazily.
        this.store.delete(key);
        if (entry.ttlTimer) clearTimeout(entry.ttlTimer);
        continue;
      }
      out.push({ key, value: entry.value });
    }
    return out;
  }

  subscribe(pattern: string, cb: (key: string, value: string) => void): () => void {
    const regex = globToRegex(pattern);
    const handler = (evt: { key: string; value: string }) => {
      if (regex.test(evt.key)) cb(evt.key, evt.value);
    };
    emitter.on('change', handler);
    return () => emitter.off('change', handler);
  }

  async cleanupExpired(): Promise<number> {
    const now = Date.now();
    let purged = 0;
    for (const [key, entry] of this.store) {
      if (entry.expiresAt !== null && entry.expiresAt < now) {
        if (entry.ttlTimer) clearTimeout(entry.ttlTimer);
        this.store.delete(key);
        purged++;
      }
    }
    return purged;
  }
}

// Singleton — every importer shares one bus + one emitter.
export const stateBus: StateBus = new InMemoryStateBus();

// Periodic cleanup every 5 minutes (long-lived processes only).
// The timer is unref'd so it never keeps the event loop alive on its own.
if (typeof setInterval !== 'undefined' && process.env.STATEBUS_CLEANUP !== 'false') {
  const cleanupTimer = setInterval(() => {
    stateBus.cleanupExpired().catch(() => {});
  }, 5 * 60 * 1000);
  cleanupTimer.unref?.();
}

// ─── Optional: best-effort persistence to MemoryItem ──────────────────
//
// Background: in-memory state is lost on process restart. For long-running
// orchestrations that span server restarts (rare but possible), we expose
// a `flushToDb()` helper that snapshots the current state into MemoryItem
// rows with scope='state-bus'. The orchestrator may call this after each
// wave to provide crash-resume capability. Reads from MemoryItem happen
// lazily on cache-miss via `loadFromDb()`.
//
// Both helpers are fire-and-forget — callers should not await them on the
// hot path. The flush is throttled to at most once per 5 seconds.

let lastFlush = 0;
const FLUSH_MIN_INTERVAL_MS = 5000;

export async function flushStateBusToDb(prefix?: string): Promise<number> {
  const now = Date.now();
  if (now - lastFlush < FLUSH_MIN_INTERVAL_MS) return 0;
  lastFlush = now;
  try {
    const entries = await stateBus.list(prefix ?? '');
    for (const e of entries) {
      // Upsert by (key, scope='state-bus'). Best-effort — failures are
      // non-fatal because the in-memory copy is still authoritative.
      await db.memoryItem.upsert({
        where: { key_scope: { key: e.key, scope: 'state-bus' } },
        create: { key: e.key, scope: 'state-bus', value: e.value, tags: '["state-bus"]' },
        update: { value: e.value },
      }).catch(() => {});
    }
    return entries.length;
  } catch {
    return 0;
  }
}

export async function loadStateBusFromDb(prefix: string): Promise<number> {
  try {
    const rows = await db.memoryItem.findMany({
      where: { scope: 'state-bus', key: { startsWith: prefix } },
      take: 1000,
    });
    for (const r of rows) {
      // Only seed if the in-memory store doesn't already have a fresher copy.
      const existing = await stateBus.get(r.key);
      if (existing === null) {
        await stateBus.set(r.key, r.value);
      }
    }
    return rows.length;
  } catch {
    return 0;
  }
}
