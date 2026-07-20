// intelligence-seed.ts — Seeds the full Claude-level intelligence layer:
// memories, workforce agents, departments, workflows, and skill knowledge.
// Run with: bun run scripts/intelligence-seed.ts
import { db } from '../src/lib/db'

// ─── Day-1 Intelligence Memories ─────────────────────────────────────────
const INTELLIGENCE_MEMORIES = [
  // Reasoning patterns
  { key: 'cot_pattern', value: 'Chain-of-Thought: Break complex problems into steps. Phase 1: Think step by step. Phase 2: Provide final answer. Use temperature 0.3 for reasoning, 0.5 for answers.', scope: 'intelligence', tags: ['reasoning', 'cot'] },
  { key: 'constitutional_ai', value: 'Constitutional AI: Draft response → Critique against principles (helpful, harmless, honest) → Revise. Principles: 1) Be accurate 2) Refuse harmful requests 3) Be concise 4) Cite sources 5) Acknowledge uncertainty.', scope: 'intelligence', tags: ['reasoning', 'safety'] },
  { key: 'react_pattern', value: 'ReAct: THOUGHT → ACTION → OBSERVATION loop. Max 5 iterations. At each step, reason about what to do, take an action (tool call), observe the result, then continue until the task is done.', scope: 'intelligence', tags: ['reasoning', 'tools'] },
  { key: 'tree_of_thoughts', value: 'Tree of Thoughts: Generate N parallel candidate approaches, score each (0-10) on correctness/clarity/completeness, pick the best, refine. Use branching factor 3-5.', scope: 'intelligence', tags: ['reasoning', 'tot'] },
  { key: 'step_back_prompting', value: 'Step-Back: Before answering, derive the governing principle or concept behind the question. Then apply that principle to give a more principled answer.', scope: 'intelligence', tags: ['reasoning', 'stepback'] },
  { key: 'self_reflection', value: 'Self-Reflection: After generating an answer, ask the model to critique its own response. Verdict: KEEP (good) or REVISE (needs work). If REVISE, generate an improved version.', scope: 'intelligence', tags: ['reasoning', 'reflection'] },

  // Model routing intelligence
  { key: 'model_routing', value: 'Smart routing: greeting→groq:llama-3.3-70b (fast), code→groq:qwen-2.5-coder-32b, reasoning→deepseek-r1, vision→llava/qwen3-vl, tool-use→llama3.1:8b, chat→glm-4.6. Fallback chain: local Ollama → cloud bridges → ZAI SDK (GLM-4.6).', scope: 'intelligence', tags: ['routing', 'models'] },
  { key: 'fallback_strategy', value: 'Fallback chain: 1) Try preferred model. 2) On 429/5xx/timeout, try next in chain. 3) Auth errors throw immediately. 4) Max 4 fallbacks per request. 5) Final fallback: ZAI SDK (GLM-4.6) — always available, zero-config.', scope: 'intelligence', tags: ['routing', 'fallback'] },

  // Skill knowledge
  { key: 'skill_catalog', value: '65 skills available: web-search, web-reader, LLM, VLM, image-generation, TTS, ASR, video-generation, video-understand, charts, docx, xlsx, pdf, pptx, coding-agent, blog-writer, content-strategy, design, ui-ux-pro-max, and more. Each skill has a SKILL.md with usage instructions.', scope: 'intelligence', tags: ['skills', 'catalog'] },
  { key: 'skill_execution', value: 'Skills are invoked via the z-ai-web-dev-sdk CLI or backend SDK. Each skill exposes functions via zai.functions.invoke() or zai.chat.completions.create(). Skills auto-discover from /skills directory via skill-auto-loader.', scope: 'intelligence', tags: ['skills', 'execution'] },

  // Agent orchestration
  { key: 'autopilot_pattern', value: 'Autopilot: Manager decomposes prompt into 2-5 parallel sub-tasks. Researcher/Coder/Reviewer/Writer/Tester work concurrently. Manager monitors every 3s and assembles final result. 3x faster than sequential.', scope: 'intelligence', tags: ['orchestration', 'autopilot'] },
  { key: 'agent_roles', value: 'Agent roles: Manager (decompose+monitor+assemble), Researcher (info gathering), Coder (code gen), Reviewer (quality 1-10), Writer (docs), Tester (test gen), Architect (design), DevOps (deploy).', scope: 'intelligence', tags: ['orchestration', 'roles'] },
  { key: 'workforce_departments', value: 'Departments: Engineering (code-architect, frontend-dev, backend-dev, devops), Business (ceo, cfo, account-executive, billing-specialist), Research (data-scientist, ml-engineer, analyst), Content (writer, editor, seo-specialist).', scope: 'intelligence', tags: ['workforce', 'departments'] },

  // Security & guardrails
  { key: 'guardrails', value: 'Input guardrails: Block PII (SSN, credit cards, emails in logs), secrets (API keys, tokens), unsafe patterns (prompt injection, jailbreak attempts). Output guardrails: No harmful content, no PII leakage, no code execution without consent.', scope: 'intelligence', tags: ['security', 'guardrails'] },
  { key: 'security_policy', value: 'NEVER store personal passwords. Create dedicated service accounts. Enable 2FA. Vault encrypts with AES-256-GCM + scrypt(machine fingerprint). Rate limit: 100 req/min per user. Audit log all sensitive operations.', scope: 'intelligence', tags: ['security', 'policy'] },

  // Memory architecture
  { key: 'memory_architecture', value: 'Memory types: Episodic (event-based, time-stamped), Semantic (facts/knowledge, key-value), Working (current task context, short-lived), Conversation (chat history, summarized). Vector memory uses nomic-embed-text (768-dim) via Ollama for semantic search.', scope: 'intelligence', tags: ['memory', 'architecture'] },
  { key: 'memory_consolidation', value: 'Memory consolidation: Every 3 hours, episodic memories older than 24h are summarized into semantic memories. Conversation summaries are extracted every 10 messages. Working memory is cleared on task completion.', scope: 'intelligence', tags: ['memory', 'consolidation'] },

  // Plugin ecosystem
  { key: 'plugin_catalog', value: '20 plugins: web-scraper, pdf-reader, excel-writer, image-resizer, email-sender, slack-notifier, discord-bot, git-automation, docker-manager, sql-query, api-tester, weather-fetch, stock-tracker, youtube-downloader, translation, qr-generator, ocr-extractor, screenshot-taker, calendar-sync, rss-monitor.', scope: 'intelligence', tags: ['plugins', 'catalog'] },

  // Workflow patterns
  { key: 'workflow_patterns', value: 'Workflows: Multi-step reusable templates. Each step has label + prompt. Execute on-demand or schedule via cron. Examples: 1) Research→Draft→Review→Publish 2) Scrape→Analyze→Report 3) Code→Test→Deploy 4) Monitor→Alert→Self-heal.', scope: 'intelligence', tags: ['workflows', 'patterns'] },
  { key: 'cron_jobs', value: 'Scheduled jobs: self-audit (15min), session-cleanup (1hr), task-reaper (30min), self-improve (daily 2am), memory-consolidation (daily 3am), telemetry-rollup (5min), webDevReview (15min).', scope: 'intelligence', tags: ['cron', 'scheduling'] },

  // Claude-level pipeline
  { key: 'claude_pipeline', value: 'Claude-level pipeline: 1) Input guardrails 2) Step-back prompting (derive principle) 3) Chain-of-thought (reason step by step) 4) Self-reflection (critique own answer) 5) Output guardrails. Each stage degrades gracefully on failure.', scope: 'intelligence', tags: ['pipeline', 'claude-level'] },
  { key: 'confidence_scoring', value: 'Confidence scoring: After generating an answer, score 0-100 on: supported-claims (40%), clarity (20%), completeness (20%), no-hedging (10%), no-contradictions (10%). Below 60 triggers self-reflection revision.', scope: 'intelligence', tags: ['pipeline', 'confidence'] },
]

// ─── Workforce Departments ────────────────────────────────────────────────
const DEPARTMENTS = [
  { key: 'engineering', name: 'Engineering', description: 'Software development, architecture, and DevOps' },
  { key: 'business', name: 'Business', description: 'Strategy, finance, sales, and operations' },
  { key: 'data', name: 'Research', description: 'Data science, ML, and analysis' },
  { key: 'product', name: 'Content', description: 'Writing, editing, and SEO' },
  { key: 'operations', name: 'Security', description: 'Audit, compliance, and guardrails' },
]

// ─── Workforce Agents (beyond the 74 already seeded) ─────────────────────
const WORKFORCE_AGENTS = [
  { name: 'Claude-Reasoner', role: 'reasoning-engine', title: 'Claude-Level Reasoning Engine', department: 'Research', seniority: 'lead' },
  { name: 'Pipeline-Orchestrator', role: 'pipeline-manager', title: 'Intelligence Pipeline Manager', department: 'Engineering', seniority: 'senior' },
  { name: 'Memory-Curator', role: 'memory-manager', title: 'Memory & Knowledge Curator', department: 'Research', seniority: 'senior' },
  { name: 'Guardrail-Sentinel', role: 'safety-officer', title: 'Safety & Guardrails Officer', department: 'Security', seniority: 'lead' },
  { name: 'Skill-Dispatcher', role: 'skill-router', title: 'Skill Routing & Dispatch Agent', department: 'Engineering', seniority: 'mid' },
]

async function main() {
  console.log('[intelligence-seed] Seeding Claude-level intelligence layer...')

  // 1. Memories
  console.log('[intelligence-seed] Seeding intelligence memories...')
  for (const m of INTELLIGENCE_MEMORIES) {
    await db.memoryItem.upsert({
      where: { scope_key: { scope: m.scope, key: m.key } },
      update: { value: m.value, tags: JSON.stringify(m.tags) },
      create: { ...m, tags: JSON.stringify(m.tags) },
    })
  }
  console.log(`[intelligence-seed] ${INTELLIGENCE_MEMORIES.length} intelligence memories seeded`)

  // 2. Departments
  console.log('[intelligence-seed] Seeding workforce departments...')
  for (const d of DEPARTMENTS) {
    const existing = await db.department.findFirst({ where: { key: d.key } })
    if (!existing) {
      await db.department.create({ data: { key: d.key, name: d.name, description: d.description } })
    }
  }
  console.log(`[intelligence-seed] ${DEPARTMENTS.length} departments seeded`)

  // 3. Workforce agents
  console.log('[intelligence-seed] Seeding workforce agents...')
  for (const a of WORKFORCE_AGENTS) {
    const dept = await db.department.findFirst({ where: { name: a.department } })
    // fallback: find by matching name to DEPARTMENTS array
    const deptKey = DEPARTMENTS.find(d => d.name === a.department)?.key
    const deptFinal = dept || (deptKey ? await db.department.findFirst({ where: { key: deptKey } }) : null)
    const existing = await db.workforceAgent.findFirst({ where: { name: a.name } })
    if (!existing) {
      await db.workforceAgent.create({
        data: {
          name: a.name,
          role: a.role,
          title: a.title,
          departmentId: deptFinal?.id,
          seniority: a.seniority,
        },
      })
    }
  }
  console.log(`[intelligence-seed] ${WORKFORCE_AGENTS.length} workforce agents seeded`)

  // 4. Ensure all skills are enabled
  console.log('[intelligence-seed] Enabling all skills...')
  const skillResult = await db.skill.updateMany({ where: { enabled: false }, data: { enabled: true } })
  console.log(`[intelligence-seed] Enabled ${skillResult.count} skills`)

  // 5. Ensure all providers are enabled
  console.log('[intelligence-seed] Enabling all providers...')
  const provResult = await db.provider.updateMany({ where: { enabled: false }, data: { enabled: true } })
  console.log(`[intelligence-seed] Enabled ${provResult.count} providers`)

  // 6. Summary
  const stats = {
    memories: await db.memoryItem.count(),
    skills: await db.skill.count(),
    skillsEnabled: await db.skill.count({ where: { enabled: true } }),
    providers: await db.provider.count(),
    providersEnabled: await db.provider.count({ where: { enabled: true } }),
    agents: await db.agent.count(),
    workforceAgents: await db.workforceAgent.count(),
    departments: await db.department.count(),
  }
  console.log('[intelligence-seed] Summary:', stats)
  console.log('[intelligence-seed] Done. JARVIS is now Claude-level intelligent from day 1.')
}

main()
  .catch((e) => { console.error('[intelligence-seed] error:', e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
