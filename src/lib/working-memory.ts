// =====================================================================
// working-memory.ts -- Short-term context store with TTL (Phase 2.2 / item 7).
// =====================================================================
// Map-based KV store scoped by taskId. Each entry has an optional TTL
// (in ms); expired entries are lazily evicted on read. Distinct from
// src/lib/memory/working.ts (which is Redis-backed, agentId-scoped).
// API: setWorking, getWorking, hasWorking, keysWorking, getAllWorking,
//      clearWorking, workingMemoryStats.
// =====================================================================

import { logger } from './logger'

interface Entry {
  value: unknown
  expiresAt?: number // epoch ms; undefined = never expires
  createdAt: number
}

// Outer map: taskId -> (key -> Entry).
const store = new Map<string, Map<string, Entry>>()

const MAX_TASKS = 500
const MAX_ENTRIES_PER_TASK = 200

function getOrCreateTaskMap(taskId: string): Map<string, Entry> {
  let m = store.get(taskId)
  if (!m) {
    if (store.size >= MAX_TASKS) {
      // Evict the oldest task (insertion order — first key).
      const oldest = store.keys().next().value
      if (oldest) {
        store.delete(oldest)
        logger.debug({ taskId: oldest }, 'working-memory: evicted oldest task')
      }
    }
    m = new Map()
    store.set(taskId, m)
  }
  return m
}

function isExpired(e: Entry): boolean {
  return typeof e.expiresAt === 'number' && Date.now() > e.expiresAt
}

/** Set a working-memory value. Optionally expires after `ttlMs` ms. */
export function setWorking(taskId: string, key: string, value: unknown, ttlMs?: number): void {
  if (!taskId || !key) return
  const m = getOrCreateTaskMap(taskId)
  if (m.size >= MAX_ENTRIES_PER_TASK && !m.has(key)) {
    const oldest = m.keys().next().value
    if (oldest) m.delete(oldest)
  }
  m.set(key, {
    value,
    createdAt: Date.now(),
    expiresAt: typeof ttlMs === 'number' && ttlMs > 0 ? Date.now() + ttlMs : undefined,
  })
}

/** Get a value. Returns undefined if missing or expired (expired entries are evicted on read). */
export function getWorking<T = unknown>(taskId: string, key: string): T | undefined {
  if (!taskId || !key) return undefined
  const m = store.get(taskId)
  if (!m) return undefined
  const e = m.get(key)
  if (!e) return undefined
  if (isExpired(e)) {
    m.delete(key)
    if (m.size === 0) store.delete(taskId)
    return undefined
  }
  return e.value as T
}

/** Check whether a working-memory key exists (and hasn't expired). */
export function hasWorking(taskId: string, key: string): boolean {
  return getWorking(taskId, key) !== undefined
}

/** List all non-expired keys for a task. */
export function keysWorking(taskId: string): string[] {
  if (!taskId) return []
  const m = store.get(taskId)
  if (!m) return []
  const out: string[] = []
  const now = Date.now()
  for (const [k, e] of m) {
    if (typeof e.expiresAt === 'number' && now > e.expiresAt) m.delete(k)
    else out.push(k)
  }
  if (m.size === 0) store.delete(taskId)
  return out
}

/** Get all non-expired entries for a task as a plain object. */
export function getAllWorking(taskId: string): Record<string, unknown> {
  const keys = keysWorking(taskId)
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = getWorking(taskId, k)
  return out
}

/** Clear all working-memory entries for a task. */
export function clearWorking(taskId: string): void {
  if (!taskId) return
  store.delete(taskId)
}

/** Stats for observability / debugging. */
export function workingMemoryStats(): { tasks: number; entries: number } {
  let entries = 0
  for (const m of store.values()) entries += m.size
  return { tasks: store.size, entries }
}
