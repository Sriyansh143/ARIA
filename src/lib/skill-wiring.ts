// =====================================================================
// skill-wiring.ts — Maps finance/legal/HR/support skills to departments.
// =====================================================================
// Each department has a default skill set that all its agents inherit
// (in addition to their agent-specific skills). This module is the
// single source of truth for that mapping and exposes helpers to apply
// it at agent-spawn time.
//
// Public API:
//   wireSkillsToAgents(): Promise<{ updated, added }>
//   getSkillsForDepartment(department): string[]
//   getDepartmentSkillMap(): Record<string, string[]>
// =====================================================================

import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import { AGENT_ROSTER } from '@/lib/config'

const DEPARTMENT_SKILLS: Record<string, string[]> = {
  engineering: ['code-gen', 'code-review', 'refactor', 'ci-cd', 'docker', 'rollback', 'debugging', 'testing'],
  research: ['web-search', 'web-reader', 'summarize', 'synthesize', 'cross-check', 'fact-check', 'citation'],
  data: ['data-analysis', 'charts', 'forecast', 'sql', 'ml-pipelines', 'etl', 'dashboards'],
  design: ['wireframes', 'design-system', 'prototyping', 'graphics', 'illustration', 'user-research'],
  product: ['prds', 'backlog', 'prioritization', 'roadmap', 'market-analysis', 'pricing'],
  marketing: ['blog', 'seo-content', 'social-scheduling', 'ab-testing', 'analytics-review', 'lead-magnets'],
  finance: ['invoice-generation', 'payment-reconciliation', 'gst-filing', 'tax-calculation', 'dunning', 'bank-reconciliation'],
  legal: ['contract-drafting', 'compliance-audit', 'ip-management', 'privacy-review', 'litigation-tracking'],
  hr: ['payroll', 'onboarding', 'performance-review', 'engagement-survey', 'ats-management'],
  support: ['ticket-triage', 'knowledge-base', 'csat-tracking', 'escalation-management', 'qbr-prep'],
  sales: ['crm-hygiene', 'pipeline-forecasting', 'cold-outreach', 'demo-delivery', 'deal-negotiation'],
  operations: ['sop-management', 'vendor-management', 'capacity-planning', 'process-automation'],
  security: ['threat-modeling', 'vulnerability-scan', 'incident-response', 'dpia', 'access-review'],
}

// ─── getDepartmentSkillMap ───────────────────────────────────────────
export function getDepartmentSkillMap(): Record<string, string[]> {
  return { ...DEPARTMENT_SKILLS }
}

// ─── getSkillsForDepartment ──────────────────────────────────────────
export function getSkillsForDepartment(department: string): string[] {
  return DEPARTMENT_SKILLS[department.toLowerCase()] || []
}

/** Backwards-compat alias. */
export const getDivisionSkillMap = getDepartmentSkillMap
/** Backwards-compat alias. */
export const getSkillsForDivision = getSkillsForDepartment

// ─── wireSkillsToAgents ──────────────────────────────────────────────
// For every Agent row in the DB, ensure its `skills` JSON column
// includes the department-default skills. Returns counts. Idempotent.
export async function wireSkillsToAgents(): Promise<{ updated: number; added: number }> {
  let updated = 0
  let added = 0
  try {
    const agents = await db.agent.findMany({ select: { id: true, name: true, skills: true } })
    for (const a of agents) {
      // Find the roster seed to get the department
      const seed = AGENT_ROSTER.find(s => s.name === a.name)
      if (!seed) continue
      const divSkills = getSkillsForDepartment(seed.department)
      if (divSkills.length === 0) continue

      // Parse existing skills (it's stored as JSON array or comma-list)
      let existing: string[] = []
      try {
        if (typeof a.skills === 'string') {
          existing = a.skills.startsWith('[') ? JSON.parse(a.skills) : a.skills.split(',').map((s: string) => s.trim()).filter(Boolean)
        } else if (Array.isArray(a.skills)) {
          existing = a.skills as unknown as string[]
        }
      } catch {
        /* ignore parse errors */
      }

      const set = new Set([...existing, ...divSkills])
      const merged = [...set]
      const newCount = merged.length - existing.length
      if (newCount > 0) {
        try {
          await db.agent.update({ where: { id: a.id }, data: { skills: JSON.stringify(merged) } })
          updated++
          added += newCount
        } catch (err) {
          logger.warn({ err: (err as Error).message, agentId: a.id }, 'skill-wiring: update failed')
        }
      }
    }
    logger.info({ updated, added }, 'skill-wiring: complete')
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'skill-wiring: failed')
  }
  return { updated, added }
}
