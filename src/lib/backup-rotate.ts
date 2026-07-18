// =====================================================================
// backup-rotate.ts — automatic backup file rotation.
// =====================================================================
// Task ID 4 (PARALLEL-C — zip import).
//
// Saves snapshot JSON exports of key DB tables to disk so the operator
// can restore from them later. Without rotation, the disk fills up —
// this module:
//
//   1. Writes the backup JSON to backups/<timestamp>.json.gz (gzip-compressed)
//   2. Lists all existing backup files sorted by mtime (newest first)
//   3. Deletes the oldest ones beyond MAX_BACKUPS (default 20) on write
//   4. Prunes backups older than MAX_AGE_DAYS (default 90) regardless
//
// Adapted from the jarvis-mission-control-final zip:
//   - uses the project-root `backups/` folder (configurable via env)
//   - identical public API: saveRotatedBackup, listBackups, pruneOldBackups,
//     readBackup, deleteBackup
// =====================================================================

import { createGzip, createGunzip } from 'zlib'
import {
  createReadStream, createWriteStream, readdirSync, statSync, unlinkSync,
  mkdirSync, existsSync,
} from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

// Backups live in <cwd>/backups/. Override via env if needed.
const BACKUP_DIR = process.env.JARVIS_BACKUP_DIR || join(process.cwd(), 'backups')
const MAX_BACKUPS = Number(process.env.JARVIS_BACKUP_MAX_COUNT) || 20
const MAX_AGE_DAYS = Number(process.env.JARVIS_BACKUP_MAX_AGE_DAYS) || 90

export interface BackupMetadata {
  filename: string
  path: string
  sizeBytes: number
  createdAt: Date
  ageDays: number
}

/**
 * Ensure the backup directory exists.
 */
function ensureBackupDir(): void {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true })
  }
}

/**
 * Generate a timestamped backup filename: jarvis-backup-YYYYMMDD-HHMMSS.json.gz
 */
function backupFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts =
    date.getFullYear().toString() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    '-' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  return `jarvis-backup-${ts}.json.gz`
}

/**
 * Save a backup JSON string to disk (gzip-compressed) and prune old backups.
 * Returns the metadata for the newly-created backup.
 */
export async function saveRotatedBackup(json: string): Promise<BackupMetadata> {
  ensureBackupDir()
  const filename = backupFilename()
  const path = join(BACKUP_DIR, filename)

  // Write gzip-compressed JSON to disk.
  // Use pipeline() so the stream is properly cleaned up on error.
  const readable = Readable.from([json])
  const gz = createGzip({ level: 9 })
  const out = createWriteStream(path, { mode: 0o600 })
  await pipeline(readable, gz, out)

  const stat = statSync(path)
  const createdAt = stat.mtime
  const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)

  // Prune old backups after writing.
  await pruneOldBackups()

  return {
    filename,
    path,
    sizeBytes: stat.size,
    createdAt,
    ageDays,
  }
}

/**
 * List all backup files in the backup directory, newest first.
 */
export function listBackups(): BackupMetadata[] {
  ensureBackupDir()
  const files = readdirSync(BACKUP_DIR).filter(
    (f) => f.startsWith('jarvis-backup-') && f.endsWith('.json.gz'),
  )
  const now = Date.now()
  return files
    .map((filename) => {
      const path = join(BACKUP_DIR, filename)
      const stat = statSync(path)
      return {
        filename,
        path,
        sizeBytes: stat.size,
        createdAt: stat.mtime,
        ageDays: (now - stat.mtime.getTime()) / (1000 * 60 * 60 * 24),
      }
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

/**
 * Delete backups beyond MAX_BACKUPS count OR older than MAX_AGE_DAYS.
 * Returns the list of deleted filenames.
 */
export async function pruneOldBackups(): Promise<string[]> {
  ensureBackupDir()
  const backups = listBackups()
  const deleted: string[] = []

  for (let i = 0; i < backups.length; i++) {
    const b = backups[i]
    const tooMany = i >= MAX_BACKUPS // 0-indexed, so index 20 = 21st file
    const tooOld = b.ageDays > MAX_AGE_DAYS
    if (tooMany || tooOld) {
      try {
        unlinkSync(b.path)
        deleted.push(b.filename)
      } catch (err) {
        console.warn(
          `[backup-rotate] failed to delete ${b.filename}:`,
          err instanceof Error ? err.message : err,
        )
      }
    }
  }

  if (deleted.length > 0) {
    console.log(`[backup-rotate] pruned ${deleted.length} old backup(s)`)
  }
  return deleted
}

/**
 * Read a specific backup file by filename and return its decompressed JSON.
 * Throws if the file doesn't exist or isn't a valid gzip.
 */
export async function readBackup(filename: string): Promise<string> {
  // Sanitize filename — only allow our own naming pattern.
  if (!/^jarvis-backup-\d{8}-\d{6}\.json\.gz$/.test(filename)) {
    throw new Error('Invalid backup filename')
  }
  const path = join(BACKUP_DIR, filename)
  if (!existsSync(path)) {
    throw new Error(`Backup not found: ${filename}`)
  }

  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    const src = createReadStream(path)
    const gunz = createGunzip()
    src.pipe(gunz)
    gunz.on('data', (chunk: Buffer) => chunks.push(chunk))
    gunz.on('end', resolve)
    gunz.on('error', reject)
    src.on('error', reject)
  })

  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Delete a specific backup file by filename.
 */
export function deleteBackup(filename: string): void {
  if (!/^jarvis-backup-\d{8}-\d{6}\.json\.gz$/.test(filename)) {
    throw new Error('Invalid backup filename')
  }
  const path = join(BACKUP_DIR, filename)
  if (!existsSync(path)) {
    throw new Error(`Backup not found: ${filename}`)
  }
  unlinkSync(path)
}

/**
 * Returns the absolute path of a backup by filename — used by the API
 * when streaming a download. Performs the same regex sanitization.
 */
export function resolveBackupPath(filename: string): string {
  if (!/^jarvis-backup-\d{8}-\d{6}\.json\.gz$/.test(filename)) {
    throw new Error('Invalid backup filename')
  }
  const path = join(BACKUP_DIR, filename)
  if (!existsSync(path)) {
    throw new Error(`Backup not found: ${filename}`)
  }
  return path
}

/**
 * Build a JSON snapshot of the key DB tables. Used by the POST handler
 * of /api/admin/backup to create a new backup. Excludes encrypted
 * credential fields and large audit tables — the snapshot is meant
 * for restoring the *core* operational state (agents, tasks, skills,
 * providers, rules, comms, payments), not a byte-for-byte DB clone.
 */
export async function buildDbSnapshot(): Promise<Record<string, unknown>> {
  // Lazy-import db so this module can be loaded in environments without
  // a running Prisma client (e.g. unit tests of the rotation helpers).
  const { db } = await import('@/lib/db')
  const [
    agents, tasks, skills, cronJobs, providers, models, rules,
    earningMethods, payments, comms, memoryItems, notifications,
    pipelines, departments, workforceAgents, plugins, settings,
  ] = await Promise.all([
    db.agent.findMany(),
    db.task.findMany(),
    db.skill.findMany(),
    db.cronJob.findMany(),
    db.provider.findMany({ select: { id: true, key: true, name: true, model: true, enabled: true, latency: true, tokens: true, createdAt: true, updatedAt: true } }),
    db.model.findMany(),
    db.rule.findMany(),
    db.earningMethod.findMany(),
    db.payment.findMany(),
    db.agentMessage.findMany(),
    db.memoryItem.findMany(),
    db.notification.findMany(),
    db.pipeline.findMany(),
    db.department.findMany(),
    db.workforceAgent.findMany(),
    db.plugin.findMany(),
    // No formal Settings table — capture a few key/value pairs from
    // memoryItem(scope='setting') if any exist.
    db.memoryItem.findMany({ where: { scope: 'setting' } }),
  ])

  return {
    _meta: {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      tableCount: 17,
    },
    agents,
    tasks,
    skills,
    cronJobs,
    providers,
    models,
    rules,
    earningMethods,
    payments,
    comms,
    memoryItems,
    notifications,
    pipelines,
    departments,
    workforceAgents,
    plugins,
    settings,
  }
}
