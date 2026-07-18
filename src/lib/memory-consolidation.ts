// memory-consolidation.ts -- Working -> Episodic consolidation.
// Summarizes working-memory entries for a task with the LLM and persists
// a single episodic-memory episode. Always clears the scratchpad afterward
// so entries don't leak. Never throws.

import { quickChat } from '@/lib/llm'
import { logger } from '@/lib/logger'
import { getAllWorking, clearWorking } from '@/lib/working-memory'
import { recordEpisode } from '@/lib/episodic-memory'

const CONSOLIDATE_SYSTEM_PROMPT = `Consolidate a task's working-memory entries (JSON object: keys -> values) into one episodic memory.

Respond with EXACTLY ONE JSON object — no prose, no markdown fences. Shape:
{
  "task": "One-sentence description of what the task was (max 300 chars).",
  "outcome": "One-sentence description of the result/outcome (max 300 chars).",
  "tags": ["tag1", "tag2"],
  "importance": 0.5
}

Rules:
- task and outcome MUST be non-empty strings.
- tags: 0-5 lowercase kebab-case strings.
- importance: float in [0, 1] (0 = trivial, 1 = critical learning).
- If entries are empty/meaningless, set importance to 0.`

interface ConsolidationSummary {
  task: string
  outcome: string
  tags: string[]
  importance: number
}

function extractSummary(raw: string): ConsolidationSummary | null {
  const t = (raw || '').trim()
  const candidates: string[] = [t]
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) candidates.push(fence[1].trim())
  const start = t.indexOf('{'), end = t.lastIndexOf('}')
  if (start !== -1 && end > start) candidates.push(t.slice(start, end + 1))
  for (const c of candidates) {
    try {
      const v = JSON.parse(c) as Partial<ConsolidationSummary>
      if (typeof v.task === 'string' && typeof v.outcome === 'string') {
        return {
          task: v.task.slice(0, 300),
          outcome: v.outcome.slice(0, 300),
          tags: Array.isArray(v.tags) ? v.tags.slice(0, 5).map(String) : [],
          importance: typeof v.importance === 'number'
            ? Math.min(1, Math.max(0, v.importance)) : 0.5,
        }
      }
    } catch { /* try next */ }
  }
  return null
}

function fallbackSummary(entries: Record<string, unknown>): ConsolidationSummary {
  const keys = Object.keys(entries)
  const preview = keys.slice(0, 5)
    .map((k) => `${k}=${JSON.stringify(entries[k]).slice(0, 80)}`)
    .join('; ')
  return {
    task: `Task with ${keys.length} working-memory entries (LLM consolidation failed).`,
    outcome: `Entries: ${preview.slice(0, 280)}`,
    tags: ['consolidation-fallback'],
    importance: 0.2,
  }
}

/** Consolidate all working-memory entries for a task into one episodic episode. */
export async function consolidateMemory(taskId: string): Promise<void> {
  if (!taskId) return
  const entries = getAllWorking(taskId)
  const keys = Object.keys(entries)
  if (keys.length === 0) {
    logger.debug({ taskId }, 'memory-consolidation: nothing to consolidate')
    return
  }

  let summary: ConsolidationSummary | null = null
  try {
    const raw = await quickChat(
      JSON.stringify(entries).slice(0, 6000),
      CONSOLIDATE_SYSTEM_PROMPT,
    )
    summary = extractSummary(raw)
    if (!summary) {
      logger.warn({ taskId, rawPreview: raw.slice(0, 120) },
        'memory-consolidation: could not parse LLM summary, using fallback')
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), taskId },
      'memory-consolidation: LLM call failed, using fallback')
  }

  const final = summary ?? fallbackSummary(entries)
  try {
    const id = await recordEpisode(taskId, final.task, final.outcome, {
      tags: final.tags, importance: final.importance,
    })
    logger.info({ taskId, episodeId: id, entryCount: keys.length, importance: final.importance },
      'memory-consolidation: episode recorded')
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), taskId },
      'memory-consolidation: recordEpisode failed')
  } finally {
    clearWorking(taskId) // Always clear so we don't leak entries.
  }
}
