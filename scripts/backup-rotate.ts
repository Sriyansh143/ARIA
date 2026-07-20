#!/usr/bin/env node
/**
 * JARVIS Mission Control — Backup Rotation Script
 *
 * Strategy: Grandfather-Father-Son (GFS)
 *   - Daily backups: keep last 7
 *   - Weekly backups: keep last 4 (every Sunday)
 *   - Monthly backups: keep last 12 (1st of each month)
 *
 * Storage:
 *   - Local: download/backups/
 *   - Remote (optional): S3-compatible (Supabase Storage, B2, R2, AWS S3)
 *
 * Usage:
 *   npx tsx scripts/backup-rotate.ts
 *
 * Schedule via cron (daily at 2am):
 *   0 2 * * * cd /app && npx tsx scripts/backup-rotate.ts >> /var/log/jarvis-backup.log 2>&1
 *
 * Or via systemd timer (see deploy/jarvis-backup.timer).
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync,
  copyFileSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createGzip } from 'zlib'
import { execSync } from 'child_process'

// --- Config (from env) ---

const BACKUP_DIR = process.env.BACKUP_DIR || join(process.cwd(), 'download', 'backups')
const DB_PATH = process.env.DATABASE_URL?.replace('file:', '') || join(process.cwd(), 'db', 'custom.db')
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || join(process.cwd(), 'download', 'artifacts')

const KEEP_DAILY = 7
const KEEP_WEEKLY = 4
const KEEP_MONTHLY = 12

// S3 config (optional)
const S3_ENDPOINT = process.env.BACKUP_S3_ENDPOINT  // e.g. https://xyz.supabase.co/storage/v1/s3
const S3_BUCKET = process.env.BACKUP_S3_BUCKET
const S3_ACCESS_KEY = process.env.BACKUP_S3_ACCESS_KEY
const S3_SECRET_KEY = process.env.BACKUP_S3_SECRET_KEY
const S3_REGION = process.env.BACKUP_S3_REGION || 'us-east-1'

// --- Helpers ---

function timestamp(): string {
  const now = new Date()
  return now.toISOString().replace(/[:.]/g, '-').slice(0, 19) // 2026-06-30T14-30-00
}

function dateSuffix(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10) // 2026-06-30
}

async function gzipFile(srcPath: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const src = createReadStream(srcPath)
    const dest = createWriteStream(destPath)
    const gzip = createGzip()
    src.pipe(gzip).pipe(dest)
    dest.on('finish', resolve)
    dest.on('error', reject)
    src.on('error', reject)
    gzip.on('error', reject)
  })
}

async function uploadToS3(filePath: string, key: string): Promise<boolean> {
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
    return false // S3 not configured — skip
  }
  try {
    // Use AWS CLI if available (simpler than SDK for one-off uploads)
    const cmd = `aws s3 cp "${filePath}" "s3://${S3_BUCKET}/${key}"` +
      ` --endpoint-url "${S3_ENDPOINT}" --region "${S3_REGION}"`
    execSync(cmd, { stdio: 'pipe' })
    console.log(`[backup] Uploaded to S3: ${key}`)
    return true
  } catch (err) {
    console.warn(`[backup] S3 upload failed (non-fatal):`, err instanceof Error ? err.message : err)
    return false
  }
}

function listBackups(): { name: string; path: string; mtime: Date; size: number }[] {
  if (!existsSync(BACKUP_DIR)) return []
  return readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.tar.gz'))
    .map((name) => {
      const path = join(BACKUP_DIR, name)
      const stat = statSync(path)
      return { name, path, mtime: stat.mtime, size: stat.size }
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
}

function deleteBackup(path: string): void {
  try {
    unlinkSync(path)
    console.log(`[backup] Deleted old backup: ${path}`)
  } catch (err) {
    console.warn(`[backup] Failed to delete ${path}:`, err)
  }
}

function isSunday(d: Date): boolean {
  return d.getDay() === 0
}

function isFirstOfMonth(d: Date): boolean {
  return d.getDate() === 1
}

// --- Main ---

async function main() {
  console.log(`[backup] Starting at ${new Date().toISOString()}`)
  console.log(`[backup] BACKUP_DIR=${BACKUP_DIR}`)
  console.log(`[backup] DB_PATH=${DB_PATH}`)

  mkdirSync(BACKUP_DIR, { recursive: true })

  const ts = timestamp()
  const today = new Date()
  const backupName = `jarvis-${ts}.tar.gz`
  const backupPath = join(BACKUP_DIR, backupName)

  // 1. Snapshot the SQLite DB (using sqlite3 .backup if available, else copy)
  const dbBackupPath = join(BACKUP_DIR, `db-${ts}.sqlite`)
  if (existsSync(DB_PATH)) {
    try {
      // Try sqlite3 .backup (safer than copy — handles concurrent writes)
      execSync(`sqlite3 "${DB_PATH}" ".backup '${dbBackupPath}'"`, { stdio: 'pipe' })
      console.log(`[backup] DB snapshot: ${dbBackupPath}`)
    } catch {
      // Fall back to plain copy
      copyFileSync(DB_PATH, dbBackupPath)
      console.log(`[backup] DB copy: ${dbBackupPath}`)
    }
  } else {
    console.warn(`[backup] DB not found at ${DB_PATH} — skipping DB backup`)
  }

  // 2. Create tarball: DB + artifacts + .env (redacted)
  try {
    const tarCmd = [
      `tar -czf "${backupPath}"`,
      `-C "${BACKUP_DIR}" "db-${ts}.sqlite"`,
    ]
    if (existsSync(ARTIFACTS_DIR)) {
      tarCmd.push(`-C "${process.cwd()}/download" "artifacts"`)
    }
    // Include .env but redact secret values (keep keys for reference)
    if (existsSync(join(process.cwd(), '.env'))) {
      const envRedacted = join(BACKUP_DIR, `.env-${ts}.redacted`)
      const envContent = readFileSync(join(process.cwd(), '.env'), 'utf-8')
      const redacted = envContent.replace(/=(.+)$/gm, (m: string, val: string) => {
        if (val.length < 4) return '=***REDACTED***'
        return `=${val.slice(0, 2)}***REDACTED***`
      })
      writeFileSync(envRedacted, redacted)
      tarCmd.push(`-C "${BACKUP_DIR}" ".env-${ts}.redacted"`)
    }
    execSync(tarCmd.join(' '), { stdio: 'pipe' })
    console.log(`[backup] Created: ${backupPath} (${(statSync(backupPath).size / 1024 / 1024).toFixed(2)} MB)`)
  } catch (err) {
    console.error(`[backup] Failed to create tarball:`, err)
    process.exit(1)
  }

  // 3. Clean up intermediate DB snapshot
  try { unlinkSync(join(BACKUP_DIR, `db-${ts}.sqlite`)) } catch {}
  try { unlinkSync(join(BACKUP_DIR, `.env-${ts}.redacted`)) } catch {}

  // 4. Upload to S3 (if configured)
  await uploadToS3(backupPath, backupName)

  // 5. Rotate — apply GFS strategy
  console.log(`[backup] Rotating backups (keep ${KEEP_DAILY} daily, ${KEEP_WEEKLY} weekly, ${KEEP_MONTHLY} monthly)`)
  const allBackups = listBackups()
  const now = Date.now()

  // Categorize backups by age
  const dailyBackups: typeof allBackups = []
  const weeklyBackups: typeof allBackups = []
  const monthlyBackups: typeof allBackups = []

  for (const b of allBackups) {
    const ageDays = (now - b.mtime.getTime()) / (1000 * 60 * 60 * 24)
    if (ageDays <= 7) {
      dailyBackups.push(b)
    } else if (ageDays <= 28 && isSunday(b.mtime)) {
      weeklyBackups.push(b)
    } else if (ageDays <= 365 && isFirstOfMonth(b.mtime)) {
      monthlyBackups.push(b)
    }
    // Older than 365 days → delete
    else if (ageDays > 365) {
      deleteBackup(b.path)
    }
  }

  // Keep only the most recent N from each category
  // (backups are already sorted newest-first)
  for (const b of dailyBackups.slice(KEEP_DAILY)) deleteBackup(b.path)
  for (const b of weeklyBackups.slice(KEEP_WEEKLY)) deleteBackup(b.path)
  for (const b of monthlyBackups.slice(KEEP_MONTHLY)) deleteBackup(b.path)

  // Delete orphans (backups older than 7 days that aren't Sunday or 1st-of-month)
  for (const b of allBackups) {
    const ageDays = (now - b.mtime.getTime()) / (1000 * 60 * 60 * 24)
    if (ageDays > 7 && !isSunday(b.mtime) && !isFirstOfMonth(b.mtime)) {
      // Check it's not already in weekly/monthly keep-lists
      if (!weeklyBackups.slice(0, KEEP_WEEKLY).includes(b) && !monthlyBackups.slice(0, KEEP_MONTHLY).includes(b)) {
        deleteBackup(b.path)
      }
    }
  }

  const finalBackups = listBackups()
  console.log(`[backup] Done. ${finalBackups.length} backups retained:`)
  for (const b of finalBackups) {
    const sizeMB = (b.size / 1024 / 1024).toFixed(2)
    console.log(`  ${b.name}  (${sizeMB} MB, ${b.mtime.toISOString()})`)
  }
}

main().catch((err) => {
  console.error(`[backup] FATAL:`, err)
  process.exit(1)
})