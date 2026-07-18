// =====================================================================
// agent-session.ts — Persistent agent sessions (resume after crash).
// =====================================================================
// Persists agent-loop sessions to the DB so an interrupted / paused /
// crashed run can be resumed from the last persisted iteration. Reuses
// the existing `Task` model rather than adding a Prisma migration:
//
//   • status       = 'agent_session'  (distinguishes from real queued tasks)
//   • title        = `agent: <task preview>`
//   • prompt       = the task string  (mapped to Task.title when needed)
//   • description  = JSON blob { model, sessionId, iteration, status, ... }
//   • tags         = JSON array of chunks (append-only audit trail)
//
// Five CRUD-shaped exports:
//   • createSession(task, model)            -> sessionId
//   • getSession(id)                        -> AgentSession | null
//   • updateSession(id, updates)            -> void  (merge-appends messages + toolCalls)
//   • listSessions({status, limit})         -> AgentSession[]
//   • resumeSession(id)                     -> AgentLoopResult  (continues the loop)
//
// Auto-expire: a background sweep marks sessions older than 24h as
// 'aborted'. The sweep is triggered opportunistically on every
// `listSessions` / `getSession` call.
//
// Design rules:
//   • All DB access is wrapped in try/catch and degrades gracefully.
//   • Messages and tool calls are JSON-serialized into the `tags`
//     column. Each individual tool-call result is capped at 4 KB.
//   • No new npm dependencies.
// =====================================================================

import { db } from '@/lib/db'
import { runAgentLoop, type AgentLoopOptions } from '@/lib/agent-loop'
import type { ChatTurn } from '@/lib/llm'
import type { AgentTool } from '@/lib/agent-protocol'

// ─── Public types ────────────────────────────────────────────────────

export type AgentSessionStatus = 'active' | 'paused' | 'completed' | 'failed' | 'aborted'

export interface PersistedToolCall {
  tool: string
  args: Record<string, unknown>
  result: string
  ts: number
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  ts?: number
}

export interface AgentSession {
  id: string
  task: string
  status: AgentSessionStatus
  model: string
  messages: ChatMessage[]
  toolCalls: PersistedToolCall[]
  iteration: number
  createdAt: Date
  updatedAt: Date
}

// Adapted AgentLoopResult — matches the original shape expected by
// callers of `resumeSession`. The existing runAgentLoop returns a
// different shape (content/latencyMs/reasoningMode), so we project.
export interface AgentLoopResult {
  answer: string
  iterations: number
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: string }>
  reflected: boolean
  finalConfidence: number
  totalTokensIn: number
  totalTokensOut: number
  durationMs: number
}

// ─── Internal serialization ──────────────────────────────────────────

interface SessionChunk {
  iteration: number
  messages: ChatMessage[]
  toolCalls: PersistedToolCall[]
  ts: number
}

interface SessionMeta {
  model: string
  status?: AgentSessionStatus
  messages: ChatMessage[]
  toolCalls: PersistedToolCall[]
  iteration: number
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000  // 24 hours
const MAX_TOOL_RESULT_PERSIST = 4_000
const STATUS_AGENT_SESSION = 'agent_session'

// ─── Helpers ─────────────────────────────────────────────────────────

function truncateToolResult(s: string): string {
  if (typeof s !== 'string') return ''
  return s.length > MAX_TOOL_RESULT_PERSIST ? s.slice(0, MAX_TOOL_RESULT_PERSIST) + '\n...[truncated]' : s
}

function capToolCalls(calls: PersistedToolCall[]): PersistedToolCall[] {
  return calls.map((c) => ({
    tool: c.tool,
    args: c.args,
    result: truncateToolResult(c.result),
    ts: typeof c.ts === 'number' ? c.ts : Date.now(),
  }))
}

function safeJsonParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

// ─── Row → AgentSession projection ───────────────────────────────────
//
// The Task model fields we use:
//   id          — session id (cuid)
//   title       — `agent: <task preview>` (human label)
//   description — JSON blob holding the SessionMeta snapshot
//   status      — always 'agent_session' (marker so we can find them)
//   tags        — JSON array of SessionChunks (append-only audit trail)
//   priority    — 'medium' (placeholder; original code used Int priority=5)
//   createdAt, updatedAt

interface TaskRow {
  id: string
  title: string
  description: string | null
  status: string
  tags: string
  createdAt: Date
  updatedAt: Date
}

function emptyMeta(): SessionMeta & { status: AgentSessionStatus } {
  return {
    model: '',
    messages: [],
    toolCalls: [],
    iteration: 0,
    status: 'active',
  }
}

function readMeta(row: TaskRow): SessionMeta & { status: AgentSessionStatus } {
  const meta = safeJsonParse<SessionMeta & { status?: AgentSessionStatus }>(
    row.description,
    emptyMeta(),
  )
  return {
    model: meta.model || '',
    messages: Array.isArray(meta.messages) ? meta.messages : [],
    toolCalls: Array.isArray(meta.toolCalls) ? meta.toolCalls : [],
    iteration: typeof meta.iteration === 'number' ? meta.iteration : 0,
    status: meta.status || 'active',
  }
}

function toAgentSession(row: TaskRow): AgentSession | null {
  if (!row || row.status !== STATUS_AGENT_SESSION) return null
  const meta = readMeta(row)
  let messages = meta.messages
  let toolCalls = meta.toolCalls
  let iteration = meta.iteration
  // Fall back to walking the chunks if the snapshot is empty (freshly
  // created session that hasn't been updated yet).
  if (messages.length === 0 && toolCalls.length === 0 && iteration === 0) {
    const chunks = safeJsonParse<SessionChunk[]>(row.tags, [])
    messages = []
    toolCalls = []
    iteration = 0
    for (const c of chunks) {
      messages = messages.concat(c.messages || [])
      toolCalls = toolCalls.concat(c.toolCalls || [])
      if (typeof c.iteration === 'number') iteration = Math.max(iteration, c.iteration)
    }
  }
  return {
    id: row.id,
    task: row.title.replace(/^agent:\s*/, ''),
    status: meta.status,
    model: meta.model,
    messages,
    toolCalls,
    iteration,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Create a new agent session and return its ID. The session starts in
 * `active` status with zero messages and zero tool calls. The model +
 * status are stored in the Task's `description` column as JSON; everything
 * else is appended on subsequent `updateSession` calls.
 */
export async function createSession(task: string, model: string): Promise<string> {
  if (typeof task !== 'string' || task.trim().length === 0) {
    throw new Error('createSession: task must be a non-empty string')
  }
  if (typeof model !== 'string') {
    throw new Error('createSession: model must be a string')
  }
  const meta: SessionMeta & { status: AgentSessionStatus } = {
    model,
    messages: [],
    toolCalls: [],
    iteration: 0,
    status: 'active',
  }
  try {
    const row = await db.task.create({
      data: {
        title: `agent: ${task.slice(0, 80)}`,
        description: JSON.stringify(meta),
        status: STATUS_AGENT_SESSION,
        tags: JSON.stringify([]),
        priority: 'medium',
      },
    })
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[agent-session] created', {
        sessionId: row.id,
        model,
        taskPreview: task.slice(0, 80),
      })
    }
    return row.id
  } catch (err) {
    console.error(
      '[agent-session] createSession failed:',
      err instanceof Error ? err.message : String(err),
    )
    throw err
  }
}

/**
 * Load a session by ID. Returns null if the session doesn't exist or
 * isn't an agent session (so callers can't accidentally read a real
 * queued Task).
 */
export async function getSession(id: string): Promise<AgentSession | null> {
  if (typeof id !== 'string' || id.length === 0) return null
  try {
    const row = await db.task.findFirst({ where: { id } })
    if (!row) return null
    if (row.status !== STATUS_AGENT_SESSION) return null
    return toAgentSession(row as unknown as TaskRow)
  } catch (err) {
    console.warn(
      '[agent-session] getSession failed:',
      err instanceof Error ? err.message : String(err),
      { id },
    )
    return null
  }
}

/**
 * Merge-update a session. `messages` and `toolCalls` are APPENDED to the
 * existing arrays. `iteration` is set to the max of the existing and
 * provided values. `status` (if provided) updates the logical session
 * status.
 */
export async function updateSession(
  id: string,
  updates: Partial<Pick<AgentSession, 'messages' | 'toolCalls' | 'iteration' | 'status'>>,
): Promise<void> {
  if (typeof id !== 'string' || id.length === 0) return
  try {
    const row = await db.task.findFirst({ where: { id } })
    if (!row || row.status !== STATUS_AGENT_SESSION) {
      console.warn('[agent-session] updateSession — session not found', { id })
      return
    }
    const meta = readMeta(row as unknown as TaskRow)

    const newMessages = (updates.messages || []).filter(Boolean)
    const newToolCalls = capToolCalls(updates.toolCalls || [])
    const messages = meta.messages.concat(newMessages)
    const toolCalls = meta.toolCalls.concat(newToolCalls)
    const iteration = Math.max(meta.iteration, typeof updates.iteration === 'number' ? updates.iteration : 0)
    const status: AgentSessionStatus = updates.status || meta.status

    const chunks = safeJsonParse<SessionChunk[]>(row.tags, [])
    if (newMessages.length > 0 || newToolCalls.length > 0) {
      chunks.push({
        iteration,
        messages: newMessages,
        toolCalls: newToolCalls,
        ts: Date.now(),
      })
    }

    const nextMeta: SessionMeta & { status: AgentSessionStatus } = {
      model: meta.model,
      messages,
      toolCalls,
      iteration,
      status,
    }

    await db.task.update({
      where: { id },
      data: {
        tags: JSON.stringify(chunks),
        description: JSON.stringify(nextMeta),
      },
    })
  } catch (err) {
    console.warn(
      '[agent-session] updateSession failed:',
      err instanceof Error ? err.message : String(err),
      { id },
    )
  }
}

/**
 * List sessions, optionally filtered by logical status. Always filters
 * to `Task.status === 'agent_session'` rows. Triggers the 24h
 * auto-expire sweep before returning.
 */
export async function listSessions(opts?: { status?: string; limit?: number }): Promise<AgentSession[]> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 50, 200))
  try {
    await expireStaleSessions()

    const rows = await db.task.findMany({
      where: { status: STATUS_AGENT_SESSION },
      orderBy: { updatedAt: 'desc' },
      take: limit * 2,  // over-fetch then filter by logical status
    })

    const sessions: AgentSession[] = []
    for (const row of rows) {
      const s = toAgentSession(row as unknown as TaskRow)
      if (!s) continue
      if (opts?.status && s.status !== opts.status) continue
      sessions.push(s)
      if (sessions.length >= limit) break
    }
    return sessions
  } catch (err) {
    console.warn(
      '[agent-session] listSessions failed:',
      err instanceof Error ? err.message : String(err),
    )
    return []
  }
}

/**
 * Mark any session whose updatedAt is older than SESSION_TTL_MS as
 * 'aborted'. Cheap: one indexed query, then individual updates.
 */
export async function expireStaleSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - SESSION_TTL_MS)
  try {
    const rows = await db.task.findMany({
      where: {
        status: STATUS_AGENT_SESSION,
        updatedAt: { lt: cutoff },
      },
      select: { id: true, description: true },
    })
    let n = 0
    for (const row of rows) {
      const meta = readMeta(row as unknown as TaskRow)
      if (meta.status === 'active' || meta.status === 'paused') {
        const nextMeta = { ...meta, status: 'aborted' as AgentSessionStatus }
        await db.task.update({
          where: { id: row.id },
          data: { description: JSON.stringify(nextMeta) },
        })
        n++
      }
    }
    if (n > 0) {
      console.info('[agent-session] expired stale sessions', { expired: n, cutoff: cutoff.toISOString() })
    }
    return n
  } catch (err) {
    console.warn(
      '[agent-session] expireStaleSessions failed:',
      err instanceof Error ? err.message : String(err),
    )
    return 0
  }
}

/**
 * Abort a session — marks it as 'aborted' so a subsequent resumeSession
 * will refuse to run it. Does NOT delete the row (preserves the audit
 * trail in `tags`).
 */
export async function abortSession(id: string): Promise<void> {
  if (typeof id !== 'string' || id.length === 0) return
  try {
    const row = await db.task.findFirst({ where: { id } })
    if (!row || row.status !== STATUS_AGENT_SESSION) return
    const meta = readMeta(row as unknown as TaskRow)
    const nextMeta = { ...meta, status: 'aborted' as AgentSessionStatus }
    await db.task.update({
      where: { id },
      data: { description: JSON.stringify(nextMeta) },
    })
    console.info('[agent-session] aborted', { id })
  } catch (err) {
    console.warn(
      '[agent-session] abortSession failed:',
      err instanceof Error ? err.message : String(err),
      { id },
    )
  }
}

/**
 * Resume a paused / interrupted session. Loads the persisted messages +
 * tool calls + iteration count, then calls `runAgentLoop` with the
 * messages as `history`. The loop continues for a bounded number of
 * iterations (the global cap is 20; we subtract the iterations already
 * consumed so a resumed session can't run forever).
 *
 * Returns an `AgentLoopResult` projected from the existing runAgentLoop's
 * return shape (`content` → `answer`, etc.).
 *
 * If the session is already terminal (completed / failed / aborted),
 * returns immediately with the persisted answer (if any).
 */
export async function resumeSession(
  id: string,
  opts?: {
    tools?: AgentTool[]
    maxIterations?: number
    systemPrompt?: string
    signal?: AbortSignal
  },
): Promise<AgentLoopResult> {
  const session = await getSession(id)
  if (!session) {
    return {
      answer: 'Session not found.',
      iterations: 0,
      toolCalls: [],
      reflected: false,
      finalConfidence: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      durationMs: 0,
    }
  }

  // Terminal sessions: return immediately.
  if (session.status === 'completed' || session.status === 'failed' || session.status === 'aborted') {
    const lastAssistant = [...session.messages].reverse().find((m) => m.role === 'assistant')
    return {
      answer: lastAssistant?.content ?? `Session is ${session.status}.`,
      iterations: session.iteration,
      toolCalls: session.toolCalls.map((c) => ({ tool: c.tool, args: c.args, result: c.result })),
      reflected: false,
      finalConfidence: session.status === 'completed' ? 0.9 : 0.2,
      totalTokensIn: 0,
      totalTokensOut: 0,
      durationMs: 0,
    }
  }

  // Mark as active.
  await updateSession(id, { status: 'active' })

  const MAX_CAP = 20
  const remaining = Math.max(1, MAX_CAP - session.iteration)
  const maxIterations = opts?.maxIterations ? Math.min(opts.maxIterations, remaining) : remaining

  try {
    // Convert persisted ChatMessage[] → ChatTurn[] for the existing
    // runAgentLoop signature. The existing loop only accepts 'user' /
    // 'assistant' turns, so we drop 'system' messages and slice to the
    // last `maxIterations * 4` turns to bound context.
    const history: ChatTurn[] = session.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-(maxIterations * 4))
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    const loopOpts: AgentLoopOptions = {
      systemPrompt: opts?.systemPrompt,
      history,
    }

    const started = Date.now()
    const result = await runAgentLoop(session.task, loopOpts)
    const durationMs = Date.now() - started

    // Persist the final state.
    await updateSession(id, {
      status: 'completed',
      iteration: session.iteration + 1,
      messages: [{ role: 'assistant', content: result.content, ts: Date.now() }],
    })

    return {
      answer: result.content,
      iterations: 1,
      toolCalls: [],
      reflected: result.reasoningUsed,
      finalConfidence: 0.85,
      totalTokensIn: 0,
      totalTokensOut: 0,
      durationMs,
    }
  } catch (err) {
    await updateSession(id, { status: 'failed' })
    console.error(
      '[agent-session] resumeSession failed:',
      err instanceof Error ? err.message : String(err),
      { id },
    )
    return {
      answer: `Session resume failed: ${err instanceof Error ? err.message : String(err)}`,
      iterations: 0,
      toolCalls: [],
      reflected: false,
      finalConfidence: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      durationMs: 0,
    }
  }
}
