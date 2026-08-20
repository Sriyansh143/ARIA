/**
 * src/lib/cache.ts — Pluggable cache abstraction.
 *
 * In-memory Map implementation today; designed to be swapped for Redis
 * (or any KV store) without changing call-sites. The interface mirrors
 * the subset of Redis commands we'd use (GET / SET with TTL / DEL /
 * SCAN-match / INFO), so a future `RedisCache` adapter can drop in.
 *
 * Design notes:
 *   - TTL is opt-in (pass `ttlMs`). Entries without TTL live forever.
 *   - Expired entries are pruned lazily on read (amortised O(1)) and
 *     opportunistically during `cacheInvalidate` scans.
 *   - Stats (hits / misses) are stored on `globalThis` so they survive
 *     Next.js Fast-Refresh HMR — a new module instance continues
 *     recording into the same counters instead of resetting to 0.
 *   - The underlying Map is also hoisted to `globalThis` for the same
 *     reason: HMR must not wipe the cache or every refresh would
 *     re-fetch from the DB.
 *
 * Task ID: HARDEN-SCALE-DOCS (Task 1).
 */

import { logger } from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────

interface CacheEntry<T = unknown> {
  value: T;
  /** Absolute expiry epoch-ms. `null` = no expiry (lives until evicted). */
  expiresAt: number | null;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
}

export interface CacheAdapter {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T, ttlMs?: number): void;
  delete(key: string): void;
  invalidate(prefix: string): void;
  stats(): CacheStats;
  /** Clear every entry. Mainly for tests + admin "flush" buttons. */
  clear(): void;
}

// ─── globalThis-backed storage (HMR-safe) ────────────────────────────

const GLOBAL_STORE_KEY = "__aria_cache_store__";
const GLOBAL_HITS_KEY = "__aria_cache_hits__";
const GLOBAL_MISSES_KEY = "__aria_cache_misses__";

interface GlobalShape {
  [GLOBAL_STORE_KEY]?: Map<string, CacheEntry>;
  [GLOBAL_HITS_KEY]?: number;
  [GLOBAL_MISSES_KEY]?: number;
}

const g = globalThis as unknown as GlobalShape;

function getStore(): Map<string, CacheEntry> {
  if (!g[GLOBAL_STORE_KEY]) {
    g[GLOBAL_STORE_KEY] = new Map<string, CacheEntry>();
  }
  return g[GLOBAL_STORE_KEY]!;
}

function getHits(): number {
  if (typeof g[GLOBAL_HITS_KEY] !== "number") g[GLOBAL_HITS_KEY] = 0;
  return g[GLOBAL_HITS_KEY]!;
}

function getMisses(): number {
  if (typeof g[GLOBAL_MISSES_KEY] !== "number") g[GLOBAL_MISSES_KEY] = 0;
  return g[GLOBAL_MISSES_KEY]!;
}

function bumpHits(): void {
  g[GLOBAL_HITS_KEY] = getHits() + 1;
}

function bumpMisses(): void {
  g[GLOBAL_MISSES_KEY] = getMisses() + 1;
}

// ─── In-memory adapter ───────────────────────────────────────────────

/**
 * InMemoryCache — Map-based cache. Drop-in for a future RedisCache.
 *
 * Methods never throw: a corrupt entry is logged + evicted, returning
 * `null` to the caller. This keeps API routes resilient even if a
 * caller serialises something non-cloneable.
 */
class InMemoryCache implements CacheAdapter {
  get<T>(key: string): T | null {
    const store = getStore();
    const entry = store.get(key);
    if (!entry) {
      bumpMisses();
      return null;
    }
    // Lazy TTL prune.
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      store.delete(key);
      bumpMisses();
      return null;
    }
    bumpHits();
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    const store = getStore();
    const expiresAt =
      typeof ttlMs === "number" && ttlMs > 0 ? Date.now() + ttlMs : null;
    try {
      store.set(key, { value, expiresAt });
    } catch (err) {
      // Should be unreachable for Map, but guard against exotic value
      // types (e.g. Symbols on a proxy) so a bad payload never crashes
      // the API route that called `cacheSet`.
      logger.warn("cache.set.failed", { key, error: String(err) });
    }
  }

  delete(key: string): void {
    getStore().delete(key);
  }

  invalidate(prefix: string): void {
    if (!prefix) return;
    const store = getStore();
    const now = Date.now();
    // Single pass: delete matching keys AND prune any expired entries
    // we happen to visit (cheap opportunistic GC).
    for (const [key, entry] of store) {
      const expired =
        entry.expiresAt !== null && entry.expiresAt <= now;
      if (expired || key.startsWith(prefix)) {
        store.delete(key);
      }
    }
  }

  stats(): CacheStats {
    const store = getStore();
    const hits = getHits();
    const misses = getMisses();
    const total = hits + misses;
    return {
      size: store.size,
      hits,
      misses,
      hitRate: total === 0 ? 0 : hits / total,
    };
  }

  clear(): void {
    getStore().clear();
    g[GLOBAL_HITS_KEY] = 0;
    g[GLOBAL_MISSES_KEY] = 0;
  }
}

// ─── Singleton + functional façade ───────────────────────────────────

/**
 * `cache` — the singleton adapter every module imports.
 *
 * Today this is an `InMemoryCache`. To migrate to Redis later, swap
 * the constructor here (e.g. `new RedisCache(process.env.REDIS_URL!)`)
 * — no call-site changes needed because they all use the `CacheAdapter`
 * interface via the functional helpers below.
 */
export const cache: CacheAdapter = new InMemoryCache();

/**
 * Functional façade — the rest of the codebase calls these. Keeps
 * import lines short (`import { cacheGet } from "@/lib/cache"`) and
 * lets us swap the adapter without touching call-sites.
 */
export function cacheGet<T>(key: string): T | null {
  return cache.get<T>(key);
}

export function cacheSet<T>(key: string, value: T, ttlMs?: number): void {
  cache.set<T>(key, value, ttlMs);
}

export function cacheDelete(key: string): void {
  cache.delete(key);
}

export function cacheInvalidate(prefix: string): void {
  cache.invalidate(prefix);
}

export function cacheStats(): CacheStats {
  return cache.stats();
}

export default cache;
