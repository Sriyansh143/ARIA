// Idempotent seed script for the 4 default chat presets (Phase 9B).
// Run with: `bun run scripts/seed-presets.ts`
//
// Presets are stored as MemoryItem rows with scope='preset' and a JSON value
// containing the full ChatPreset payload. We dedupe on `key='preset:<name>'`
// so re-running this script won't create duplicates.
import { db } from '../src/lib/db'

interface ChatPreset {
  name: string
  description?: string
  model?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  icon?: string
}

const DEFAULT_PRESETS: ChatPreset[] = [
  {
    name: 'Code Reviewer',
    description: 'Static analysis — bugs, security, improvements.',
    model: 'qwen2.5-coder:7b',
    systemPrompt:
      'You are an expert code reviewer. Analyze the code for bugs, security issues, and improvements. Be specific.',
    temperature: 0.2,
    icon: '🧑‍💻',
  },
  {
    name: 'Creative Writer',
    description: 'Stories, poems, imaginative content.',
    model: 'mistral',
    systemPrompt:
      'You are a creative writing assistant. Help with stories, poems, and creative content. Be imaginative.',
    temperature: 0.9,
    icon: '✍️',
  },
  {
    name: 'Data Analyst',
    description: 'Data interpretation, visualizations, stats.',
    model: 'qwen2.5:7b',
    systemPrompt:
      'You are a data analyst. Help interpret data, suggest visualizations, and explain statistical concepts clearly.',
    temperature: 0.3,
    icon: '📊',
  },
  {
    name: 'Quick Helper',
    description: 'Concise, accurate answers.',
    model: 'llama3.1:8b',
    systemPrompt: 'You are a helpful assistant. Give concise, accurate answers.',
    temperature: 0.5,
    icon: '⚡',
  },
]

async function main() {
  console.log('Seeding chat presets (scope=preset)...')

  // Idempotency: if any preset rows already exist, don't re-seed the defaults.
  const existing = await db.memoryItem.findMany({
    where: { scope: 'preset' },
    select: { key: true },
  })
  const existingKeys = new Set(existing.map((r) => r.key))

  let added = 0
  for (const preset of DEFAULT_PRESETS) {
    const key = `preset:${preset.name}`
    if (existingKeys.has(key)) {
      console.log(`  = preset ${preset.name} (exists)`)
      continue
    }
    await db.memoryItem.create({
      data: {
        scope: 'preset',
        key,
        value: JSON.stringify(preset),
        tags: JSON.stringify(['preset']),
      },
    })
    console.log(`  + preset ${preset.name} (model=${preset.model})`)
    added++
  }

  console.log(`Done. Seeded ${added} new preset(s); ${existingKeys.size} already existed.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
