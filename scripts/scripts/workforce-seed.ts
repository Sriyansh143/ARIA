// workforce-seed.ts — Expands the workforce with agents for all 5 departments.
// Run with: bun run scripts/workforce-seed.ts
import { db } from '../src/lib/db'

const DEPARTMENTS = [
  { key: 'engineering', name: 'Engineering', description: 'Software development, architecture, DevOps, QA' },
  { key: 'business', name: 'Business', description: 'Strategy, finance, sales, operations, billing' },
  { key: 'data', name: 'Research & Data', description: 'Data science, ML, analysis, academic research' },
  { key: 'product', name: 'Content & Product', description: 'Writing, editing, SEO, design, UX' },
  { key: 'operations', name: 'Security & Operations', description: 'Audit, compliance, guardrails, incident response' },
]

// Specialized agents per department (based on company requirements)
const AGENTS = [
  // Engineering
  { name: 'Chief-Architect', role: 'code-architect', title: 'Chief Software Architect', dept: 'engineering', seniority: 'executive' },
  { name: 'Frontend-Lead', role: 'frontend-dev', title: 'Frontend Development Lead', dept: 'engineering', seniority: 'lead' },
  { name: 'Backend-Lead', role: 'backend-dev', title: 'Backend Development Lead', dept: 'engineering', seniority: 'lead' },
  { name: 'DevOps-Engineer', role: 'devops', title: 'DevOps & Infrastructure Engineer', dept: 'engineering', seniority: 'senior' },
  { name: 'QA-Engineer', role: 'qa', title: 'Quality Assurance Engineer', dept: 'engineering', seniority: 'mid' },
  { name: 'Mobile-Developer', role: 'mobile-dev', title: 'Mobile Application Developer', dept: 'engineering', seniority: 'mid' },

  // Business
  { name: 'CEO', role: 'ceo', title: 'Chief Executive Officer', dept: 'business', seniority: 'executive' },
  { name: 'CFO', role: 'cfo', title: 'Chief Financial Officer', dept: 'business', seniority: 'executive' },
  { name: 'Account-Executive', role: 'account-executive', title: 'Senior Account Executive', dept: 'business', seniority: 'senior' },
  { name: 'Billing-Specialist', role: 'billing', title: 'Billing & Invoicing Specialist', dept: 'business', seniority: 'mid' },
  { name: 'Revenue-Manager', role: 'revenue-manager', title: 'Revenue Operations Manager', dept: 'business', seniority: 'senior' },

  // Research & Data
  { name: 'Claude-Reasoner', role: 'reasoning-engine', title: 'Claude-Level Reasoning Engine', dept: 'data', seniority: 'lead' },
  { name: 'Data-Scientist', role: 'data-scientist', title: 'Senior Data Scientist', dept: 'data', seniority: 'senior' },
  { name: 'ML-Engineer', role: 'ml-engineer', title: 'Machine Learning Engineer', dept: 'data', seniority: 'senior' },
  { name: 'Research-Analyst', role: 'analyst', title: 'Research & Intelligence Analyst', dept: 'data', seniority: 'mid' },

  // Content & Product
  { name: 'Content-Director', role: 'content-manager', title: 'Director of Content', dept: 'product', seniority: 'lead' },
  { name: 'Technical-Writer', role: 'writer', title: 'Senior Technical Writer', dept: 'product', seniority: 'senior' },
  { name: 'SEO-Specialist', role: 'seo', title: 'SEO & Growth Specialist', dept: 'product', seniority: 'mid' },
  { name: 'UI-UX-Designer', role: 'designer', title: 'UI/UX Designer', dept: 'product', seniority: 'mid' },

  // Security & Operations
  { name: 'Guardrail-Sentinel', role: 'safety-officer', title: 'Safety & Guardrails Officer', dept: 'operations', seniority: 'lead' },
  { name: 'Security-Analyst', role: 'security-analyst', title: 'Cybersecurity Analyst', dept: 'operations', seniority: 'senior' },
  { name: 'Compliance-Officer', role: 'compliance', title: 'Compliance & Audit Officer', dept: 'operations', seniority: 'senior' },
  { name: 'Pipeline-Orchestrator', role: 'pipeline-manager', title: 'Intelligence Pipeline Manager', dept: 'operations', seniority: 'senior' },
  { name: 'Memory-Curator', role: 'memory-manager', title: 'Memory & Knowledge Curator', dept: 'data', seniority: 'senior' },
  { name: 'Skill-Dispatcher', role: 'skill-router', title: 'Skill Routing & Dispatch Agent', dept: 'engineering', seniority: 'mid' },
  { name: 'Incident-Responder', role: 'incident-response', title: 'Incident Response Coordinator', dept: 'operations', seniority: 'mid' },
]

async function main() {
  console.log('[workforce-seed] Expanding workforce...')

  // Upsert departments
  for (const d of DEPARTMENTS) {
    const existing = await db.department.findFirst({ where: { key: d.key } })
    if (!existing) {
      await db.department.create({ data: { key: d.key, name: d.name, description: d.description } })
      console.log(`  + department ${d.name}`)
    }
  }

  // Upsert workforce agents
  let created = 0, updated = 0
  for (const a of AGENTS) {
    const dept = await db.department.findFirst({ where: { key: a.dept } })
    const existing = await db.workforceAgent.findFirst({ where: { name: a.name } })
    if (!existing) {
      await db.workforceAgent.create({
        data: {
          name: a.name,
          role: a.role,
          title: a.title,
          departmentId: dept?.id,
          seniority: a.seniority,
        },
      })
      created++
    } else {
      await db.workforceAgent.update({
        where: { id: existing.id },
        data: { role: a.role, title: a.title, departmentId: dept?.id, seniority: a.seniority },
      })
      updated++
    }
  }

  const stats = {
    departments: await db.department.count(),
    workforceAgents: await db.workforceAgent.count(),
    regularAgents: await db.agent.count(),
  }
  console.log(`[workforce-seed] Created ${created}, updated ${updated} workforce agents`)
  console.log('[workforce-seed] Summary:', stats)
  console.log('[workforce-seed] Done.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
