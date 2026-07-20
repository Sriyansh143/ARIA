#!/usr/bin/env node
// =====================================================================
// ensure-schema.js — Ensure the SQLite DB has all orgId columns.
// =====================================================================
// Run this AFTER `bun run db:push` if you see errors like:
//   "The column `main.Provider.orgId` does not exist in the current database"
//
// This adds the missing orgId columns directly via ALTER TABLE (SQLite
// supports adding nullable columns with ALTER TABLE ... ADD COLUMN).
//
// Usage: node scripts/ensure-schema.js
// =====================================================================
const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

// Find the SQLite DB file
const envPath = path.resolve(process.cwd(), '.env')
let dbUrl = 'file:./prisma/jarvis.db'
if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf-8')
  const m = env.match(/^DATABASE_URL=(.+)$/m)
  if (m) dbUrl = m[1].trim().replace(/^file:/, '').replace(/^["']|["']$/g, '')
}

const dbPath = path.resolve(process.cwd(), dbUrl)
if (!fs.existsSync(dbPath)) {
  console.log(`[ensure-schema] DB not found at ${dbPath} — skipping (run db:push first)`)
  process.exit(0)
}

console.log(`[ensure-schema] Checking ${dbPath}...`)
const db = new Database(dbPath)

// Tables that should have an orgId column (from the Prisma schema)
const TABLES_WITH_ORGID = [
  'Task', 'Agent', 'MemoryItem', 'Webhook', 'CronHistory', 'Notification',
  'Artifact', 'Workflow', 'Board', 'Skill', 'SkillExecution', 'ApiKey',
  'AuditLog', 'OrgMembership', 'OrgInvite', 'SsoConfig', 'EpisodicMemory',
  'SemanticMemory', 'WorkingMemoryEntry', 'ConversationMessage',
  'ConversationSummary', 'Provider', 'Setting',
  'WorkforceAgent', 'WorkforceTask', 'WorkforcePerformance', 'WorkforceAuditLog',
  'WorkforceDepartment', 'WorkforceSkillMatrix', 'WorkforceReview',
  'WorkforceConsensus', 'WorkforceMeeting', 'WorkforceStandup',
]

let added = 0
let skipped = 0

for (const table of TABLES_WITH_ORGID) {
  try {
    // Check if the table exists
    const tableExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(table)
    if (!tableExists) {
      console.log(`  [skip] ${table} — table doesn't exist yet`)
      skipped++
      continue
    }
    // Check if orgId column already exists
    const cols = db.prepare(`PRAGMA table_info("${table}")`).all()
    const hasOrgId = cols.some((c) => c.name === 'orgId')
    if (hasOrgId) {
      skipped++
      continue
    }
    // Add the orgId column (nullable String)
    db.exec(`ALTER TABLE "${table}" ADD COLUMN "orgId" TEXT;`)
    console.log(`  [added] ${table}.orgId`)
    added++
  } catch (err) {
    console.log(`  [error] ${table}: ${err.message}`)
  }
}

db.close()
console.log(`[ensure-schema] Done — added ${added} orgId columns, skipped ${skipped}`)
