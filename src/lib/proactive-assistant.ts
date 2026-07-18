// Proactive Assistant — port of OpenClaw's proactive behavior pattern.
//
// Adds:
//   - Proactive insight generation (LLM analyzes recent activity + suggests next steps)
//   - Anomaly detection (detect spikes in usage, errors, rate limits)
//   - Smart notification routing (decide which channel to use based on urgency)
//   - Daily summary generation (morning digest of what happened overnight)

import { chat } from '@/lib/llm'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'

export interface ProactiveInsight {
  type: 'opportunity' | 'warning' | 'suggestion' | 'anomaly'
  priority: 'low' | 'medium' | 'high' | 'critical'
  title: string
  description: string
  suggestedAction: string
  category: string
}

export interface DailySummary {
  date: string
  headline: string
  keyMetrics: {
    totalChats: number
    totalTasks: number
    totalTokensIn: number
    totalTokensOut: number
    estimatedCostUsd: number
    errorsCount: number
    rateLimitHits: number
  }
  highlights: string[]
  concerns: string[]
  recommendations: string[]
}

interface InsightJson {
  type?: string
  priority?: string
  title?: string
  description?: string
  suggested_action?: string
  category?: string
}

function parseInsights(raw: string): ProactiveInsight[] {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return []
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { insights?: InsightJson[] }
    if (!parsed.insights || !Array.isArray(parsed.insights)) return []
    return parsed.insights.map((i): ProactiveInsight => ({
      type: (['opportunity', 'warning', 'suggestion', 'anomaly'].includes(i.type ?? '')
        ? i.type : 'suggestion') as ProactiveInsight['type'],
      priority: (['low', 'medium', 'high', 'critical'].includes(i.priority ?? '')
        ? i.priority : 'medium') as ProactiveInsight['priority'],
      title: String(i.title ?? '').slice(0, 200),
      description: String(i.description ?? '').slice(0, 500),
      suggestedAction: String(i.suggested_action ?? '').slice(0, 500),
      category: String(i.category ?? 'general').slice(0, 50),
    }))
  } catch {
    return []
  }
}

/**
 * Generate proactive insights by analyzing recent activity.
 */
export async function generateProactiveInsights(_model: string): Promise<ProactiveInsight[]> {
  const now = new Date()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  try {
    const [recentMessages, recentTasks, recentTelemetry, recentFallbacks] = await Promise.all([
      db.chatMessage.findMany({
        where: { createdAt: { gte: yesterday } },
        take: 50,
        orderBy: { createdAt: 'desc' },
        select: { role: true, model: true, latency: true, createdAt: true },
      }),
      db.task.findMany({
        where: { createdAt: { gte: yesterday } },
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: { title: true, status: true, createdAt: true },
      }),
      db.telemetry.findMany({
        where: { createdAt: { gte: yesterday } },
        take: 100,
        orderBy: { createdAt: 'desc' },
        select: { tokens: true, latency: true, createdAt: true },
      }),
      db.fallbackEvent.findMany({
        where: { createdAt: { gte: yesterday } },
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: { provider: true, reason: true, recovered: true },
      }),
    ])

    const totalTokensIn = recentTelemetry.reduce((sum, t) => sum + (t.tokens || 0), 0)
    const modelUsage: Record<string, number> = {}
    for (const m of recentMessages) {
      if (m.model) modelUsage[m.model] = (modelUsage[m.model] || 0) + 1
    }
    const incompleteTasks = recentTasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length
    const fallbackCount = recentFallbacks.length
    const unrecoveredFallbacks = recentFallbacks.filter(f => !f.recovered).length

    const context = `Recent activity (last 24 hours):
- Total chat messages: ${recentMessages.length}
- Total tasks: ${recentTasks.length} (${incompleteTasks} incomplete)
- Total tokens: ${totalTokensIn}
- Model usage: ${JSON.stringify(modelUsage)}
- Fallback events: ${fallbackCount} (${unrecoveredFallbacks} unrecovered)
- Fallback reasons: ${recentFallbacks.map(f => f.reason).join(', ') || 'none'}

Recent task titles:
${recentTasks.map(t => `- [${t.status}] ${t.title}`).join('\n')}`

    const prompt = `You are a proactive AI assistant analyzing the user's recent activity. Generate 3-5 insights that would help the user.

Context:
${context}

Respond with JSON only:
{
  "insights": [
    {
      "type": "opportunity|warning|suggestion|anomaly",
      "priority": "low|medium|high|critical",
      "title": "Short title",
      "description": "What you noticed (1-2 sentences)",
      "suggested_action": "What the user should do",
      "category": "cost|performance|security|productivity|reliability"
    }
  ]
}

Focus on actionable insights. Don't state the obvious. If everything is fine, return an empty array.`

    const result = await chat(prompt)
    return parseInsights(result.content)
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'proactive: generateInsights failed')
    return []
  }
}

/**
 * Generate a daily summary (morning digest).
 */
export async function generateDailySummary(_model: string): Promise<DailySummary> {
  const now = new Date()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  try {
    const [messages, tasks, telemetry, fallbacks, logs] = await Promise.all([
      db.chatMessage.count({ where: { createdAt: { gte: yesterday } } }),
      db.task.count({ where: { createdAt: { gte: yesterday } } }),
      db.telemetry.findMany({ where: { createdAt: { gte: yesterday } } }),
      db.fallbackEvent.count({ where: { createdAt: { gte: yesterday } } }),
      db.agentLog.findMany({
        where: { createdAt: { gte: yesterday }, level: { in: ['error', 'warn'] } },
        take: 20,
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const tokensIn = telemetry.reduce((s, t) => s + (t.tokens || 0), 0)
    // Rough cost estimate — assumes $0.01 per 1k tokens (blended GLM pricing)
    const costUsd = (tokensIn / 1000) * 0.01
    const errorsCount = logs.filter(l => l.level === 'error').length

    const recentTaskTitles = await db.task.findMany({
      where: { createdAt: { gte: yesterday } },
      take: 10,
      select: { title: true, status: true },
    })

    const prompt = `Generate a daily summary based on this activity data:

Date: ${now.toISOString().slice(0, 10)}
Messages sent: ${messages}
Tasks created: ${tasks}
Tokens used: ${tokensIn} (est. cost: $${costUsd.toFixed(2)})
Fallback events: ${fallbacks}
Errors: ${errorsCount}

Recent task titles:
${recentTaskTitles.map(t => `- [${t.status}] ${t.title}`).join('\n') || '(no tasks)'}

Respond with JSON only:
{
  "headline": "One-sentence summary of the day",
  "highlights": ["Notable achievements or patterns (2-4 items)"],
  "concerns": ["Issues that need attention (0-3 items)"],
  "recommendations": ["What to do today (2-4 items)"]
}`

    const result = await chat(prompt)

    let parsed: { headline?: string; highlights?: string[]; concerns?: string[]; recommendations?: string[] } | null = null
    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/)
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null
    } catch { /* ignore */ }

    return {
      date: now.toISOString().slice(0, 10),
      headline: parsed?.headline || `${messages} messages, ${tasks} tasks, $${costUsd.toFixed(2)} spent`,
      keyMetrics: {
        totalChats: messages,
        totalTasks: tasks,
        totalTokensIn: tokensIn,
        totalTokensOut: 0,
        estimatedCostUsd: costUsd,
        errorsCount,
        rateLimitHits: fallbacks,
      },
      highlights: Array.isArray(parsed?.highlights) ? parsed.highlights : [],
      concerns: Array.isArray(parsed?.concerns) ? parsed.concerns : [],
      recommendations: Array.isArray(parsed?.recommendations) ? parsed.recommendations : [],
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'proactive: generateDailySummary failed')
    return {
      date: now.toISOString().slice(0, 10),
      headline: 'Summary generation failed',
      keyMetrics: {
        totalChats: 0, totalTasks: 0, totalTokensIn: 0, totalTokensOut: 0,
        estimatedCostUsd: 0, errorsCount: 0, rateLimitHits: 0,
      },
      highlights: [], concerns: [], recommendations: [],
    }
  }
}

/**
 * Smart notification routing — decides which channel to use based on urgency.
 */
export function routeNotification(priority: ProactiveInsight['priority']): {
  channels: Array<'telegram' | 'email' | 'dashboard' | 'log'>
  immediate: boolean
} {
  switch (priority) {
    case 'critical':
      return { channels: ['telegram', 'dashboard'], immediate: true }
    case 'high':
      return { channels: ['email', 'dashboard'], immediate: false }
    case 'medium':
      return { channels: ['dashboard'], immediate: false }
    case 'low':
    default:
      return { channels: ['log'], immediate: false }
  }
}
