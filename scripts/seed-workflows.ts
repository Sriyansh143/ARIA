// Pre-seed basic reusable workflows for common JARVIS tasks.
// Run: npx tsx scripts/seed-workflows.ts

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const BASIC_WORKFLOWS = [
  {
    name: 'Analyze App',
    description: 'analyze app review code check architecture',
    siteUrl: 'http://localhost:3000',
    actions: JSON.stringify([
      { type: 'navigate', url: 'http://localhost:3000', description: 'Open JARVIS dashboard' },
      { type: 'screenshot', description: 'Capture dashboard state' },
      { type: 'wait', ms: 2000, description: 'Wait for page load' },
      { type: 'screenshot', description: 'Capture final state' },
    ]),
  },
  {
    name: 'Test App',
    description: 'test app run tests check features verify',
    siteUrl: 'http://localhost:3000',
    actions: JSON.stringify([
      { type: 'navigate', url: 'http://localhost:3000/api/health/aggregate', description: 'Check service health' },
      { type: 'wait', ms: 1000, description: 'Wait for response' },
      { type: 'navigate', url: 'http://localhost:3000/api/telemetry', description: 'Check telemetry' },
      { type: 'wait', ms: 1000, description: 'Wait for response' },
    ]),
  },
  {
    name: 'Improve App',
    description: 'improve app optimize performance fix bugs enhance',
    siteUrl: 'http://localhost:3000',
    actions: JSON.stringify([
      { type: 'navigate', url: 'http://localhost:3000/api/self-improve', description: 'Run self-improvement analysis' },
      { type: 'wait', ms: 5000, description: 'Wait for analysis' },
      { type: 'navigate', url: 'http://localhost:3000/api/auto-tune', description: 'Run auto-tune suggestions' },
    ]),
  },
  {
    name: 'Generate Image',
    description: 'generate image draw picture photo create artwork',
    siteUrl: 'http://localhost:3000',
    actions: JSON.stringify([
      { type: 'navigate', url: 'http://localhost:3000/api/generate-image', description: 'Generate image via API' },
    ]),
  },
  {
    name: 'Generate Song',
    description: 'generate song sing music compose melody track',
    siteUrl: 'http://localhost:3000',
    actions: JSON.stringify([
      { type: 'navigate', url: 'http://localhost:3000/api/generate-audio', description: 'Generate audio via API' },
    ]),
  },
  {
    name: 'Generate Video',
    description: 'generate video create clip animation render',
    siteUrl: 'http://localhost:3000',
    actions: JSON.stringify([
      { type: 'navigate', url: 'http://localhost:3000/api/siliconflow/video', description: 'Generate video via SiliconFlow' },
    ]),
  },
  {
    name: 'Post to LinkedIn',
    description: 'post linkedin share update social media',
    siteUrl: 'https://linkedin.com',
    actions: JSON.stringify([
      { type: 'navigate', url: 'https://linkedin.com', description: 'Open LinkedIn' },
      { type: 'wait', ms: 3000, description: 'Wait for page load' },
      { type: 'click', selector: 'button[aria-label*="Create"]', text: 'Create post', description: 'Click create post' },
      { type: 'wait', ms: 2000, description: 'Wait for post dialog' },
    ]),
  },
  {
    name: 'Check Gmail',
    description: 'check gmail inbox email read messages',
    siteUrl: 'https://mail.google.com',
    actions: JSON.stringify([
      { type: 'navigate', url: 'https://mail.google.com', description: 'Open Gmail' },
      { type: 'wait', ms: 3000, description: 'Wait for inbox load' },
      { type: 'screenshot', description: 'Capture inbox view' },
    ]),
  },
]

async function main() {
  console.log('Seeding basic workflows...\n')
  let created = 0
  for (const wf of BASIC_WORKFLOWS) {
    try {
      // Check if workflow already exists (by name)
      const existing = await db.browserWorkflow.findFirst({ where: { name: wf.name } })
      if (existing) {
        console.log(`  ⏭️  ${wf.name} — already exists`)
        continue
      }
      await db.browserWorkflow.create({
        data: {
          ...wf,
          successCount: 1,  // Pre-seed with success=1 so they appear in matches
          failureCount: 0,
          lastStatus: 'success',
        },
      })
      console.log(`  ✅ ${wf.name} — created`)
      created++
    } catch (err: any) {
      console.log(`  ❌ ${wf.name} — ${err.message}`)
    }
  }
  console.log(`\nDone: ${created} workflows created`)
}

main().catch(console.error).finally(() => db.$disconnect())
