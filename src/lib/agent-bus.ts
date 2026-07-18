// =====================================================================
// agent-bus.ts — Bidirectional multi-agent communication bus.
// =====================================================================
// Three primitives on top of an in-process EventEmitter + Map:
//
//   1. Direct messaging  — sendToAgent(fromId, toId, payload)
//                          onAgentMessage(agentId, handler)
//   2. Broadcast         — broadcast(fromId, topic, payload)
//                          onBroadcast(topic, handler)
//   3. Shared blackboard — blackboard.post/read/readAll/watch/delete
//
// All three are in-process pub/sub + a namespaced KV store. Single-node,
// zero config. The API matches the original Redis-backed version so
// callers (agent-collab.ts etc.) work without modification.
// =====================================================================

import { EventEmitter } from 'events'

// ── Message envelope ─────────────────────────────────────────────────
export interface AgentMessage {
  id: string
  from: string
  to: string | '*' // '*' = broadcast
  topic?: string
  payload: unknown
  ts: number
}

const DIRECT_CHANNEL = (agentId: string) => `jarvis:agent:${agentId}:inbox`
const BROADCAST_CHANNEL = (topic: string) => `jarvis:agent:broadcast:${topic}`

const emitter = new EventEmitter()
emitter.setMaxListeners(200)

function newId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ── 1. Direct agent-to-agent messaging ───────────────────────────────

/** Send a message to a specific agent by ID. Fire-and-forget. */
export async function sendToAgent(from: string, to: string, payload: unknown, topic?: string): Promise<string> {
  const msg: AgentMessage = { id: newId(), from, to, topic, payload, ts: Date.now() }
  // Synchronous emit; handlers run in the same process.
  emitter.emit(DIRECT_CHANNEL(to), msg)
  if (process.env.NODE_ENV !== 'production') {
    console.debug('[agent-bus] direct message sent', { from, to, topic })
  }
  return msg.id
}

/** Subscribe an agent's inbox. Returns an unsubscribe fn. */
export async function onAgentMessage(
  agentId: string,
  handler: (msg: AgentMessage) => void | Promise<void>,
): Promise<() => Promise<void>> {
  const channel = DIRECT_CHANNEL(agentId)
  const wrapped = (msg: AgentMessage) => {
    try {
      const ret = handler(msg)
      if (ret && typeof (ret as Promise<void>).catch === 'function') {
        ;(ret as Promise<void>).catch((err) => {
          console.warn('[agent-bus] inbox handler rejected', {
            err: err instanceof Error ? err.message : String(err),
            agentId,
          })
        })
      }
    } catch (err) {
      console.warn('[agent-bus] inbox handler threw', {
        err: err instanceof Error ? err.message : String(err),
        agentId,
      })
    }
  }
  emitter.on(channel, wrapped)
  return async () => {
    try {
      emitter.off(channel, wrapped)
    } catch {
      /* best-effort */
    }
  }
}

// ── 2. Topic broadcast (one-to-many) ─────────────────────────────────

export async function broadcast(from: string, topic: string, payload: unknown): Promise<string> {
  const msg: AgentMessage = { id: newId(), from, to: '*', topic, payload, ts: Date.now() }
  emitter.emit(BROADCAST_CHANNEL(topic), msg)
  return msg.id
}

export async function onBroadcast(
  topic: string,
  handler: (msg: AgentMessage) => void | Promise<void>,
): Promise<() => Promise<void>> {
  const channel = BROADCAST_CHANNEL(topic)
  const wrapped = (msg: AgentMessage) => {
    try {
      const ret = handler(msg)
      if (ret && typeof (ret as Promise<void>).catch === 'function') {
        ;(ret as Promise<void>).catch(() => {
          /* best-effort */
        })
      }
    } catch {
      /* best-effort */
    }
  }
  emitter.on(channel, wrapped)
  return async () => {
    try {
      emitter.off(channel, wrapped)
    } catch {
      /* best-effort */
    }
  }
}

// ── 3. Shared blackboard (shared-context pattern) ────────────────────
// A namespaced key-value space that every agent in a run can post to and
// read from. Writes are persisted in-process for the lifetime of the
// Node process AND announced on a pub/sub channel so agents can react
// to updates in real time.

const BB_CHANNEL = (ns: string) => `jarvis:blackboard:${ns}:__events`

export interface BlackboardEntry {
  key: string
  value: unknown
  author: string
  ts: number
}

// namespace -> key -> entry
const bbStore = new Map<string, Map<string, BlackboardEntry>>()

function getOrCreateNs(ns: string): Map<string, BlackboardEntry> {
  let m = bbStore.get(ns)
  if (!m) {
    m = new Map()
    bbStore.set(ns, m)
  }
  return m
}

export const blackboard = {
  /** Post (or overwrite) an entry on the shared blackboard. */
  async post(namespace: string, key: string, value: unknown, author: string): Promise<void> {
    const entry: BlackboardEntry = { key, value, author, ts: Date.now() }
    getOrCreateNs(namespace).set(key, entry)
    emitter.emit(BB_CHANNEL(namespace), entry)
  },

  /** Read a single entry. */
  async read(namespace: string, key: string): Promise<BlackboardEntry | null> {
    return getOrCreateNs(namespace).get(key) ?? null
  },

  /** Read every entry in the namespace. */
  async readAll(namespace: string): Promise<BlackboardEntry[]> {
    const m = bbStore.get(namespace)
    if (!m) return []
    return Array.from(m.values()).sort((a, b) => a.ts - b.ts)
  },

  /** Delete a single entry from the blackboard. */
  async delete(namespace: string, key: string): Promise<void> {
    const m = bbStore.get(namespace)
    if (!m) return
    m.delete(key)
    if (m.size === 0) bbStore.delete(namespace)
  },

  /** Watch for new/updated entries in the namespace. Returns unsubscribe. */
  async watch(
    namespace: string,
    handler: (entry: BlackboardEntry) => void,
  ): Promise<() => Promise<void>> {
    const channel = BB_CHANNEL(namespace)
    const wrapped = (entry: BlackboardEntry) => {
      try {
        handler(entry)
      } catch {
        /* best-effort */
      }
    }
    emitter.on(channel, wrapped)
    return async () => {
      try {
        emitter.off(channel, wrapped)
      } catch {
        /* best-effort */
      }
    }
  },
}
