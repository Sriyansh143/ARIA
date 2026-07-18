// =====================================================================
// agent-analytics.ts -- Per-agent performance metrics + auto promote/demote.
// =====================================================================
// Tracks metrics for every agent:
//   - tasks_completed
//   - success_rate
//   - average_tokens_used
//   - average_execution_time
//
// Uses this data to automatically "promote" (give higher priority to)
// highly efficient agents and "demote" (restrict resources for)
// inefficient ones.
//
// Backed by MemoryItem rows with scope='agent-metric' (written by
// agent-lifecycle-manager.ts on every task completion).
// =====================================================================

import { db } from '@/lib/db'

const METRIC_SCOPE = 'agent-metric'

export interface AgentPerformance {
  role: string
  totalTasks: number
  successfulTasks: number
  failedTasks: number
  successRate: number  // 0.0-1.0
  avgTokensIn: number
  avgTokensOut: number
  avgDurationMs: number
  rank: 'top' | 'mid' | 'bottom'  // auto-promotion/demotion tier
  recommendation: string
}

interface MetricRecord {
  agentRole: string
  success: boolean
  tokensIn: number
  tokensOut: number
  durationMs: number
  errorType: string | null
  ts: string
}

// ─── Load all metric records from MemoryItem ─────────────────────────
async function loadMetrics(): Promise<MetricRecord[]> {
  try {
    const rows = await db.memoryItem.findMany({
      where: { scope: METRIC_SCOPE },
      orderBy: { updatedAt: 'desc' },
      take: 5000,  // cap to avoid unbounded scans
    })
    const out: MetricRecord[] = []
    for (const row of rows) {
      try {
        const v = JSON.parse(row.value) as Partial<MetricRecord>
        if (v && typeof v.agentRole === 'string') {
          out.push({
            agentRole: v.agentRole,
            success: !!v.success,
            tokensIn: typeof v.tokensIn === 'number' ? v.tokensIn : 0,
            tokensOut: typeof v.tokensOut === 'number' ? v.tokensOut : 0,
            durationMs: typeof v.durationMs === 'number' ? v.durationMs : 0,
            errorType: v.errorType ?? null,
            ts: v.ts ?? row.updatedAt.toISOString(),
          })
        }
      } catch {
        // skip unparseable rows
      }
    }
    return out
  } catch (err) {
    console.warn(
      '[agent-analytics] loadMetrics failed:',
      err instanceof Error ? err.message : String(err),
    )
    return []
  }
}

// ─── Get performance metrics for all agents ──────────────────────────
export async function getAgentPerformance(): Promise<AgentPerformance[]> {
  const metrics = await loadMetrics()
  if (metrics.length === 0) return []

  // Group by role.
  const byRole = new Map<string, MetricRecord[]>()
  for (const m of metrics) {
    if (!byRole.has(m.agentRole)) byRole.set(m.agentRole, [])
    byRole.get(m.agentRole)!.push(m)
  }

  const performances: AgentPerformance[] = []
  for (const [role, records] of byRole) {
    const totalTasks = records.length
    const successfulTasks = records.filter((r) => r.success).length
    const failedTasks = totalTasks - successfulTasks
    const successRate = totalTasks > 0 ? successfulTasks / totalTasks : 0
    const avgTokensIn = Math.round(records.reduce((s, r) => s + r.tokensIn, 0) / totalTasks)
    const avgTokensOut = Math.round(records.reduce((s, r) => s + r.tokensOut, 0) / totalTasks)
    const avgDurationMs = Math.round(records.reduce((s, r) => s + r.durationMs, 0) / totalTasks)
    performances.push({
      role,
      totalTasks,
      successfulTasks,
      failedTasks,
      successRate,
      avgTokensIn,
      avgTokensOut,
      avgDurationMs,
      rank: 'mid',
      recommendation: '',
    })
  }

  // Sort by success rate (desc) then by avg duration (asc)
  performances.sort((a, b) => {
    if (b.successRate !== a.successRate) return b.successRate - a.successRate
    return a.avgDurationMs - b.avgDurationMs
  })

  // Assign ranks: top 33% = 'top', bottom 33% = 'bottom', rest = 'mid'
  const third = Math.max(1, Math.floor(performances.length / 3))
  for (let i = 0; i < performances.length; i++) {
    if (i < third) {
      performances[i].rank = 'top'
      performances[i].recommendation = 'PROMOTE — high success rate + fast execution. Give priority in task routing.'
    } else if (i >= performances.length - third) {
      performances[i].rank = 'bottom'
      performances[i].recommendation = 'DEMOTE — low success rate or slow execution. Restrict token budget + add more retries.'
    } else {
      performances[i].rank = 'mid'
      performances[i].recommendation = 'STABLE — performing within expected parameters.'
    }
  }

  return performances
}

// ─── Get top-performing agent for a role ─────────────────────────────
export async function getBestAgentForRole(role: string): Promise<string | null> {
  const performances = await getAgentPerformance()
  const match = performances.find((p) => p.role === role && p.rank === 'top')
  return match?.role ?? null
}

// ─── Get overall stats for dashboard ─────────────────────────────────
export async function getAnalyticsSummary(): Promise<{
  totalTasks: number
  overallSuccessRate: number
  totalTokensUsed: number
  avgExecutionTime: number
  topPerformer: string | null
  worstPerformer: string | null
  agentCount: number
}> {
  const [metrics, performances] = await Promise.all([loadMetrics(), getAgentPerformance()])

  const totalTasks = metrics.length
  const successfulTasks = metrics.filter((m) => m.success).length
  const totalTokensUsed = metrics.reduce((s, m) => s + m.tokensIn + m.tokensOut, 0)
  const avgExecutionTime = totalTasks > 0
    ? Math.round(metrics.reduce((s, m) => s + m.durationMs, 0) / totalTasks)
    : 0
  const topPerformer = performances.find((p) => p.rank === 'top')?.role ?? null
  const worstPerformer = performances.find((p) => p.rank === 'bottom')?.role ?? null

  return {
    totalTasks,
    overallSuccessRate: totalTasks > 0 ? successfulTasks / totalTasks : 0,
    totalTokensUsed,
    avgExecutionTime,
    topPerformer,
    worstPerformer,
    agentCount: performances.length,
  }
}

// ─── Manually record a metric (for tests / external integrations) ────
export async function recordMetric(m: {
  agentRole: string
  success: boolean
  tokensIn?: number
  tokensOut?: number
  durationMs?: number
  errorType?: string | null
}): Promise<void> {
  const id = `${m.agentRole}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  const value = JSON.stringify({
    id,
    agentRole: m.agentRole,
    success: m.success,
    tokensIn: m.tokensIn ?? 0,
    tokensOut: m.tokensOut ?? 0,
    durationMs: m.durationMs ?? 0,
    errorType: m.errorType ?? null,
    ts: new Date().toISOString(),
  })
  try {
    await db.memoryItem.create({
      data: {
        scope: METRIC_SCOPE,
        key: id,
        value,
        tags: JSON.stringify([`role:${m.agentRole}`, m.success ? 'success' : 'failure']),
      },
    })
  } catch (err) {
    console.warn(
      '[agent-analytics] recordMetric failed:',
      err instanceof Error ? err.message : String(err),
    )
  }
}
