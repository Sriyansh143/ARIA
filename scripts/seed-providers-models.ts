// ─────────────────────────────────────────────────────────────────────────────
// scripts/seed-providers-models.ts — C-1 catalog seed.
//
// Idempotently upserts all providers from PROVIDER_SEEDS (23 entries) and all
// models from MODEL_CATALOG (446 entries) into the Prisma DB. Safe to re-run:
// existing rows are updated in place; new rows are created; nothing is deleted.
//
// Provider schema (from prisma/schema.prisma):
//   key, name, model, enabled, latency, tokens, createdAt, updatedAt
//
// Model schema:
//   providerKey, modelId, contextWindow, capabilities (JSON), tier, enabled
//
// Run:  cd /home/z/my-project && bunx tsx scripts/seed-providers-models.ts
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '../src/lib/db'
import {
  PROVIDER_SEEDS,
  MODEL_CATALOG,
  type ModelTier,
  type ModelCapability,
} from '../src/lib/catalog'

// ─── Pretty display name for each provider key ───────────────────────────────
// PROVIDER_SEEDS uses `name` as the key (e.g. 'nvidia-nim'); the DB Provider.name
// column should hold a human-readable label.
const PROVIDER_LABELS: Record<string, string> = {
  ollama: 'Ollama (Local)',
  'ollama-cloud': 'Ollama Cloud Bridge',
  'nvidia-nim': 'NVIDIA NIM',
  zai: 'Z.ai',
  'qwen-playground': 'Qwen Playground (Alibaba)',
  siliconflow: 'SiliconFlow',
  'browser-login': 'Browser-Login Playgrounds',
  'github-models': 'GitHub Models',
  huggingface: 'Hugging Face',
  higgsfield: 'Higgsfield',
  groq: 'Groq',
  openai: 'OpenAI',
  bytez: 'Bytez',
  omniroute: 'OmniRoute',
  anthropic: 'Anthropic',
  google: 'Google AI',
  together: 'Together AI',
  fireworks: 'Fireworks AI',
  mistral: 'Mistral AI',
  cohere: 'Cohere',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
  local: 'Local (on-device)',
}

// ─── Default model per provider (the one a fresh agent gets assigned) ─────────
const DEFAULT_MODEL_PER_PROVIDER: Record<string, string> = {
  ollama: 'llama3.1:8b',
  'ollama-cloud': 'glm-4.6:cloud',
  'nvidia-nim': 'meta/llama-3.3-70b-instruct',
  zai: 'glm-4.6',
  'qwen-playground': 'qwen-max',
  siliconflow: 'Qwen/Qwen2.5-72B-Instruct',
  'browser-login': 'browser:openai',
  'github-models': 'gpt-4o',
  huggingface: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
  higgsfield: 'higgsfield-default',
  groq: 'llama-3.3-70b-versatile',
  openai: 'gpt-4o',
  bytez: 'gpt-4o',
  omniroute: 'openai/gpt-4o',
  anthropic: 'claude-3-5-sonnet-20241022',
  google: 'gemini-1.5-pro',
  together: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  fireworks: 'accounts/fireworks/models/llama-v3p1-405b-instruct',
  mistral: 'mistral-large-latest',
  cohere: 'command-r-plus',
  openrouter: 'anthropic/claude-3.5-sonnet',
  deepseek: 'deepseek-chat',
  local: 'local:stub-chat',
}

// ─── Tier inference — if a model doesn't declare a tier, derive one ──────────
function inferTier(caps: ModelCapability[]): ModelTier {
  if (caps.includes('vision')) return 'vision'
  if (caps.includes('reasoning')) return 'reasoning'
  if (caps.includes('embedding')) return 'fast'
  if (caps.includes('code')) return 'strong'
  return 'fast'
}

async function main() {
  const t0 = Date.now()
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  C-1 catalog seed — providers + models')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`  source: PROVIDER_SEEDS=${PROVIDER_SEEDS.length}  MODEL_CATALOG=${MODEL_CATALOG.length}`)
  console.log()

  // ─── 1. Upsert providers ──────────────────────────────────────────────────
  console.log('▶ Seeding providers…')
  let provCreated = 0
  let provUpdated = 0
  for (const p of PROVIDER_SEEDS) {
    const label = PROVIDER_LABELS[p.name] ?? p.name
    const defaultModel = DEFAULT_MODEL_PER_PROVIDER[p.name] ?? (p.models[0]?.modelId ?? 'unknown')
    const before = await db.provider.findUnique({ where: { key: p.name } })
    await db.provider.upsert({
      where: { key: p.name },
      update: {
        name: label,
        model: defaultModel,
        enabled: p.enabled,
      },
      create: {
        key: p.name,
        name: label,
        model: defaultModel,
        enabled: p.enabled,
        latency: 0,
        tokens: 0,
      },
    })
    if (before) provUpdated++
    else provCreated++
  }
  console.log(`    ✓ created ${provCreated}, updated ${provUpdated}`)

  // ─── 2. Upsert models ─────────────────────────────────────────────────────
  console.log('▶ Seeding models…')
  // The Model table has no unique constraint on (providerKey, modelId), so we
  // can't rely on a simple upsert. Instead we fetch existing (providerKey,
  // modelId) pairs and skip-insert if already present; otherwise create.
  const existing = await db.model.findMany({
    where: { providerKey: { in: PROVIDER_SEEDS.map((p) => p.name) } },
    select: { providerKey: true, modelId: true },
  })
  const existingSet = new Set(existing.map((m) => `${m.providerKey}::${m.modelId}`))
  console.log(`    existing models for these providers: ${existing.length}`)

  let modCreated = 0
  let modSkipped = 0
  // Track tiers for the summary.
  const tierCounts: Record<string, number> = { strong: 0, fast: 0, vision: 0, reasoning: 0, local: 0 }
  const provModelCounts: Record<string, number> = {}

  // Build create payloads in memory first — cheaper than one DB round-trip per row.
  const toCreate: Array<{
    providerKey: string
    modelId: string
    contextWindow: number
    capabilities: string
    tier: string
    enabled: boolean
  }> = []
  for (const m of MODEL_CATALOG) {
    const key = `${m.providerKey}::${m.modelId}`
    if (existingSet.has(key)) {
      modSkipped++
      // Still update tier/caps/enabled for the existing row so the DB reflects
      // the latest catalog (without losing the auto-incremented id).
      const tier = m.tier ?? inferTier(m.capabilities)
      tierCounts[tier] = (tierCounts[tier] ?? 0) + 1
      provModelCounts[m.providerKey] = (provModelCounts[m.providerKey] ?? 0) + 1
      await db.model.updateMany({
        where: { providerKey: m.providerKey, modelId: m.modelId },
        data: {
          contextWindow: m.contextLen ?? 128000,
          capabilities: JSON.stringify(m.capabilities),
          tier,
          enabled: m.enabled,
        },
      })
      continue
    }
    const tier = m.tier ?? inferTier(m.capabilities)
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1
    provModelCounts[m.providerKey] = (provModelCounts[m.providerKey] ?? 0) + 1
    toCreate.push({
      providerKey: m.providerKey,
      modelId: m.modelId,
      contextWindow: m.contextLen ?? 128000,
      capabilities: JSON.stringify(m.capabilities),
      tier,
      enabled: m.enabled,
    })
  }

  // createMany is the fastest path for SQLite. MODEL_CATALOG has 0 internal
  // duplicate (providerKey, modelId) pairs (verified at catalog-build time),
  // so we don't need skipDuplicates — and SQLite + Prisma doesn't support it.
  // Batches of 100 keep the SQL statement well under SQLite's parameter limit.
  const BATCH = 100
  for (let i = 0; i < toCreate.length; i += BATCH) {
    const slice = toCreate.slice(i, i + BATCH)
    const res = await db.model.createMany({ data: slice })
    modCreated += res.count
  }
  console.log(`    ✓ created ${modCreated}, updated ${modSkipped} (already present)`)

  // ─── 3. Summary ───────────────────────────────────────────────────────────
  const finalProv = await db.provider.count()
  const finalMod = await db.model.count()
  console.log()
  console.log('───────────────────────────────────────────────────────────────')
  console.log('  SEED COMPLETE')
  console.log('───────────────────────────────────────────────────────────────')
  console.log(`  providers in DB:     ${finalProv}`)
  console.log(`  models in DB:        ${finalMod}`)
  console.log(`  models by tier:      ${JSON.stringify(tierCounts)}`)
  console.log(`  elapsed:             ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log()
  console.log('  models per provider:')
  for (const p of PROVIDER_SEEDS) {
    const c = provModelCounts[p.name] ?? 0
    console.log(`    ${p.name.padEnd(20)} ${c}`)
  }
  console.log('───────────────────────────────────────────────────────────────')
}

/**
 * Public entry point — callable from the in-app Demo Data panel
 * (`/api/admin/data` POST `script: 'providers-models'`). Idempotent —
 * safe to re-run. Does NOT call `db.$disconnect()` (the API route owns
 * the singleton Prisma client lifecycle).
 */
export async function seedProvidersModels() {
  await main()
}

if (require.main === module) {
  main().catch(async (e) => {
    console.error('Seed failed:', e)
    await db.$disconnect()
    process.exit(1)
  }).finally(async () => {
    await db.$disconnect()
  })
}
