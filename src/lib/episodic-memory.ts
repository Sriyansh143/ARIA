// episodic-memory.ts -- Episodic memory store (Phase 2.2 / item 5).
// Records what an agent did + outcome, persisted to MemoryItem with
// scope='episodic'. All DB calls wrapped in try/catch (graceful degrade).
// API: recordEpisode(agentId, task, outcome, opts?), recallEpisodes(query, limit?).

import { db } from '@/lib/db'

const SCOPE = 'episodic'
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 100

export interface Episode {
  id: string
  agentId: string
  task: string
  outcome: string
  tags: string[]
  importance: number
  sessionId?: string | null
  orgId?: string | null
  createdAt: Date
}

export interface RecordEpisodeOpts {
  tags?: string[]
  importance?: number // 0..1
  sessionId?: string
  orgId?: string
}

function newId(): string {
  return `ep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Record an episode — what an agent did and how it turned out.
 * Returns the stored episode id (or null if the DB write was skipped).
 *
 * The MemoryItem schema doesn't have dedicated agentId/orgId columns,
 * so we encode them into the JSON value AND into the tags array. The
 * key is `${agentId}:${id}` so recallEpisodes can filter by agent.
 */
export async function recordEpisode(
  agentId: string,
  task: string,
  outcome: string,
  opts: RecordEpisodeOpts = {},
): Promise<string | null> {
  if (!agentId || !task) return null
  const id = newId()
  const tags = opts.tags ?? []
  const importance =
    typeof opts.importance === 'number'
      ? Math.min(1, Math.max(0, opts.importance))
      : 0.5

  const value = JSON.stringify({
    id,
    agentId,
    task: task.slice(0, 2000),
    outcome: outcome.slice(0, 1000),
    tags,
    importance,
    sessionId: opts.sessionId ?? null,
    orgId: opts.orgId ?? null,
    createdAt: new Date().toISOString(),
  })

  // Encode agentId + orgId into the tags array so we can filter later.
  const tagList = [`agent:${agentId}`, ...(opts.orgId ? [`org:${opts.orgId}`] : []), ...tags]

  try {
    await db.memoryItem.create({
      data: {
        scope: SCOPE,
        key: `${agentId}:${id}`,
        value,
        tags: JSON.stringify(tagList),
      },
    })
    return id
  } catch (err) {
    console.warn(
      '[episodic-memory] recordEpisode failed:',
      err instanceof Error ? err.message : String(err),
      { agentId },
    )
    return null
  }
}

function parseEpisode(row: {
  key: string
  value: string
  createdAt: Date
}): Episode | null {
  try {
    const v = JSON.parse(row.value) as Partial<Episode>
    if (!v || typeof v.task !== 'string') return null
    return {
      id: v.id ?? row.key,
      agentId: v.agentId ?? 'unknown',
      task: v.task,
      outcome: v.outcome ?? '',
      tags: Array.isArray(v.tags) ? v.tags : [],
      importance: typeof v.importance === 'number' ? v.importance : 0.5,
      sessionId: v.sessionId ?? null,
      orgId: v.orgId ?? null,
      createdAt: v.createdAt ? new Date(v.createdAt) : row.createdAt,
    }
  } catch {
    return null
  }
}

/**
 * Recall episodes whose task or outcome matches the query (simple
 * substring + tag match — no embeddings, keeps this self-contained).
 *
 * Optionally filter by `agentId` and/or `orgId` (encoded in tags).
 */
export async function recallEpisodes(
  query: string,
  limit: number = DEFAULT_LIMIT,
  opts?: { agentId?: string; orgId?: string },
): Promise<Episode[]> {
  const cap = Math.min(MAX_LIMIT, Math.max(1, limit))
  const q = (query || '').trim().toLowerCase()

  try {
    const rows = await db.memoryItem.findMany({
      where: { scope: SCOPE },
      orderBy: { updatedAt: 'desc' },
      take: 500, // load candidates, then filter in-process
    })

    const episodes = rows
      .map(parseEpisode)
      .filter((e): e is Episode => e !== null)

    const filteredByAgent = episodes.filter((e) => {
      if (opts?.agentId && e.agentId !== opts.agentId) return false
      if (opts?.orgId && e.orgId !== opts.orgId) return false
      return true
    })

    const filteredByQuery = q.length === 0
      ? filteredByAgent
      : filteredByAgent.filter((e) => {
          const hay = `${e.task} ${e.outcome} ${e.tags.join(' ')}`.toLowerCase()
          return hay.includes(q) || e.tags.some((t) => t.toLowerCase() === q)
        })

    // Sort by importance desc, then recency.
    filteredByQuery.sort((a, b) => {
      if (b.importance !== a.importance) return b.importance - a.importance
      return b.createdAt.getTime() - a.createdAt.getTime()
    })

    return filteredByQuery.slice(0, cap)
  } catch (err) {
    console.warn(
      '[episodic-memory] recallEpisodes failed:',
      err instanceof Error ? err.message : String(err),
    )
    return []
  }
}

/**
 * List recent episodes for a specific agent. Convenience wrapper around
 * `recallEpisodes` with the agentId filter pre-applied.
 */
export async function listAgentEpisodes(
  agentId: string,
  limit: number = DEFAULT_LIMIT,
): Promise<Episode[]> {
  return recallEpisodes('', limit, { agentId })
}
