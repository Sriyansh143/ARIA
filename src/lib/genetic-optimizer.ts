// =====================================================================
// genetic-optimizer.ts — Self-evolving agent prompts (genetic optimization).
// =====================================================================
// Periodically (e.g. weekly) the optimization loop:
//   1. Queries recent AgentLog activity per agent role
//   2. Computes success rate from logs (success vs error level)
//   3. Identifies top/bottom performers
//   4. Uses LLM to mutate prompts of bottom performers
//   5. Stores evolution entries as MemoryItem rows (scope='agent-evolution')
//   6. Tracks performance delta over time
// Never throws — every error is logged + skipped.
// =====================================================================

import { db } from '@/lib/db'
import { chat } from '@/lib/llm'
import { logger } from '@/lib/logger'

// System prompts per role (the "DNA" of each agent)
const ROLE_PROMPTS: Record<string, string> = {
  coder: `You are the CODER agent. Write clean, working code for the task. Always include the full code in a fenced block with the correct language tag. Add brief comments. Handle edge cases.`,
  reviewer: `You are the REVIEWER agent. Review the work for quality, correctness, and completeness. Point out issues, suggest improvements, and rate the work 1-10. Be constructive.`,
  tester: `You are the TESTER agent. Write test cases and validate that the solution works. Provide test code + expected outcomes. Flag any issues.`,
  researcher: `You are the RESEARCHER agent. Gather information relevant to the task. Provide comprehensive findings, key facts, and relevant context that other agents can use. Be thorough but concise.`,
  writer: `You are the WRITER agent. Draft clear, professional documentation or summaries. Use markdown formatting. Be concise but complete.`,
  analyst: `You are the ANALYST agent. Analyze data and extract meaningful insights. Use appropriate statistical methods, visualize trends, and clearly explain your findings.`,
}

interface RoleStat {
  role: string
  totalTasks: number
  successRate: number
  avgDuration: number
}

async function getRoleStats(since: Date): Promise<RoleStat[]> {
  try {
    // Group AgentLog by agentId, then derive role from agent's name lookup
    const logs = await db.agentLog.findMany({
      where: { createdAt: { gte: since } },
      select: { agentId: true, level: true, message: true },
    })
    if (logs.length === 0) return []

    // Group by agentId
    const byAgent = new Map<string, { total: number; success: number }>()
    for (const l of logs) {
      const cur = byAgent.get(l.agentId) ?? { total: 0, success: 0 }
      cur.total++
      if (l.level === 'success' || l.level === 'info') cur.success++
      byAgent.set(l.agentId, cur)
    }

    // Look up agent names → use first letter of name as "role" (simple heuristic)
    const agents = await db.agent.findMany({ select: { id: true, name: true } })
    const idToName = new Map(agents.map(a => [a.id, a.name]))

    const stats: RoleStat[] = []
    for (const [agentId, c] of byAgent.entries()) {
      const name = idToName.get(agentId)
      if (!name) continue
      stats.push({
        role: name.toLowerCase(),
        totalTasks: c.total,
        successRate: c.total > 0 ? c.success / c.total : 0,
        avgDuration: 0,
      })
    }
    return stats
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'genetic: getRoleStats failed')
    return []
  }
}

async function getLastGeneration(): Promise<number> {
  try {
    const rows = await db.memoryItem.findMany({
      where: { scope: 'agent-evolution' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })
    if (rows.length === 0) return 0
    const v = JSON.parse(rows[0].value) as { generation?: number }
    return v.generation ?? 0
  } catch {
    return 0
  }
}

async function recordEvolution(entry: {
  agentRole: string
  oldPrompt: string
  newPrompt: string
  mutationReason: string
  oldSuccessRate: number
  generation: number
}): Promise<void> {
  try {
    const id = `evo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const value = JSON.stringify({
      id,
      ...entry,
      newSuccessRate: null,
      createdAt: new Date().toISOString(),
    })
    await db.memoryItem.create({
      data: {
        scope: 'agent-evolution',
        key: `${entry.agentRole}:${id}`,
        value,
        tags: JSON.stringify([entry.agentRole, `gen-${entry.generation}`]),
      },
    })
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'genetic: recordEvolution failed')
  }
}

// ─── Run genetic optimization ────────────────────────────────────────
export async function runGeneticOptimization(): Promise<{
  agentsOptimized: number
  generation: number
}> {
  logger.info({}, 'genetic: starting weekly prompt optimization')

  // 1. Get performance metrics for the last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const roleStats = await getRoleStats(sevenDaysAgo)

  if (roleStats.length < 3) {
    logger.info({ count: roleStats.length }, 'genetic: not enough data (< 3 roles), skipping')
    return { agentsOptimized: 0, generation: 0 }
  }

  // Sort by success rate (desc)
  roleStats.sort((a, b) => b.successRate - a.successRate)

  // 2. Identify top 10% and bottom 10%
  const tenPercent = Math.max(1, Math.floor(roleStats.length * 0.1))
  const topPerformers = roleStats.slice(0, tenPercent)
  const bottomPerformers = roleStats.slice(-tenPercent)

  if (bottomPerformers.length === 0) {
    logger.info({}, 'genetic: no bottom performers to optimize')
    return { agentsOptimized: 0, generation: 0 }
  }

  // 3. Get current generation number
  const generation = (await getLastGeneration()) + 1

  let agentsOptimized = 0

  // 4. For each bottom performer, generate optimized prompt
  for (const bottom of bottomPerformers) {
    const currentPrompt = ROLE_PROMPTS[bottom.role] || `You are a ${bottom.role} agent. Complete the task.`

    // Collect traits from top performers
    const topTraits = topPerformers.map(t => ({
      role: t.role,
      prompt: ROLE_PROMPTS[t.role] || '',
      successRate: t.successRate,
    }))

    // Use LLM to mutate the prompt
    const mutationPrompt = `You are the CEO of an AI company performing weekly prompt optimization.

BOTTOM PERFORMER:
Role: ${bottom.role}
Current success rate: ${(bottom.successRate * 100).toFixed(1)}%
Current prompt: "${currentPrompt}"

TOP PERFORMERS (to extract best traits from):
${topTraits.map(t => `Role: ${t.role} (${(t.successRate * 100).toFixed(1)}% success)
Prompt: "${t.prompt}"`).join('\n\n')}

TASK:
Analyze what makes the top performers' prompts effective (clarity, specificity, structure, edge-case handling).
Rewrite the bottom performer's prompt to incorporate those best traits while keeping the role's core purpose.

The new prompt must be:
- More specific about expected output format
- Include edge-case handling instructions
- Clearer about quality standards
- Under 500 characters

Respond as JSON:
{"newPrompt": "the optimized prompt", "mutationReason": "what traits were combined"}`

    try {
      const result = await chat(mutationPrompt)
      const match = result.content.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0]) as { newPrompt: string; mutationReason?: string }

        // Update the in-memory prompt
        ROLE_PROMPTS[bottom.role] = parsed.newPrompt

        // Log the evolution
        await recordEvolution({
          agentRole: bottom.role,
          oldPrompt: currentPrompt,
          newPrompt: parsed.newPrompt,
          mutationReason: parsed.mutationReason || 'Combined top performer traits',
          oldSuccessRate: bottom.successRate,
          generation,
        })

        agentsOptimized++
        logger.info({ role: bottom.role, oldRate: bottom.successRate, generation }, 'genetic: prompt optimized')
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message, role: bottom.role }, 'genetic: optimization failed')
    }
  }

  logger.info({ agentsOptimized, generation }, 'genetic: weekly optimization complete')
  return { agentsOptimized, generation }
}

// ─── Check evolution deltas (older than 7 days, newSuccessRate not yet set) ─
export async function checkEvolutionDeltas(): Promise<void> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  try {
    const rows = await db.memoryItem.findMany({
      where: { scope: 'agent-evolution' },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })

    for (const row of rows) {
      const v = JSON.parse(row.value) as {
        id: string
        agentRole: string
        oldSuccessRate: number
        newSuccessRate: number | null
        createdAt: string
      }
      if (v.newSuccessRate !== null) continue
      const createdAt = new Date(v.createdAt)
      if (createdAt > sevenDaysAgo) continue

      // Measure new success rate since the evolution
      const stats = await getRoleStats(createdAt)
      const stat = stats.find(s => s.role === v.agentRole)
      const newRate = stat?.successRate ?? 0

      const updated = { ...v, newSuccessRate: newRate }
      await db.memoryItem.update({
        where: { id: row.id },
        data: { value: JSON.stringify(updated) },
      })

      const delta = newRate - v.oldSuccessRate
      logger.info({ role: v.agentRole, delta, old: v.oldSuccessRate, new: newRate }, 'genetic: evolution delta measured')
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'genetic: checkEvolutionDeltas failed')
  }
}

// ─── Start the genetic optimization schedule ─────────────────────────
let geneticStarted = false
export function startGeneticSchedule(): void {
  if (geneticStarted) return
  geneticStarted = true

  // Sunday at 11 PM
  const now = new Date()
  const daysUntilSunday = (7 - now.getDay()) % 7
  const nextSunday11PM = new Date(now)
  nextSunday11PM.setDate(now.getDate() + daysUntilSunday)
  nextSunday11PM.setHours(23, 0, 0, 0)
  if (nextSunday11PM <= now) nextSunday11PM.setDate(nextSunday11PM.getDate() + 7)
  const msUntilSunday = nextSunday11PM.getTime() - now.getTime()

  const sundayTimer = setTimeout(() => {
    runGeneticOptimization().catch(() => {})
    setInterval(() => {
      runGeneticOptimization().catch(() => {})
    }, 7 * 24 * 60 * 60 * 1000)
  }, msUntilSunday)
  try { sundayTimer.unref() } catch { /* ignore */ }

  // Check evolution deltas daily
  const dailyTimer = setInterval(() => {
    checkEvolutionDeltas().catch(() => {})
  }, 24 * 60 * 60 * 1000)
  try { dailyTimer.unref() } catch { /* ignore */ }

  logger.info({}, 'genetic: schedule started (weekly Sunday 11 PM + daily delta check)')
}
