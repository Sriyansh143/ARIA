// Self-Improvement Engine — Parses natural-language upgrade requests,
// generates implementation plans, scaffolds code, and logs all activity
// to MemoryItem rows (scope='improvement-proposal' / 'self-improvement-log').

import { db } from '@/lib/db'
import { chat } from '@/lib/llm'
import { logger } from '@/lib/logger'
import { randomUUID } from 'crypto'

export type ImprovementIntent = 'skill' | 'plugin' | 'extension' | 'feature'

export interface ImprovementPlan {
  steps: Array<{
    order: number
    title: string
    description: string
    files?: string[]
  }>
  estimatedComplexity: 'low' | 'medium' | 'high'
  riskLevel: 'low' | 'medium' | 'high'
  requiredCapabilities: string[]
}

export interface ParsedIntent {
  intent: ImprovementIntent
  title: string
  description: string
  plan: ImprovementPlan
  scaffoldCode: Record<string, string>
}

export interface ImprovementProposal {
  id: string
  orgId: string | null
  requestedBy: string
  prompt: string
  intent: ImprovementIntent
  title: string
  description: string
  plan: ImprovementPlan
  scaffoldCode: Record<string, string>
  status: 'pending' | 'approved' | 'rejected' | 'implemented'
  reviewedBy?: string
  reviewNote?: string
  createdAt: string
}

// ── Intent parser ────────────────────────────────────────────────────
export async function parseImprovementIntent(prompt: string): Promise<ParsedIntent> {
  const systemPrompt = `You are JARVIS's self-improvement planner. A user has requested a system upgrade.
Parse their request and return a JSON object with:
{
  "intent": "skill" | "plugin" | "extension" | "feature",
  "title": "short title (max 60 chars)",
  "description": "detailed description of what will be built (2-3 sentences)",
  "plan": {
    "steps": [{ "order": 1, "title": "...", "description": "...", "files": ["path/to/file.ts"] }],
    "estimatedComplexity": "low" | "medium" | "high",
    "riskLevel": "low" | "medium" | "high",
    "requiredCapabilities": ["list of capabilities needed"]
  },
  "scaffoldCode": {
    "path/to/file.ts": "// file content here"
  }
}

Rules:
- skill: a new capability JARVIS can use (e.g. web scraping, image analysis)
- plugin: an integration with an external service (e.g. Slack, Notion)
- extension: an enhancement to an existing JARVIS module
- feature: a new UI or workflow feature
- scaffoldCode should contain 1-3 starter files with proper TypeScript
- Keep scaffold code minimal but functional (no placeholders like "TODO")
- Return ONLY valid JSON, no markdown fences`

  const response = await chat(`User request: "${prompt}"`, [], systemPrompt)

  try {
    const parsed = JSON.parse(response.content) as ParsedIntent
    if (!parsed.intent || !parsed.title || !parsed.plan) {
      throw new Error('Missing required fields in parsed intent')
    }
    return parsed
  } catch {
    // Fallback: return a structured default if LLM response is malformed
    return {
      intent: 'skill',
      title: prompt.slice(0, 60),
      description: `User requested: ${prompt}`,
      plan: {
        steps: [
          { order: 1, title: 'Design', description: 'Design the implementation approach', files: [] },
          { order: 2, title: 'Implement', description: 'Write the core implementation', files: [] },
          { order: 3, title: 'Test', description: 'Add tests and verify', files: [] },
        ],
        estimatedComplexity: 'medium',
        riskLevel: 'low',
        requiredCapabilities: [],
      },
      scaffoldCode: {},
    }
  }
}

// ── Persistence helpers (MemoryItem as KV store) ────────────────────
async function persistProposal(p: ImprovementProposal): Promise<void> {
  try {
    await db.memoryItem.upsert({
      where: { key_scope: { key: `proposal:${p.id}`, scope: 'improvement-proposal' } },
      create: {
        scope: 'improvement-proposal',
        key: `proposal:${p.id}`,
        value: JSON.stringify(p),
        tags: JSON.stringify([p.status, p.intent]),
      },
      update: {
        value: JSON.stringify(p),
        tags: JSON.stringify([p.status, p.intent]),
      },
    })
  } catch (err) {
    logger.warn({ err: (err as Error).message, proposalId: p.id }, 'self-improve: persist failed')
  }
}

async function logImprovementEvent(opts: {
  proposalId: string
  eventType: string
  actor: string
  details?: Record<string, unknown>
}): Promise<void> {
  try {
    const id = `log_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
    const entry = {
      id,
      proposalId: opts.proposalId,
      eventType: opts.eventType,
      actor: opts.actor,
      details: opts.details ?? {},
      createdAt: new Date().toISOString(),
    }
    await db.memoryItem.create({
      data: {
        scope: 'self-improvement-log',
        key: `${opts.proposalId}:${id}`,
        value: JSON.stringify(entry),
        tags: JSON.stringify([opts.eventType, opts.actor]),
      },
    })
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'self-improve: log failed')
  }
}

// ── Proposal creation ────────────────────────────────────────────────
export async function createProposal(
  orgId: string | null,
  userId: string,
  prompt: string,
): Promise<{ proposal: ImprovementProposal; parsed: ParsedIntent }> {
  const parsed = await parseImprovementIntent(prompt)
  const proposal: ImprovementProposal = {
    id: `prop_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
    orgId,
    requestedBy: userId,
    prompt,
    intent: parsed.intent,
    title: parsed.title,
    description: parsed.description,
    plan: parsed.plan,
    scaffoldCode: parsed.scaffoldCode,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  await persistProposal(proposal)
  await logImprovementEvent({
    proposalId: proposal.id,
    eventType: 'proposed',
    actor: userId,
    details: { prompt, intent: parsed.intent, title: parsed.title },
  })
  return { proposal, parsed }
}

// ── Approval / rejection ────────────────────────────────────────────
export async function approveProposal(
  proposalId: string,
  reviewerId: string,
  note?: string,
): Promise<ImprovementProposal | null> {
  return updateProposalStatus(proposalId, 'approved', reviewerId, note)
}

export async function rejectProposal(
  proposalId: string,
  reviewerId: string,
  note?: string,
): Promise<ImprovementProposal | null> {
  return updateProposalStatus(proposalId, 'rejected', reviewerId, note)
}

async function updateProposalStatus(
  proposalId: string,
  status: 'approved' | 'rejected' | 'implemented',
  reviewerId: string,
  note?: string,
): Promise<ImprovementProposal | null> {
  try {
    const row = await db.memoryItem.findUnique({
      where: { key_scope: { key: `proposal:${proposalId}`, scope: 'improvement-proposal' } },
    })
    if (!row) return null
    const proposal = JSON.parse(row.value) as ImprovementProposal
    proposal.status = status
    proposal.reviewedBy = reviewerId
    proposal.reviewNote = note
    await persistProposal(proposal)
    await logImprovementEvent({
      proposalId,
      eventType: status,
      actor: reviewerId,
      details: { note },
    })
    return proposal
  } catch (err) {
    logger.warn({ err: (err as Error).message, proposalId }, 'self-improve: updateStatus failed')
    return null
  }
}

// ── Listing ──────────────────────────────────────────────────────────
export async function listProposals(opts?: {
  status?: ImprovementProposal['status']
  limit?: number
}): Promise<ImprovementProposal[]> {
  try {
    const rows = await db.memoryItem.findMany({
      where: { scope: 'improvement-proposal' },
      orderBy: { createdAt: 'desc' },
      take: opts?.limit ?? 100,
    })
    let proposals = rows
      .map(r => {
        try { return JSON.parse(r.value) as ImprovementProposal } catch { return null }
      })
      .filter((p): p is ImprovementProposal => p !== null)
    if (opts?.status) {
      proposals = proposals.filter(p => p.status === opts.status)
    }
    return proposals
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'self-improve: listProposals failed')
    return []
  }
}

// ── Auto-suggestion from performance metrics ────────────────────────
// Looks at agents with low recent success rates (based on AgentLog
// info-vs-error ratio) and auto-creates improvement proposals.
export async function generateAutoSuggestions(orgId: string | null): Promise<void> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  try {
    const agents = await db.agent.findMany({
      select: { id: true, name: true },
      take: 50,
    })

    for (const agent of agents) {
      const [total, errors] = await Promise.all([
        db.agentLog.count({ where: { agentId: agent.id, createdAt: { gte: sevenDaysAgo } } }),
        db.agentLog.count({ where: { agentId: agent.id, createdAt: { gte: sevenDaysAgo }, level: 'error' } }),
      ])
      if (total < 5) continue  // not enough data
      const successRate = 1 - (errors / total)
      if (successRate >= 0.7) continue  // performing well

      const successPct = Math.round(successRate * 100)
      const prompt = `Improve ${agent.name} agent performance — currently at ${successPct}% success rate. Analyze skill gaps and suggest targeted improvements.`

      // Check existing pending proposal for this agent name
      const existing = await listProposals({ status: 'pending', limit: 500 })
      if (existing.some(p => p.prompt.includes(agent.name))) continue

      const { proposal } = await createProposal(orgId, 'system', prompt)
      await logImprovementEvent({
        proposalId: proposal.id,
        eventType: 'auto_suggested',
        actor: 'system',
        details: { agentId: agent.id, agentName: agent.name, successRate },
      })
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'self-improve: generateAutoSuggestions failed')
  }
}
