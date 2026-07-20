#!/usr/bin/env tsx
/**
 * migrate-to-postgres.ts — Phase 26
 *
 * Migrates JARVIS data from SQLite → PostgreSQL.
 * Safe to run multiple times (idempotent).
 *
 * Usage:
 *   # 1. Set env vars
 *   export SQLITE_URL="file:./prisma/jarvis.db"
 *   export DATABASE_URL="postgresql://jarvis:secret@localhost:5432/jarvis"
 *   export DIRECT_URL="postgresql://jarvis:secret@localhost:5432/jarvis"
 *
 *   # 2. Run Prisma migration on PG first
 *   npx prisma migrate deploy
 *
 *   # 3. Run this script
 *   npx tsx scripts/migrate-to-postgres.ts
 */

import { PrismaClient as SqliteClient } from '@prisma/client'
import { PrismaClient as PgClient } from '@prisma/client'

const BATCH_SIZE = 100

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[migrate] ${new Date().toISOString()} ${msg}`)
}

async function migrateTable<T extends Record<string, unknown>>(
  tableName: string,
  fetchFn: () => Promise<T[]>,
  insertFn: (batch: T[]) => Promise<{ count: number }>,
) {
  log(`Migrating ${tableName}...`)
  const rows = await fetchFn()
  if (rows.length === 0) {
    log(`  ${tableName}: 0 rows — skipping`)
    return
  }
  let migrated = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    try {
      const result = await insertFn(batch)
      migrated += result.count
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // Skip duplicate key errors (idempotent re-run)
      if (msg.includes('Unique constraint') || msg.includes('duplicate key')) {
        log(`  ${tableName}: batch ${i}–${i + batch.length} already exists — skipping`)
        migrated += batch.length
      } else {
        throw err
      }
    }
  }
  log(`  ${tableName}: ✅ ${migrated}/${rows.length} rows migrated`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('Starting SQLite → PostgreSQL migration')
  log(`SQLite: ${process.env.SQLITE_URL || 'file:./prisma/jarvis.db'}`)
  log(`PostgreSQL: ${(process.env.DATABASE_URL || '').replace(/:([^:@]+)@/, ':***@')}`)

  // Connect to SQLite (source)
  const sqlite = new SqliteClient({
    datasources: { db: { url: process.env.SQLITE_URL || 'file:./prisma/jarvis.db' } },
  })

  // Connect to PostgreSQL (target) — use DIRECT_URL to bypass PgBouncer
  const pg = new PgClient({
    datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
  })

  try {
    await sqlite.$connect()
    await pg.$connect()
    log('Connected to both databases')

    // ── 1. Users ──────────────────────────────────────────────────────────
    await migrateTable(
      'User',
      () => sqlite.user.findMany(),
      (batch) => pg.user.createMany({ data: batch, skipDuplicates: true }),
    )

    // ── 2. Accounts (NextAuth) ────────────────────────────────────────────
    await migrateTable(
      'Account',
      () => sqlite.account.findMany(),
      (batch) => pg.account.createMany({ data: batch, skipDuplicates: true }),
    )

    // ── 3. Sessions ───────────────────────────────────────────────────────
    await migrateTable(
      'Session',
      () => sqlite.session.findMany(),
      (batch) => pg.session.createMany({ data: batch, skipDuplicates: true }),
    )

    // ── 4. Providers ──────────────────────────────────────────────────────
    await migrateTable(
      'Provider',
      () => sqlite.provider.findMany(),
      (batch) => pg.provider.createMany({ data: batch, skipDuplicates: true }),
    )

    // ── 5. Agents ─────────────────────────────────────────────────────────
    await migrateTable(
      'Agent',
      () => sqlite.agent.findMany(),
      (batch) => pg.agent.createMany({ data: batch, skipDuplicates: true }),
    )

    // ── 6. Tasks ──────────────────────────────────────────────────────────
    await migrateTable(
      'Task',
      () => sqlite.task.findMany(),
      (batch) => pg.task.createMany({ data: batch, skipDuplicates: true }),
    )

    // ── 7. Messages ───────────────────────────────────────────────────────
    await migrateTable(
      'Message',
      () => sqlite.message.findMany(),
      (batch) => pg.message.createMany({ data: batch, skipDuplicates: true }),
    )

    // ── 8. MemoryItems ────────────────────────────────────────────────────
    await migrateTable(
      'MemoryItem',
      () => sqlite.memoryItem.findMany(),
      (batch) => pg.memoryItem.createMany({ data: batch, skipDuplicates: true }),
    )

    // ── 9. CronJob ────────────────────────────────────────────────────────
    await migrateTable(
      'CronJob',
      () => sqlite.cronJob.findMany(),
      (batch) => pg.cronJob.createMany({ data: batch, skipDuplicates: true }),
    )

    // ── 10. CronExecution ─────────────────────────────────────────────────
    await migrateTable(
      'CronExecution',
      () => sqlite.cronExecution.findMany(),
      (batch) => pg.cronExecution.createMany({ data: batch, skipDuplicates: true }),
    )

    // ── 11. Webhooks ──────────────────────────────────────────────────────
    await migrateTable(
      'Webhook',
      () => sqlite.webhook.findMany(),
      (batch) => pg.webhook.createMany({ data: batch, skipDuplicates: true }),
    )

    // ── 12. WebhookDelivery ───────────────────────────────────────────────
    await migrateTable(
      'WebhookDelivery',
      () => sqlite.webhookDelivery.findMany(),
      (batch) => pg.webhookDelivery.createMany({ data: batch, skipDuplicates: true }),
    )

    // ── 13. Telemetry ─────────────────────────────────────────────────────
    await migrateTable(
      'Telemetry',
      () => sqlite.telemetry.findMany(),
      (batch) => pg.telemetry.createMany({ data: batch, skipDuplicates: true }),
    )

    // ── 14. AgentLog ──────────────────────────────────────────────────────
    await migrateTable(
      'AgentLog',
      () => sqlite.agentLog.findMany(),
      (batch) => pg.agentLog.createMany({ data: batch, skipDuplicates: true }),
    )

    // ── 15. BlackBoxEntry ─────────────────────────────────────────────────
    await migrateTable(
      'BlackBoxEntry',
      () => sqlite.blackBoxEntry.findMany(),
      (batch) => pg.blackBoxEntry.createMany({ data: batch, skipDuplicates: true }),
    )

    // ── 16. Organization (seed default if empty) ──────────────────────────
    const orgCount = await pg.organization.count().catch(() => 0)
    if (orgCount === 0) {
      log('Seeding default Organization...')
      const firstUser = await pg.user.findFirst({ orderBy: { createdAt: 'asc' } })
      if (firstUser) {
        const org = await pg.organization.create({
          data: {
            name: 'Default Organization',
            slug: 'default',
            ownerId: firstUser.id,
          },
        })
        await pg.orgMembership.create({
          data: {
            orgId: org.id,
            userId: firstUser.id,
            role: 'ADMIN',
          },
        })
        log(`  Created default org "${org.name}" with owner ${firstUser.email}`)
      }
    } else {
      log(`  Organization: ${orgCount} orgs already exist — skipping seed`)
    }

    log('✅ Migration complete!')
    log('Next steps:')
    log('  1. Verify data: npx prisma studio (with DIRECT_URL set)')
    log('  2. Update DATABASE_URL in .env to point to PostgreSQL')
    log('  3. Restart the app: docker compose restart app')
  } finally {
    await sqlite.$disconnect()
    await pg.$disconnect()
  }
}

main().catch((err) => {
  console.error('[migrate] FATAL:', err)
  process.exit(1)
})
