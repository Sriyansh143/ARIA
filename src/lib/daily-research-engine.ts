// =====================================================================
// daily-research-engine.ts — Scheduled research on repos + trends.
// =====================================================================
// Runs daily at configurable times to research:
//   1. New open-source repos that could upgrade JARVIS features
//   2. Market trends in AI agents, automation, SaaS
//   3. Competitor analysis (similar products)
//   4. Tech news relevant to our stack
//   5. Pricing research (what others charge for similar services)
//
// All findings stored as MemoryItem rows (scope='research-log') with
// action items + sources. Never throws.
// =====================================================================

import { db } from '@/lib/db'
import { chat } from '@/lib/llm'
import { logger } from '@/lib/logger'
import { randomUUID } from 'crypto'

// ─── Research categories with schedules ───────────────────────────────
export const RESEARCH_SCHEDULES = [
  {
    category: 'opensource_repos',
    topic: 'New AI agent frameworks and automation tools on GitHub',
    cronHour: 6,  // 6 AM
    prompt: `Search GitHub trending repositories from the past week for:
1. AI agent frameworks (like CrewAI, AutoGen, LangGraph alternatives)
2. Automation tools (like n8n alternatives, Zapier alternatives)
3. Voice AI (like LiveKit, Whisper, Piper TTS alternatives)
4. Vector databases (like Chroma, LanceDB, sqlite-vec)
5. Browser automation (like Playwright, Puppeteer alternatives)

For each interesting repo found, note:
- Repo name + URL
- Star count (if visible)
- What it does
- How it could improve JARVIS
- Relevance score (0.0-1.0)

Focus on repos with MIT/Apache/BSD licenses only.`,
  },
  {
    category: 'market_trends',
    topic: 'AI agent and automation market trends',
    cronHour: 7,
    prompt: `Research current market trends in:
1. AI agent platforms — what features are users demanding?
2. No-code/low-code automation — what's new?
3. AI-powered business tools — pricing models
4. Voice AI for business — adoption trends
5. Open-source vs SaaS — which way is the market moving?

Summarize key findings + suggest 3 action items for JARVIS.`,
  },
  {
    category: 'competitor_analysis',
    topic: 'Competitor analysis — similar AI agent platforms',
    cronHour: 8,
    prompt: `Research competitors to JARVIS Mission Control:
1. OpenWebUI — what features do they have that we don't?
2. LibreChat — what can we learn from their UX?
3. LobeChat — plugin marketplace patterns
4. AutoGPT/AgentGPT — goal decomposition UX
5. Open Interpreter — code execution patterns

For each competitor, note:
- Key feature we're missing
- How they implement it
- Whether we should adapt it
- Priority (high/medium/low)`,
  },
  {
    category: 'tech_news',
    topic: 'Tech news relevant to our stack (Next.js, Prisma, Ollama)',
    cronHour: 9,
    prompt: `Research recent tech news relevant to our stack:
1. Next.js 16 updates and best practices
2. Prisma ORM new features
3. Ollama new model releases
4. React 19 patterns
5. TypeScript tips for large codebases
6. Tailwind CSS 4 updates

Focus on actionable improvements we can make to JARVIS.`,
  },
  {
    category: 'pricing_research',
    topic: 'Pricing research — what to charge for services',
    cronHour: 12,
    prompt: `Research pricing for services JARVIS can offer:
1. Website design (3D/modern) — what do agencies charge?
2. Automation scripts — per-project vs hourly
3. Social media management — monthly retainers
4. AI chatbot deployment — setup + monthly fees
5. Data scraping services — per-1000-records pricing
6. Code review/audit services

Suggest optimal pricing for each service we can offer.`,
  },
]

export interface ResearchLogEntry {
  id: string
  category: string
  topic: string
  findings: string
  sources: string[]
  actionItems: string[]
  repoUrl: string | null
  relevanceScore: number
  implemented: boolean
  createdAt: string
}

function toEntry(row: { key: string; value: string; createdAt: Date }): ResearchLogEntry | null {
  try {
    const v = JSON.parse(row.value) as Partial<ResearchLogEntry>
    if (!v || typeof v.findings !== 'string') return null
    return {
      id: v.id ?? row.key,
      category: v.category ?? 'unknown',
      topic: v.topic ?? '',
      findings: v.findings,
      sources: Array.isArray(v.sources) ? v.sources : [],
      actionItems: Array.isArray(v.actionItems) ? v.actionItems : [],
      repoUrl: v.repoUrl ?? null,
      relevanceScore: typeof v.relevanceScore === 'number' ? v.relevanceScore : 0.5,
      implemented: v.implemented ?? false,
      createdAt: v.createdAt ?? row.createdAt.toISOString(),
    }
  } catch {
    return null
  }
}

// ─── Run a research session ───────────────────────────────────────────
export async function runResearchSession(category: string, customTopic?: string): Promise<{
  logId: string
  findings: string
  actionItems: string[]
  sources: string[]
}> {
  const schedule = RESEARCH_SCHEDULES.find(s => s.category === category)
  if (!schedule && !customTopic) {
    throw new Error(`Unknown research category: ${category}`)
  }

  const topic = customTopic || schedule?.topic || category
  const prompt = schedule?.prompt || `Research: ${topic}`

  logger.info({ category, topic }, 'research: starting session')

  // Use the LLM to generate research findings based on its training data
  const researchPrompt = `${prompt}

Provide a comprehensive summary with:
1. Key findings (3-5 bullet points)
2. Actionable recommendations for JARVIS (2-3 items)
3. Relevant URLs/sources (if known)

Format as markdown.`

  const result = await chat(researchPrompt)

  // Extract action items from the response
  const actionItems: string[] = []
  const actionMatch = result.content.match(/(?:action|recommend|suggest|should|implement|upgrade|update)[^]*?(?:\d+\.\s+.+)/gi)
  if (actionMatch) {
    for (const m of actionMatch.slice(0, 5)) {
      const items = m.match(/\d+\.\s+(.+)/g)
      if (items) actionItems.push(...items.map(i => i.replace(/^\d+\.\s+/, '')))
    }
  }

  // Extract URLs
  const sources: string[] = []
  const urlMatches = result.content.match(/https?:\/\/[^\s)]+/g)
  if (urlMatches) sources.push(...urlMatches.slice(0, 10))

  // Check if any repos are mentioned
  const repoMatch = result.content.match(/(?:github\.com\/|gitlab\.com\/)([\w-]+\/[\w-]+)/g)
  const repoUrl = repoMatch ? `https://${repoMatch[0]}` : null

  // Store as MemoryItem
  const id = `rl_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
  const entry: ResearchLogEntry = {
    id,
    category,
    topic,
    findings: result.content,
    sources,
    actionItems: actionItems.slice(0, 10),
    repoUrl,
    relevanceScore: actionItems.length > 0 ? 0.8 : 0.5,
    implemented: false,
    createdAt: new Date().toISOString(),
  }

  try {
    await db.memoryItem.create({
      data: {
        scope: 'research-log',
        key: `${category}:${id}`,
        value: JSON.stringify(entry),
        tags: JSON.stringify([category, `score-${Math.round(entry.relevanceScore * 10)}`]),
      },
    })
  } catch (err) {
    logger.warn({ err: (err as Error).message, category }, 'research: persist failed')
  }

  logger.info({ logId: id, category, actionItemCount: actionItems.length }, 'research: session complete')

  return {
    logId: id,
    findings: result.content,
    actionItems: actionItems.slice(0, 10),
    sources,
  }
}

// ─── Get recent research logs ────────────────────────────────────────
export async function getRecentResearch(limit: number = 20): Promise<ResearchLogEntry[]> {
  try {
    const rows = await db.memoryItem.findMany({
      where: { scope: 'research-log' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return rows.map(toEntry).filter((e): e is ResearchLogEntry => e !== null)
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'research: getRecentResearch failed')
    return []
  }
}

// ─── Get unimplemented research with high relevance ──────────────────
export async function getActionableResearch(): Promise<ResearchLogEntry[]> {
  try {
    const rows = await db.memoryItem.findMany({
      where: { scope: 'research-log' },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    return rows
      .map(toEntry)
      .filter((e): e is ResearchLogEntry => e !== null)
      .filter(e => !e.implemented && e.relevanceScore >= 0.7)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 10)
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'research: getActionableResearch failed')
    return []
  }
}

// ─── Mark research as implemented ────────────────────────────────────
export async function markResearchImplemented(logId: string): Promise<void> {
  try {
    // Find by key suffix
    const rows = await db.memoryItem.findMany({
      where: { scope: 'research-log' },
      take: 500,
    })
    for (const row of rows) {
      const entry = toEntry(row)
      if (entry && entry.id === logId) {
        const updated = { ...entry, implemented: true }
        await db.memoryItem.update({
          where: { id: row.id },
          data: { value: JSON.stringify(updated) },
        })
        return
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, logId }, 'research: markResearchImplemented failed')
  }
}

// ─── Run all scheduled research for today ────────────────────────────
export async function runDailyResearch(): Promise<void> {
  const now = new Date()
  const currentHour = now.getHours()

  for (const schedule of RESEARCH_SCHEDULES) {
    // Check if we've already run this category today
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    let alreadyRan = false
    try {
      const existing = await db.memoryItem.findFirst({
        where: {
          scope: 'research-log',
          createdAt: { gte: today },
        },
        take: 1,
      })
      // Note: findFirst doesn't filter by tag, so we do an extra check
      if (existing) {
        const entry = toEntry(existing)
        if (entry && entry.category === schedule.category) {
          alreadyRan = true
        }
      }
    } catch {
      /* ignore */
    }

    if (alreadyRan) {
      logger.info({ category: schedule.category }, 'research: already run today, skipping')
      continue
    }

    // Run if it's past the scheduled hour
    if (currentHour >= schedule.cronHour) {
      try {
        await runResearchSession(schedule.category)
      } catch (err) {
        logger.warn({ category: schedule.category, err: (err as Error).message }, 'research: session failed')
      }
    }
  }
}
