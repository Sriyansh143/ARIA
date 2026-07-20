// =====================================================================
// phase17-seed-okara.ts — one-shot seed for the Okara feed.
// =====================================================================
// Phase 17 / Dimension 1.
//
// Called by the boot script when PHASE17_OKARA_ENABLED=true and
// OKARA_SEED_URL is set. Triggers an initial crawl via the
// okara-crawler service.
//
// Idempotent — if the feed already has entries, exits without action.
// =====================================================================

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  if (process.env.PHASE17_OKARA_ENABLED !== 'true') {
    console.log('[phase17-seed-okara] PHASE17_OKARA_ENABLED is not true — skipping')
    return
  }

  const seedUrl = process.env.OKARA_SEED_URL
  if (!seedUrl) {
    console.log('[phase17-seed-okara] OKARA_SEED_URL not set — skipping')
    console.log('  Set it in .env, e.g.:')
    console.log('    OKARA_SEED_URL=https://yourdomain.com')
    return
  }

  const existing = await prisma.marketingOpportunityFeed.count()
  if (existing > 0) {
    console.log(`[phase17-seed-okara] feed already has ${existing} entries — skipping seed`)
    return
  }

  console.log(`[phase17-seed-okara] triggering initial crawl of ${seedUrl}...`)
  const OKARA_PORT = Number(process.env.OKARA_CRAWLER_PORT) || 3014

  try {
    const r = await fetch(`http://127.0.0.1:${OKARA_PORT}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seedUrl }),
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) {
      console.error(`[phase17-seed-okara] crawl trigger failed: HTTP ${r.status}`)
      const text = await r.text()
      console.error(`  ${text}`)
      return
    }
    const data = await r.json() as { runId: string }
    console.log(`[phase17-seed-okara] ✓ crawl started — runId: ${data.runId}`)
    console.log('  The okara-crawler service will populate the feed in the background.')
    console.log('  Monitor progress: curl http://127.0.0.1:3014/runs')
  } catch (err: any) {
    console.error(`[phase17-seed-okara] failed to reach okara-crawler: ${err.message}`)
    console.error('  Make sure the service is running on port 3014.')
  }
}

main()
  .catch((err) => {
    console.error('[phase17-seed-okara] FATAL:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
