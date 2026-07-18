// agent-memory.ts — Persistent agent memory across sessions.
//
// Agents can remember past executions, context, and learned facts
// across restarts. Memory is stored in the MemoryItem table with
// scope='agent-session' and retrieved on agent start.
//
// The MemoryItem schema has no dedicated agentId/orgId columns, so the
// cache key encodes both: `agent-memory:${orgId}:${agentId}`. We also
// keep an in-process Map as a hot-path cache; the DB is the source of
// truth (write-through).
//
// Usage:
//   import { AgentMemory } from '@/lib/agent-memory'
//   const mem = new AgentMemory(agentId)
//   await mem.load()                          // hydrate from DB
//   mem.remember('user prefers Python')       // add a fact
//   await mem.save()                          // persist to DB
//   const ctx = mem.buildContextString()      // inject into system prompt

import { db } from '@/lib/db'

const SCOPE = 'agent-session'
const MAX_FACTS = 50          // cap per agent to avoid context bloat
const MAX_FACT_LEN = 500      // chars per fact
const MAX_CONTEXT_CHARS = 4000 // total injected context budget

export interface AgentFact {
  text: string
  addedAt: string   // ISO timestamp
  confidence: number // 0-1
  source: 'user' | 'agent' | 'observation' | 'correction'
}

export interface AgentSessionSummary {
  sessionId: string
  task: string
  outcome: 'success' | 'failure' | 'partial' | 'hitl-paused'
  keyLearnings: string[]
  completedAt: string
  durationMs: number
}

export class AgentMemory {
  private agentId: string
  private orgId: string
  private facts: AgentFact[] = []
  private sessions: AgentSessionSummary[] = []
  private loaded = false

  // orgId is part of the memory namespace so two orgs that happen to
  // use the same agentId can never read/overwrite each other's memory.
  constructor(agentId: string, orgId = 'default') {
    this.agentId = agentId
    this.orgId = orgId
  }

  /** Namespaced DB key: org-scoped so tenants are isolated. */
  private memKey(): string {
    return `agent-memory:${this.orgId}:${this.agentId}`
  }

  // ── Load from DB ──────────────────────────────────────────────────────────

  async load(): Promise<void> {
    try {
      const key = this.memKey()
      const item = await db.memoryItem.findFirst({
        where: { key, scope: SCOPE },
      })
      if (item?.value) {
        const parsed = JSON.parse(item.value) as {
          facts?: AgentFact[]
          sessions?: AgentSessionSummary[]
        }
        this.facts = Array.isArray(parsed.facts) ? parsed.facts.slice(-MAX_FACTS) : []
        this.sessions = Array.isArray(parsed.sessions) ? parsed.sessions.slice(-20) : []
      }
      this.loaded = true
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[agent-memory] loaded', {
          agentId: this.agentId,
          orgId: this.orgId,
          facts: this.facts.length,
          sessions: this.sessions.length,
          source: 'db',
        })
      }
    } catch (err) {
      console.warn(
        '[agent-memory] load failed — starting fresh:',
        err instanceof Error ? err.message : String(err),
        { agentId: this.agentId },
      )
      this.facts = []
      this.sessions = []
      this.loaded = true
    }
  }

  // ── Save to DB ────────────────────────────────────────────────────────────

  async save(): Promise<void> {
    if (!this.loaded) return
    try {
      const key = this.memKey()
      const facts = this.facts.slice(-MAX_FACTS)
      const sessions = this.sessions.slice(-20)
      const value = JSON.stringify({
        facts,
        sessions,
        updatedAt: new Date().toISOString(),
      })
      await db.memoryItem.upsert({
        where: { key_scope: { key, scope: SCOPE } },
        create: {
          key,
          scope: SCOPE,
          value,
          tags: JSON.stringify(['agent-memory', this.orgId, this.agentId]),
        },
        update: { value, updatedAt: new Date() },
      })
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[agent-memory] saved', {
          agentId: this.agentId,
          orgId: this.orgId,
        })
      }
    } catch (err) {
      console.warn(
        '[agent-memory] save failed:',
        err instanceof Error ? err.message : String(err),
        { agentId: this.agentId },
      )
    }
  }

  // ── Fact management ───────────────────────────────────────────────────────

  remember(text: string, opts: { confidence?: number; source?: AgentFact['source'] } = {}): void {
    const trimmed = text.trim().slice(0, MAX_FACT_LEN)
    if (!trimmed) return
    // Deduplicate: skip if very similar fact already exists
    const isDuplicate = this.facts.some(
      (f) => f.text.toLowerCase().slice(0, 80) === trimmed.toLowerCase().slice(0, 80),
    )
    if (isDuplicate) return
    this.facts.push({
      text: trimmed,
      addedAt: new Date().toISOString(),
      confidence: opts.confidence ?? 0.8,
      source: opts.source ?? 'agent',
    })
    if (this.facts.length > MAX_FACTS) {
      this.facts = this.facts.slice(-MAX_FACTS)
    }
  }

  forget(textFragment: string): void {
    this.facts = this.facts.filter((f) => !f.text.includes(textFragment))
  }

  correctFact(oldText: string, newText: string): void {
    const idx = this.facts.findIndex((f) => f.text.includes(oldText))
    if (idx >= 0) {
      this.facts[idx] = {
        text: newText.trim().slice(0, MAX_FACT_LEN),
        addedAt: new Date().toISOString(),
        confidence: 0.9,
        source: 'correction',
      }
    } else {
      this.remember(newText, { source: 'correction', confidence: 0.9 })
    }
  }

  // ── Session summaries ─────────────────────────────────────────────────────

  recordSession(summary: AgentSessionSummary): void {
    this.sessions.push(summary)
    if (this.sessions.length > 20) this.sessions = this.sessions.slice(-20)
    // Auto-extract learnings as facts
    for (const learning of summary.keyLearnings.slice(0, 3)) {
      this.remember(learning, { source: 'observation', confidence: 0.75 })
    }
  }

  // ── Context injection ─────────────────────────────────────────────────────

  buildContextString(): string {
    if (!this.loaded || (this.facts.length === 0 && this.sessions.length === 0)) return ''

    const lines: string[] = ['[AGENT MEMORY — from previous sessions]']

    const sorted = [...this.facts].sort((a, b) => b.confidence - a.confidence)
    let chars = 0
    for (const fact of sorted) {
      const line = `• ${fact.text}`
      if (chars + line.length > MAX_CONTEXT_CHARS - 200) break
      lines.push(line)
      chars += line.length
    }

    if (this.sessions.length > 0) {
      lines.push('\n[RECENT SESSIONS]')
      for (const s of this.sessions.slice(-3)) {
        const line = `• [${s.outcome.toUpperCase()}] ${s.task.slice(0, 100)} (${Math.round(s.durationMs / 1000)}s)`
        if (chars + line.length > MAX_CONTEXT_CHARS) break
        lines.push(line)
        chars += line.length
      }
    }

    return lines.join('\n')
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  getFacts(): AgentFact[] { return [...this.facts] }
  getSessions(): AgentSessionSummary[] { return [...this.sessions] }
  isLoaded(): boolean { return this.loaded }
}

// ── Singleton cache (one AgentMemory per agentId per process) ─────────────

const cache = new Map<string, AgentMemory>()

function cacheKey(agentId: string, orgId: string): string {
  return `${orgId}:${agentId}`
}

export async function getAgentMemory(agentId: string, orgId = 'default'): Promise<AgentMemory> {
  const ck = cacheKey(agentId, orgId)
  if (!cache.has(ck)) {
    const mem = new AgentMemory(agentId, orgId)
    await mem.load()
    cache.set(ck, mem)
  }
  return cache.get(ck)!
}

export function evictAgentMemory(agentId: string, orgId = 'default'): void {
  cache.delete(cacheKey(agentId, orgId))
}
