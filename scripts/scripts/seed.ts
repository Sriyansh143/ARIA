// Seed script: populate providers, models, agents, skills, AND memories.
import { db } from '../src/lib/db'
import { PROVIDER_SEEDS, AGENT_SEEDS, SKILL_SEEDS } from '../src/lib/catalog'

const SEED_MEMORIES = [
  { key: 'user_system', value: 'User is on Windows 11 with 24GB RAM (16+8 sticks) and 60GB D: drive. PowerShell is the primary shell. Ollama is installed with 30+ local models.', scope: 'global', tags: ['system', 'hardware'] },
  { key: 'user_preferences', value: 'User prefers PowerShell scripts for automation. Wants 24/7 autonomous operation. Prefers free/open-source tools. Uses Telegram for remote control.', scope: 'global', tags: ['preferences'] },
  { key: 'ollama_models', value: 'Available Ollama models: llama3.1:8b (general), qwen2.5-coder:7b (code), mistral:latest (Hermes-tuned), llava:latest (vision), qwen2.5vl:3b (vision lite), nomic-embed-text (embeddings), llama3.2:3b (fast planner), deepseek-coder (code), gemma3:4b, phi3:mini, deepseek-r1:1.5b (reasoning).', scope: 'global', tags: ['ollama', 'models'] },
  { key: 'cloud_models', value: 'Cloud bridges: glm-4.6 (Z.ai), qwen3-vl:235b (vision), qwen3-coder:480b (code), deepseek-v3.1:671b (reasoning). Free tiers: NVIDIA NIM, Z.ai GLM-4.5-Flash, Qwen-Turbo, Groq.', scope: 'global', tags: ['cloud', 'models'] },
  { key: 'fallback_strategy', value: 'Smart router auto-falls-back on rate-limit (429), 5xx, network, timeout. Auth errors throw immediately. Max 4 fallbacks per request.', scope: 'global', tags: ['routing'] },
  { key: 'security_policy', value: 'NEVER store personal passwords. Create dedicated service accounts. Enable 2FA. Vault encrypts with AES-256-GCM + scrypt(machine fingerprint).', scope: 'global', tags: ['security'] },
  { key: 'autopilot_pattern', value: 'Manager decomposes prompt into 2-5 parallel sub-tasks. Researcher/Coder/Reviewer/Writer/Tester work concurrently. Manager monitors every 3s and assembles final result. 3x faster than sequential.', scope: 'global', tags: ['autopilot'] },
  { key: 'telegram_commands', value: 'Telegram: /ask (smart-route), /do (dispatch), /status (agents), /models, /spawn, /kill, /screen, /pending, /approve, /reject, /help. Free text = smart-routed chat.', scope: 'global', tags: ['telegram'] },
  { key: 'browser_login', value: 'Browser-login supports 7 playgrounds: z.ai, Qwen Chat, ChatGPT, HuggingChat, Groq, MiniMax, ChatGLM. Sessions saved via Playwright persistent profiles.', scope: 'global', tags: ['browser'] },
  { key: 'system_monitor', value: 'System monitor tracks CPU%, RAM (24GB 16+8), Disk (C: + D: 60GB), GPU (nvidia-smi), uptime. Updates every 2s via Socket.io port 3009.', scope: 'global', tags: ['system'] },
  { key: 'agent_roles', value: 'Autopilot roles: Manager (decompose+monitor+assemble), Researcher (info), Coder (code), Reviewer (quality 1-10), Writer (docs), Tester (tests).', scope: 'global', tags: ['agents'] },
  { key: 'keyboard_shortcuts', value: 'Ctrl+K = Command Palette, F1 = Help, ESC = Close, Enter = Select, Ctrl+Enter = Launch Autopilot.', scope: 'global', tags: ['ui'] },
  { key: 'plugin_catalog', value: '20 plugins: web-scraper, pdf-reader, excel-writer, image-resizer, email-sender, slack-notifier, discord-bot, git-automation, docker-manager, sql-query, api-tester, weather-fetch, stock-tracker, youtube-downloader, translation, qr-generator, ocr-extractor, screenshot-taker, calendar-sync, rss-monitor.', scope: 'global', tags: ['plugins'] },
  { key: 'vector_memory', value: 'Semantic memory uses nomic-embed-text (768-dim) via Ollama. Cosine similarity. Falls back to keyword search when offline. Persists to vector-store.json.', scope: 'global', tags: ['memory'] },
  { key: 'workflow_pattern', value: 'Workflows are reusable multi-step templates. Each step has label + prompt. Execute on-demand or schedule. Stored in DB.', scope: 'global', tags: ['workflow'] },
]

async function main() {
  console.log('Seeding providers + models...')
  for (const p of PROVIDER_SEEDS) {
    const provider = await db.provider.upsert({
      where: { name: p.name },
      create: { name: p.name, kind: p.kind, baseUrl: p.baseUrl, apiKey: p.apiKey, enabled: p.enabled, models: JSON.stringify(p.models) },
      update: { kind: p.kind, baseUrl: p.baseUrl, enabled: p.enabled, models: JSON.stringify(p.models) },
    })
    console.log(`  + provider ${provider.name} (${p.models.length} models)`)
  }

  console.log('Seeding agents...')
  for (const a of AGENT_SEEDS) {
    // Merge legacy fields (repoUrl, installCmd) with CrewAI role triple + per-agent limits (Phase 8A+8D)
    const config = JSON.stringify({
      repoUrl: a.repoUrl,
      installCmd: a.installCmd,
      role: a.config.role,
      goal: a.config.goal,
      backstory: a.config.backstory,
      maxIter: a.config.maxIter,
      maxRpm: a.config.maxRpm,
      maxExecutionTime: a.config.maxExecutionTime,
    })
    const agent = await db.agent.upsert({
      where: { name: a.name },
      create: { name: a.name, kind: a.kind, description: a.description, model: a.recommendedModel, skills: JSON.stringify(a.skills), config, status: 'idle' },
      update: { kind: a.kind, description: a.description, model: a.recommendedModel, skills: JSON.stringify(a.skills), config },
    })
    console.log(`  + agent ${agent.name} (${agent.kind}) role=${a.config.role}`)
  }

  console.log('Seeding skills (ALL ENABLED)...')
  for (const s of SKILL_SEEDS) {
    const skill = await db.skill.upsert({
      where: { name: s.name },
      create: { name: s.name, description: s.description, category: s.category, enabled: true, installed: true },
      update: { description: s.description, category: s.category, enabled: true, installed: true },
    })
    console.log(`  + skill ${skill.name} (ENABLED)`)
  }

  console.log('Seeding memories (pre-built intelligence)...')
  for (const m of SEED_MEMORIES) {
    const existing = await db.memoryItem.findFirst({ where: { key: m.key } })
    if (!existing) {
      await db.memoryItem.create({ data: { key: m.key, value: m.value, scope: m.scope, tags: JSON.stringify(m.tags) } })
      console.log(`  + memory ${m.key}`)
    } else {
      console.log(`  = memory ${m.key} (exists)`)
    }
  }

  console.log('Done. JARVIS is ready with full intelligence.')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await db.$disconnect() })
