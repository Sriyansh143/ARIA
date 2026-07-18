// =====================================================================
// /api/admin/backup — Backup Rotate API
// =====================================================================
// Task ID 4 (PARALLEL-C — zip import).
//
// GET    — list available backups (metadata only; compressed payloads
//          are NOT inlined here — use ?download=<filename> to stream one).
//          Query params:
//            ?download=<filename>  — stream a single backup .gz file
//            ?restore=<filename>   — return the decompressed JSON payload
//                                    for in-browser preview / restore
//
// POST   — create a new backup. Body: { label?: string }
//          Exports the key DB tables (agents, tasks, skills, providers,
//          models, rules, payments, comms, etc.) as JSON, gzip-compresses
//          the result, writes to backups/jarvis-backup-YYYYMMDD-HHMMSS.json.gz,
//          and prunes old backups beyond MAX_BACKUPS / MAX_AGE_DAYS.
//          Also writes an AuditLog row.
//
// DELETE — delete one or more old backups. Body: { filename: string }
//          Filename MUST match the strict pattern jarvis-backup-\d{8}-\d{6}.json.gz
//          so attackers can't traverse paths. Also writes an AuditLog row.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server'
import {
  saveRotatedBackup, listBackups, buildDbSnapshot,
  deleteBackup, readBackup, resolveBackupPath,
} from '@/lib/backup-rotate'
import { logAudit, AuditActions } from '@/lib/audit-log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ─── GET ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const download = sp.get('download')
  const restore = sp.get('restore')

  // Stream a single backup file as a downloadable attachment.
  if (download) {
    try {
      const path = resolveBackupPath(download)
      const { readFile } = await import('fs/promises')
      const buf = await readFile(path)
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${download}"`,
          'Content-Length': String(buf.byteLength),
        },
      })
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : 'failed to read backup' },
        { status: 400 },
      )
    }
  }

  // Return the decompressed JSON payload of a single backup (for preview/restore).
  if (restore) {
    try {
      const json = await readBackup(restore)
      return NextResponse.json({ ok: true, filename: restore, payload: JSON.parse(json) })
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : 'failed to read backup' },
        { status: 400 },
      )
    }
  }

  // Default: list backups with metadata.
  try {
    const backups = listBackups()
    const totalBytes = backups.reduce((sum, b) => sum + b.sizeBytes, 0)
    return NextResponse.json({
      backups,
      count: backups.length,
      totalBytes,
      maxBackups: Number(process.env.JARVIS_BACKUP_MAX_COUNT) || 20,
      maxAgeDays: Number(process.env.JARVIS_BACKUP_MAX_AGE_DAYS) || 90,
    })
  } catch (err) {
    console.error('[/api/admin/backup GET] failed:', err)
    return NextResponse.json(
      { backups: [], count: 0, error: err instanceof Error ? err.message : 'failed to list backups' },
      { status: 200 },
    )
  }
}

// ─── POST — create a new backup ──────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const label = typeof body.label === 'string' ? body.label.slice(0, 200) : undefined

  try {
    const snapshot = await buildDbSnapshot()
    if (label) (snapshot._meta as Record<string, unknown>).label = label
    const json = JSON.stringify(snapshot)
    const meta = await saveRotatedBackup(json)

    // Audit the backup creation (fire-and-forget).
    void logAudit({
      action: AuditActions.BACKUP_CREATE,
      target: `backup:${meta.filename}`,
      meta: { sizeBytes: meta.sizeBytes, label },
      req,
    })

    return NextResponse.json({
      ok: true,
      backup: meta,
      message: `Backup saved: ${meta.filename} (${(meta.sizeBytes / 1024).toFixed(1)} KB)`,
    })
  } catch (err) {
    console.error('[/api/admin/backup POST] failed:', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'failed to create backup' },
      { status: 500 },
    )
  }
}

// ─── DELETE — delete a backup ────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const filename = typeof body.filename === 'string' ? body.filename : ''

  if (!filename) {
    return NextResponse.json(
      { ok: false, error: 'filename required in body' },
      { status: 400 },
    )
  }

  try {
    deleteBackup(filename)
    void logAudit({
      action: AuditActions.BACKUP_DELETE,
      target: `backup:${filename}`,
      req,
    })
    return NextResponse.json({ ok: true, deleted: filename })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'failed to delete backup' },
      { status: 400 },
    )
  }
}
