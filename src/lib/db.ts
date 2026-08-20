import { PrismaClient } from '@prisma/client'

/**
 * src/lib/db.ts — Prisma client singleton (dual-DB: SQLite + PostgreSQL).
 *
 * The provider is determined by DATABASE_URL:
 *   - "file:..."        → SQLite (dev default)
 *   - "postgresql://..." → PostgreSQL (production)
 *
 * Both providers are compatible with this schema (no JSON columns, no
 * native arrays — all complex types are String with JSON.stringify at
 * the app layer). The prisma CLI (db:push, migrate) reads the provider
 * from schema.prisma, so for production migrations, temporarily switch
 * the provider in schema.prisma to "postgresql" OR use:
 *   DATABASE_URL=postgresql://... npx prisma db push --schema=prisma/schema.prisma
 *
 * Versioned cache key — bump when Prisma schema changes. The cache
 * survives hot reloads, so a stale PrismaClient from a previous schema
 * won't have the new models.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prisma_v2: PrismaClient | undefined
}

// Use the new versioned cache if it has a healthy client; otherwise
// fall back to creating a new one (and invalidate the legacy cache).
const cachedV2 = globalForPrisma.prisma_v2
const cachedV1 = globalForPrisma.prisma

// A stale cached client is one that is missing the Task 24 models.
const hasTask24Models = (client: PrismaClient): boolean =>
  typeof (client as unknown as { simulationRun?: unknown }).simulationRun !== 'undefined'

let db: PrismaClient
if (cachedV2 && hasTask24Models(cachedV2)) {
  db = cachedV2
} else if (cachedV1 && hasTask24Models(cachedV1)) {
  // Legacy cache is healthy — promote it to the v2 slot.
  db = cachedV1
  globalForPrisma.prisma_v2 = db
} else {
  db = new PrismaClient({ log: ['warn', 'error'] })
  globalForPrisma.prisma_v2 = db
  // Clear the legacy cache so subsequent imports use the v2 slot.
  globalForPrisma.prisma = undefined
}

/**
 * Detect which database provider is active based on DATABASE_URL.
 * Used by /api/settings to surface the active provider in the UI.
 */
export function getDatabaseProvider(): 'sqlite' | 'postgresql' {
  const url = process.env.DATABASE_URL ?? ''
  if (url.startsWith('postgresql://') || url.startsWith('postgres://')) {
    return 'postgresql'
  }
  return 'sqlite'
}

export { db }