// =====================================================================
// seed-agents.ts — Idempotent seeder for the R-3 expansion.
// =====================================================================
// Seeds:
//   1. db.agent — all 64 agents from AGENT_ROSTER (or updates existing).
//   2. db.department — 16 departments (R-2 schema).
//   3. db.workforceAgent — 25 workforce agents spread across departments.
//   4. db.rule — 10 default operator rules.
//   5. db.plugin — 8 default plugins.
//   6. db.model — 20 models across 5 providers.
//   7. db.skillLearning — sample learning records for the Learning tab.
//
// Run: `cd /home/z/my-project && bunx tsx scripts/seed-agents.ts`
// =====================================================================

import { db } from '../src/lib/db';
import { AGENT_ROSTER, DEPARTMENTS } from '../src/lib/config';

// ─── Department missions (matches R-2 schema: key/name/mission/headAgent/accent) ───
const DEPT_MISSIONS: Record<string, string> = {
  engineering: 'Design, build, ship, and operate software systems end-to-end.',
  research: 'Gather, synthesize, and verify information from the web and internal sources.',
  data: 'Transform raw data into models, dashboards, and actionable insights.',
  design: 'Craft intuitive, beautiful, accessible product experiences.',
  product: 'Define the roadmap, prioritize features, and own customer outcomes.',
  marketing: 'Drive awareness, demand, and qualified pipeline.',
  sales: 'Convert pipeline into revenue and own customer relationships.',
  finance: 'Manage P&L, billing, collections, and statutory compliance.',
  legal: 'Protect the company legally, ensure contracts and privacy compliance.',
  hr: 'Hire, onboard, develop, and retain great people.',
  operations: 'Optimize processes, manage vendors, and keep the engine running.',
  security: 'Defend the perimeter, ensure compliance, respond to incidents.',
  support: 'Resolve customer issues fast and drive retention/expansion.',
  content: 'Produce clear, persuasive, on-brand written content.',
  qa: 'Test, review, benchmark, and prevent defects reaching production.',
  infrastructure: 'Keep the platform reliable, observable, and scalable.',
};

const DEPT_ACCENT: Record<string, string> = {
  engineering: '#7DD3FC',
  research: '#C4B5FD',
  data: '#34D399',
  design: '#FBBF24',
  product: '#F87171',
  marketing: '#38BDF8',
  sales: '#A78BFA',
  finance: '#34D399',
  legal: '#FBBF24',
  hr: '#F472B6',
  operations: '#7DD3FC',
  security: '#F87171',
  support: '#34D399',
  content: '#C4B5FD',
  qa: '#FBBF24',
  infrastructure: '#38BDF8',
};

async function seedAgents() {
  console.log('→ Seeding 64 agents into db.agent…');
  for (const a of AGENT_ROSTER) {
    await db.agent.upsert({
      where: { codename: a.codename },
      update: {
        name: a.name,
        role: a.role,
        status: a.status,
        skills: JSON.stringify(a.skills),
        model: a.model,
        load: a.load,
        successRate: a.successRate,
      },
      create: {
        name: a.name,
        codename: a.codename,
        role: a.role,
        status: a.status,
        skills: JSON.stringify(a.skills),
        model: a.model,
        load: a.load,
        successRate: a.successRate,
      },
    });
  }
  const count = await db.agent.count();
  console.log(`  ✓ ${count} agents in db.agent`);
}

async function seedDepartments() {
  console.log('→ Seeding 16 departments into db.department…');
  for (const d of DEPARTMENTS) {
    // Find a candidate head agent for this department (c-suite or director).
    const head = AGENT_ROSTER.find((a) => a.department === d.key && (a.seniority === 'c-suite' || a.seniority === 'director' || a.seniority === 'lead'));
    await db.department.upsert({
      where: { key: d.key },
      update: {
        name: d.name,
        mission: DEPT_MISSIONS[d.key] ?? `${d.name} department`,
        headAgent: head?.codename ?? null,
        accent: DEPT_ACCENT[d.key] ?? d.color,
      },
      create: {
        key: d.key,
        name: d.name,
        mission: DEPT_MISSIONS[d.key] ?? `${d.name} department`,
        headAgent: head?.codename ?? null,
        accent: DEPT_ACCENT[d.key] ?? d.color,
      },
    });
  }
  const count = await db.department.count();
  console.log(`  ✓ ${count} departments in db.department`);
}

async function seedWorkforceAgents() {
  console.log('→ Seeding workforce agents into db.workforceAgent…');
  // Seed the first ~25 agents from the roster as workforce agents.
  // Map config seniority → R-2 seniority ('specialist' is the default).
  const seniorityMap: Record<string, string> = {
    'c-suite': 'c-suite',
    vp: 'vp',
    director: 'director',
    lead: 'lead',
    senior: 'senior',
    mid: 'specialist',
    junior: 'junior',
    intern: 'intern',
  };
  const modelTierMap: Record<string, string> = {
    'c-suite': 'giant',
    vp: 'giant',
    director: 'strong',
    lead: 'strong',
    senior: 'strong',
    mid: 'fast',
    junior: 'fast',
    intern: 'local',
  };
  // Pick 25 across departments — first 1-2 from each.
  const selected: typeof AGENT_ROSTER = [];
  const byDept = new Map<string, typeof AGENT_ROSTER>();
  for (const a of AGENT_ROSTER) {
    const list = byDept.get(a.department) ?? [];
    list.push(a);
    byDept.set(a.department, list);
  }
  for (const [, list] of byDept) {
    // Take 1-2 from each department (cap at 25 total).
    for (const a of list) {
      if (selected.length >= 25) break;
      selected.push(a);
    }
    if (selected.length >= 25) break;
  }
  // Seed all 64 anyway (the tab will show all of them, capped at 64).
  for (const a of AGENT_ROSTER) {
    const head = AGENT_ROSTER.find((x) => x.department === a.department && (x.seniority === 'c-suite' || x.seniority === 'director' || x.seniority === 'lead'));
    await db.workforceAgent.upsert({
      where: { codename: a.codename },
      update: {
        name: a.name,
        title: a.title,
        departmentKey: a.department,
        seniority: seniorityMap[a.seniority] ?? 'specialist',
        modelTier: modelTierMap[a.seniority] ?? 'fast',
        skills: JSON.stringify(a.skills),
        status: 'active',
        reportsTo: head && head.codename !== a.codename ? head.codename : null,
      },
      create: {
        codename: a.codename,
        name: a.name,
        title: a.title,
        departmentKey: a.department,
        seniority: seniorityMap[a.seniority] ?? 'specialist',
        modelTier: modelTierMap[a.seniority] ?? 'fast',
        skills: JSON.stringify(a.skills),
        status: 'active',
        reportsTo: head && head.codename !== a.codename ? head.codename : null,
      },
    });
  }
  const count = await db.workforceAgent.count();
  console.log(`  ✓ ${count} workforce agents in db.workforceAgent`);
}

async function seedRules() {
  console.log('→ Seeding 10 default operator rules…');
  const rules = [
    { key: 'non-investment-only', title: 'Non-Investment Only', description: 'The system must never invest money in stocks, crypto, or any financial instrument without explicit operator approval.', category: 'financial', priority: 'critical' },
    { key: 'owner-approval-pricing', title: 'Owner Approval for Pricing', description: 'Any pricing changes (product, service, subscription) require explicit owner sign-off before publication.', category: 'financial', priority: 'high' },
    { key: 'research-before-action', title: 'Research Before Action', description: 'Agents must gather and cite at least 2 sources before executing on novel or unfamiliar tasks.', category: 'operational', priority: 'medium' },
    { key: 'multi-agent-discussion', title: 'Multi-Agent Discussion Before Complex Tasks', description: 'Tasks marked "complex" must be decomposed and reviewed by ≥2 specialist agents before execution.', category: 'operational', priority: 'high' },
    { key: 'no-destructive-without-snapshot', title: 'No Destructive Ops Without Snapshot', description: 'Destructive operations (schema push, file delete, db wipe) must snapshot first via the rollback system.', category: 'safety', priority: 'critical' },
    { key: 'pii-redaction', title: 'PII Redaction in Logs', description: 'Personally Identifiable Information (emails, phones, SSNs) must be redacted before persistence to any log or memory.', category: 'safety', priority: 'high' },
    { key: 'payment-confirmation', title: 'Double-Confirm Payments', description: 'Outbound payments >$100 require a second confirmation step from the operator or CFO agent.', category: 'financial', priority: 'high' },
    { key: 'contract-review-required', title: 'Contract Review Required', description: 'Any agreement (MSA, SOW, NDA) must be reviewed by HALCYON (Contract Attorney) before signature.', category: 'legal', priority: 'high' },
    { key: 'data-export-audit', title: 'Data Export Audit Trail', description: 'All bulk data exports (>100 rows) must be logged in the Blackbox with requester + recipient.', category: 'legal', priority: 'medium' },
    { key: 'transparent-failure', title: 'Transparent Failure Reporting', description: 'When an agent fails, the error + stack trace must be recorded in the Blackbox before retry.', category: 'operational', priority: 'medium' },
  ];
  for (const r of rules) {
    await db.rule.upsert({
      where: { key: r.key },
      update: { title: r.title, description: r.description, category: r.category, priority: r.priority },
      create: { ...r, enabled: true },
    });
  }
  const count = await db.rule.count();
  console.log(`  ✓ ${count} rules in db.rule`);
}

async function seedPlugins() {
  console.log('→ Seeding 8 default plugins…');
  const plugins = [
    { key: 'web-search', name: 'Web Search', description: 'Search the live web for up-to-date information with citations.', category: 'research', version: '1.2.0', enabled: true, config: '{"maxResults":10,"safeSearch":true}' },
    { key: 'web-reader', name: 'Web Reader', description: 'Extract clean article content from any URL — handles paywalls gracefully.', category: 'research', version: '1.1.0', enabled: true, config: '{"timeoutMs":15000}' },
    { key: 'code-sandbox', name: 'Code Sandbox', description: 'Execute untrusted code in an isolated sandbox with resource limits.', category: 'automation', version: '2.0.1', enabled: true, config: '{"runtime":"bun","maxMemoryMb":256,"maxCpuMs":5000}' },
    { key: 'email-native', name: 'Email (Native)', description: 'Send and receive emails via SMTP/IMAP. Supports templated outreach.', category: 'comms', version: '1.0.5', enabled: false, config: '{"provider":"smtp","batchSize":50}' },
    { key: 'telegram-bot', name: 'Telegram Bot', description: 'Send messages, files, and notifications via a Telegram bot.', category: 'comms', version: '1.3.0', enabled: false, config: '{"allowedChats":[]}' },
    { key: 'calendar-sync', name: 'Calendar Sync', description: 'Two-way sync with Google Calendar / Outlook.', category: 'integration', version: '0.9.2', enabled: false, config: '{"calendars":[]}' },
    { key: 'crm-sync', name: 'CRM Sync', description: 'Sync contacts, deals, and activities to HubSpot / Salesforce.', category: 'integration', version: '1.0.0', enabled: false, config: '{"provider":"hubspot"}' },
    { key: 'browser-agent', name: 'Browser Agent', description: 'Drive a headless browser to fill forms, scrape, and interact with sites.', category: 'automation', version: '2.1.0', enabled: true, config: '{"headless":true,"blockAds":true}' },
  ];
  for (const p of plugins) {
    await db.plugin.upsert({
      where: { key: p.key },
      update: { name: p.name, description: p.description, category: p.category, version: p.version, enabled: p.enabled, config: p.config },
      create: { ...p },
    });
  }
  const count = await db.plugin.count();
  console.log(`  ✓ ${count} plugins in db.plugin`);
}

async function seedModels() {
  console.log('→ Seeding 20 models across 5 providers…');
  const models = [
    // zai (4)
    { providerKey: 'zai', modelId: 'glm-4.6', contextWindow: 128000, capabilities: '["tool-use","json-mode","vision"]', tier: 'strong', enabled: true },
    { providerKey: 'zai', modelId: 'glm-4.5-air', contextWindow: 128000, capabilities: '["tool-use","json-mode"]', tier: 'fast', enabled: true },
    { providerKey: 'zai', modelId: 'glm-4v-flash', contextWindow: 32000, capabilities: '["vision"]', tier: 'vision', enabled: true },
    { providerKey: 'zai', modelId: 'glm-4-air', contextWindow: 8000, capabilities: '[]', tier: 'local', enabled: false },
    // groq (4)
    { providerKey: 'groq', modelId: 'llama-3.3-70b-versatile', contextWindow: 128000, capabilities: '["tool-use","json-mode"]', tier: 'fast', enabled: true },
    { providerKey: 'groq', modelId: 'llama-3.1-8b-instant', contextWindow: 8000, capabilities: '["tool-use"]', tier: 'fast', enabled: true },
    { providerKey: 'groq', modelId: 'mixtral-8x7b-32768', contextWindow: 32768, capabilities: '[]', tier: 'fast', enabled: false },
    { providerKey: 'groq', modelId: 'gemma2-9b-it', contextWindow: 8000, capabilities: '[]', tier: 'local', enabled: false },
    // openai (4)
    { providerKey: 'openai', modelId: 'gpt-4o', contextWindow: 128000, capabilities: '["tool-use","json-mode","vision"]', tier: 'strong', enabled: true },
    { providerKey: 'openai', modelId: 'gpt-4o-mini', contextWindow: 128000, capabilities: '["tool-use","json-mode","vision"]', tier: 'fast', enabled: true },
    { providerKey: 'openai', modelId: 'o1-preview', contextWindow: 128000, capabilities: '["reasoning"]', tier: 'giant', enabled: true },
    { providerKey: 'openai', modelId: 'o1-mini', contextWindow: 64000, capabilities: '["reasoning"]', tier: 'giant', enabled: false },
    // anthropic (4)
    { providerKey: 'anthropic', modelId: 'claude-3.5-sonnet', contextWindow: 200000, capabilities: '["tool-use","vision"]', tier: 'strong', enabled: true },
    { providerKey: 'anthropic', modelId: 'claude-3.5-haiku', contextWindow: 200000, capabilities: '["tool-use","vision"]', tier: 'fast', enabled: true },
    { providerKey: 'anthropic', modelId: 'claude-3-opus', contextWindow: 200000, capabilities: '["tool-use","vision"]', tier: 'giant', enabled: false },
    { providerKey: 'anthropic', modelId: 'claude-3-sonnet', contextWindow: 200000, capabilities: '["tool-use","vision"]', tier: 'strong', enabled: false },
    // google (4)
    { providerKey: 'google', modelId: 'gemini-1.5-pro', contextWindow: 2000000, capabilities: '["tool-use","json-mode","vision"]', tier: 'giant', enabled: true },
    { providerKey: 'google', modelId: 'gemini-1.5-flash', contextWindow: 1000000, capabilities: '["tool-use","json-mode","vision"]', tier: 'fast', enabled: true },
    { providerKey: 'google', modelId: 'gemini-1.5-flash-8b', contextWindow: 1000000, capabilities: '["vision"]', tier: 'fast', enabled: true },
    { providerKey: 'google', modelId: 'gemma-7b-it', contextWindow: 8000, capabilities: '[]', tier: 'local', enabled: false },
  ];
  for (const m of models) {
    // Model has no unique key — use providerKey+modelId as a soft unique. We delete-then-create to keep idempotency.
    const existing = await db.model.findFirst({ where: { providerKey: m.providerKey, modelId: m.modelId } });
    if (existing) {
      await db.model.update({ where: { id: existing.id }, data: { contextWindow: m.contextWindow, capabilities: m.capabilities, tier: m.tier, enabled: m.enabled } });
    } else {
      await db.model.create({ data: m });
    }
  }
  const count = await db.model.count();
  console.log(`  ✓ ${count} models in db.model`);
}

async function seedSkillLearning() {
  console.log('→ Seeding sample SkillLearning records…');
  // Pick a handful of agents + skills and seed proficiency + earnings.
  const samples: Array<{ agent: string; skill: string; proficiency: number; earnings: number; from: string }> = [
    { agent: 'ORION', skill: 'planning', proficiency: 95, earnings: 1240.50, from: 'operator-teach' },
    { agent: 'ORION', skill: 'decompose', proficiency: 88, earnings: 870.00, from: 'operator-teach' },
    { agent: 'ATLAS', skill: 'code-gen', proficiency: 92, earnings: 2150.75, from: 'auto-task' },
    { agent: 'ATLAS', skill: 'code-review', proficiency: 78, earnings: 540.20, from: 'auto-task' },
    { agent: 'VEGA', skill: 'web-search', proficiency: 90, earnings: 980.40, from: 'auto-task' },
    { agent: 'VEGA', skill: 'summarize', proficiency: 85, earnings: 420.10, from: 'operator-teach' },
    { agent: 'NOVA', skill: 'data-analysis', proficiency: 88, earnings: 1320.00, from: 'auto-task' },
    { agent: 'NOVA', skill: 'charts', proficiency: 72, earnings: 280.50, from: 'operator-teach' },
    { agent: 'SAGE', skill: 'memory', proficiency: 96, earnings: 0, from: 'auto-task' },
    { agent: 'FORGE', skill: 'ci-cd', proficiency: 82, earnings: 610.30, from: 'auto-task' },
    { agent: 'ECHO', skill: 'email', proficiency: 75, earnings: 240.00, from: 'operator-teach' },
    { agent: 'PULSE', skill: 'telemetry', proficiency: 91, earnings: 0, from: 'auto-task' },
    { agent: 'DRACO', skill: 'ml-pipelines', proficiency: 80, earnings: 1500.00, from: 'auto-task' },
    { agent: 'HYDRA', skill: 'sql', proficiency: 84, earnings: 720.50, from: 'auto-task' },
    { agent: 'PHOENIX', skill: 'bi', proficiency: 76, earnings: 410.20, from: 'auto-task' },
  ];
  for (const s of samples) {
    await db.skillLearning.upsert({
      where: { agentCodename_skillKey: { agentCodename: s.agent, skillKey: s.skill } },
      update: {
        proficiency: s.proficiency,
        earnings: s.earnings,
        learnedFrom: s.from,
        lastUsed: new Date(),
      },
      create: {
        agentCodename: s.agent,
        skillKey: s.skill,
        proficiency: s.proficiency,
        earnings: s.earnings,
        learnedFrom: s.from,
        lastUsed: new Date(),
      },
    });
  }
  const count = await db.skillLearning.count();
  console.log(`  ✓ ${count} learning records in db.skillLearning`);
}

async function main() {
  console.log('=== R-3 seed-agents.ts ===');
  await seedAgents();
  await seedDepartments();
  await seedWorkforceAgents();
  await seedRules();
  await seedPlugins();
  await seedModels();
  await seedSkillLearning();
  console.log('=== Done ===');
}

/**
 * Public entry point — callable from the in-app Demo Data panel
 * (`/api/admin/data` POST `script: 'agents'`). Runs the same seed work as
 * the CLI invocation below. Idempotent — safe to re-run.
 *
 * Scope: 64 agents + 16 departments + 25 workforce agents. Does NOT seed
 * rules/plugins/models/skill-learning (those have their own dedicated seed
 * buttons in the Demo Data panel).
 */
export async function seedAgentsRoster() {
  await seedAgents();
  await seedDepartments();
  await seedWorkforceAgents();
}

/**
 * Public entry point — callable from the in-app Demo Data panel
 * (`/api/admin/data` POST `script: 'learning'`). Seeds 15 SkillLearning
 * records (agent × skill proficiency + earnings). Idempotent — safe to
 * re-run (existing records are upserted).
 */
export async function seedLearning() {
  await seedSkillLearning();
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error('Seed failed:', e);
      process.exit(1);
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
