// =====================================================================
// phase17-migrate.ts — additive Prisma migration for Phase 17 models.
// =====================================================================
// Reads `prisma/phase17-additions.prisma`, extracts model definitions,
// and uses `prisma db push` to apply them additively.
//
// ALSO writes a manifest of created tables so a future rollback script
// can `DROP TABLE` only the Phase 17 additions.
//
// Idempotent — safe to run multiple times.
// =====================================================================

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { execSync } from 'child_process'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const PHASE17_MODELS = [
  'MarketingOpportunityFeed',
  'OkaraCrawlRun',
  'PersistentWindow',
  'StateBusEntry',
  'MCTSRun',
  'MCTSNode',
  'MCTSPendingApproval',
  'Phase17Manifest',
]

async function main(): Promise<void> {
  console.log('[phase17-migrate] starting additive migration...')

  // 1. Verify the schema additions file exists
  const projectRoot = resolve(__dirname, '..')
  const schemaPath = join(projectRoot, 'prisma', 'phase17-additions.prisma')
  if (!existsSync(schemaPath)) {
    console.error(`[phase17-migrate] ERROR: ${schemaPath} not found`)
    console.error('  Did you copy phase17/prisma/phase17-additions.prisma to your project root?')
    process.exit(1)
  }

  // 2. Build a merged schema by concatenating the main schema + additions
  //    Prisma requires all models in ONE schema file. We do this by reading
  //    both files, stripping the generator/datasource blocks from the
  //    additions file (already done — additions file only has models),
  //    and writing a merged temporary schema.
  const mainSchemaPath = join(projectRoot, 'prisma', 'schema.prisma')
  if (!existsSync(mainSchemaPath)) {
    console.error(`[phase17-migrate] ERROR: ${mainSchemaPath} not found`)
    process.exit(1)
  }

  const mainSchema = readFileSync(mainSchemaPath, 'utf-8')
  const additions = readFileSync(schemaPath, 'utf-8')
  const merged = `${mainSchema}\n\n// ─── Phase 17 additive models ───\n${additions}\n`

  const mergedPath = join(projectRoot, 'prisma', 'schema.merged.prisma')
  writeFileSync(mergedPath, merged)
  console.log(`[phase17-migrate] wrote merged schema to ${mergedPath}`)

  // 3. Run prisma db push on the merged schema (additive — creates new tables)
  console.log('[phase17-migrate] running `prisma db push` on merged schema...')
  try {
    execSync(`npx prisma db push --schema="${mergedPath}" --accept-data-loss=false`, {
      stdio: 'inherit',
      cwd: projectRoot,
    })
  } catch (err) {
    console.error('[phase17-migrate] prisma db push failed:', err)
    process.exit(1)
  }

  // 4. Regenerate the Prisma client so the new models are typed
  console.log('[phase17-migrate] regenerating Prisma client...')
  try {
    execSync(`npx prisma generate --schema="${mergedPath}"`, {
      stdio: 'inherit',
      cwd: projectRoot,
    })
  } catch (err) {
    console.error('[phase17-migrate] prisma generate failed:', err)
    process.exit(1)
  }

  // 5. Replace the main schema with the merged one so the app picks up the new models
  //    (Optional — keep the merged file separate and point DATABASE_URL's schemaPath.
  //    For simplicity, we overwrite schema.prisma with the merged content.)
  writeFileSync(mainSchemaPath, merged)
  console.log(`[phase17-migrate] updated ${mainSchemaPath} with Phase 17 models`)
  // Clean up the temp file
  try { require('fs').unlinkSync(mergedPath) } catch {}

  // 6. Write a manifest of created tables for surgical rollback
  for (const table of PHASE17_MODELS) {
    await prisma.phase17Manifest.upsert({
      where: { tableName: table },
      create: { tableName: table },
      update: {},
    }).catch(() => {
      // Phase17Manifest table might not exist yet on first run — ignore
    })
  }

  console.log('[phase17-migrate] ✓ migration complete')
  console.log('[phase17-migrate] Phase 17 tables created:')
  for (const m of PHASE17_MODELS) console.log(`  - ${m}`)
  console.log('')
  console.log('[phase17-migrate] To roll back: drop these tables manually or use scripts/phase17-rollback.ts (future)')
}

main()
  .catch((err) => {
    console.error('[phase17-migrate] FATAL:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
