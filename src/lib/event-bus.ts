/**
 * In-process event bus — used by event triggers and cross-route signalling.
 *
 * Pattern #10 from docs/OPEN-SOURCE-RESEARCH.md — AutoGPT-style event triggers.
 *
 * This is a deliberately thin EventEmitter wrapper. Because Next.js dev/server
 * is request-scoped, listeners attached here live for the lifetime of the
 * Node.js process, not the request. That's fine for short-lived subscribers
 * (e.g. the scheduler tick) but it means event triggers can't be relied on
 * to fire on their own — they need an external nudge.
 *
 * The /api/triggers/events/[eventName]/fire route exists for exactly that:
 * callers can POST to it to fan out an event to any registered event triggers
 * (which themselves are stored as MemoryItem rows with scope='trigger').
 */

import { EventEmitter } from 'events'

const emitter = new EventEmitter()
emitter.setMaxListeners(50)

/**
 * Emit an event across the bus. Also emits a '*' wildcard event so listeners
 * that want to observe all traffic can subscribe once.
 */
export function emitEvent(eventName: string, payload?: unknown): void {
  try {
    emitter.emit(eventName, payload)
    // Also emit a wildcard event for listeners that want all events.
    emitter.emit('*', { name: eventName, payload })
  } catch (err) {
    // Never let an event-bus failure crash the caller — just log it.
    console.warn('[event-bus] emit failed:', err instanceof Error ? err.message : String(err))
  }
}

/**
 * Subscribe to an event. Returns an unsubscribe function.
 */
export function onEvent(eventName: string, handler: (payload?: unknown) => void): () => void {
  emitter.on(eventName, handler)
  return () => {
    try {
      emitter.off(eventName, handler)
    } catch {
      /* best-effort */
    }
  }
}

/**
 * List all currently-subscribed event names (excluding internal wildcards).
 */
export function listEventNames(): string[] {
  return emitter
    .eventNames()
    .map((n) => (typeof n === 'string' ? n : String(n)))
    .filter((n) => n !== '*')
}
