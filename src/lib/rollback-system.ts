// =====================================================================
// rollback-system.ts — Snapshot + rollback for destructive ops
// =====================================================================
// Adapted from the v8 zip. Implements the user's permanent rule:
//   "code or features once fixed should not be disturbed or break because
//    of other codes generated or modified unless it is necessary"
//
// Wraps a snapshot/restore lifecycle around destructive operations:
//   • createSnapshot(scope, payload, reason) — capture state, return id
//   • rollback(snapshotId)                   — restore the captured state
//   • listSnapshots(scope?)                  — list available snapshots
//   • loadSnapshot(id)                       — read one snapshot
//   • discardSnapshot(id)                    — drop a snapshot without restoring
//   • snapshotStats()                        — count + size info
//
// Snapshots are stored as JSON files under /home/z/my-project/rollback-snapshots/
// (so they survive process restarts). Each snapshot captures one or more of:
//   - 'db': a list of row states for specified tables (passed by caller)
//   - 'files': copies of files into a sibling .bak directory
//   - 'env': a snapshot of selected env vars
//
// This is intentionally generic and dependency-light: it doesn't touch git
// (git-checkpoint.ts handles the agent workspace) or the full DB (the
// caller picks exactly which rows/tables to snapshot — keeps payload small).
// =====================================================================

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import crypto from 'node:crypto';

const SNAPSHOT_DIR = join(process.cwd(), 'rollback-snapshots');
const FILE_BAK_DIR = join(SNAPSHOT_DIR, 'file-baks');

// Ensure dirs exist (lazy — created on first use, not at import time, so
// importing this module never throws).
function ensureDirs(): void {
  if (!existsSync(SNAPSHOT_DIR)) {
    try { mkdirSync(SNAPSHOT_DIR, { recursive: true }); } catch { /* ignore */ }
  }
  if (!existsSync(FILE_BAK_DIR)) {
    try { mkdirSync(FILE_BAK_DIR, { recursive: true }); } catch { /* ignore */ }
  }
}

export type SnapshotScope = 'db' | 'files' | 'env' | 'mixed';

export interface SnapshotPayload {
  /** table name → array of row objects (caller is responsible for restore) */
  db?: Record<string, Array<Record<string, unknown>>>;
  /** files to back up (path) or delete-on-rollback (content=undefined + no bak) */
  files?: Array<{ path: string; content?: string; bakPath?: string }>;
  /** env vars to snapshot (process-level only — does NOT touch .env file) */
  env?: Record<string, string | undefined>;
}

export interface Snapshot {
  id: string;
  scope: SnapshotScope;
  createdAt: string;
  reason?: string;
  payload: SnapshotPayload;
}

export interface RollbackResult {
  restored: Snapshot;
  result: { files: number; env: number; db: number };
}

// ─── createSnapshot ───────────────────────────────────────────────────
export function createSnapshot(
  scope: SnapshotScope,
  payload: SnapshotPayload = {},
  reason?: string,
): Snapshot {
  ensureDirs();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  // For files, copy each into the bak dir so we can restore byte-for-byte
  // even if the original is deleted/modified.
  const files: NonNullable<SnapshotPayload['files']> = [];
  if (scope === 'files' || scope === 'mixed') {
    for (const f of payload.files ?? []) {
      if (!f.path) continue;
      const bakName = `${id}__${crypto.createHash('sha1').update(f.path).digest('hex').slice(0, 12)}`;
      const bakPath = join(FILE_BAK_DIR, bakName);
      if (existsSync(f.path)) {
        try {
          copyFileSync(f.path, bakPath);
          files.push({ path: f.path, bakPath });
        } catch (err) {
          console.warn('[rollback] could not back up file:', f.path, err instanceof Error ? err.message : String(err));
        }
      } else if (f.content !== undefined) {
        // Caller provided inline content (e.g. for files that don't exist yet
        // but will be created by the destructive op — rollback should delete).
        try {
          writeFileSync(bakPath, f.content);
          files.push({ path: f.path, bakPath });
        } catch (err) {
          console.warn('[rollback] could not write inline bak:', err instanceof Error ? err.message : String(err));
        }
      }
    }
  }

  const snapshot: Snapshot = {
    id,
    scope,
    createdAt,
    reason,
    payload: {
      db: payload.db,
      files: files.length ? files : undefined,
      env: scope === 'env' || scope === 'mixed' ? payload.env : undefined,
    },
  };

  const snapshotPath = join(SNAPSHOT_DIR, `${id}.json`);
  try {
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
    console.info(`[rollback] snapshot created: ${id} (scope=${scope}${reason ? `, reason=${reason}` : ''})`);
  } catch (err) {
    throw new Error(`Failed to persist snapshot: ${err instanceof Error ? err.message : String(err)}`);
  }

  return snapshot;
}

// ─── rollback ─────────────────────────────────────────────────────────
export function rollback(snapshotId: string): RollbackResult {
  const snapshot = loadSnapshot(snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  let filesRestored = 0;
  let envRestored = 0;
  let dbAvailable = 0;

  // Restore files
  for (const f of snapshot.payload.files ?? []) {
    if (!f.path || !f.bakPath) continue;
    try {
      if (existsSync(f.bakPath)) {
        // Ensure parent dir exists
        const parent = dirname(f.path);
        if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
        copyFileSync(f.bakPath, f.path);
        filesRestored++;
      } else if (f.content === undefined) {
        // The file did not exist at snapshot time → delete the current one
        if (existsSync(f.path)) {
          rmSync(f.path, { force: true });
          filesRestored++;
        }
      }
    } catch (err) {
      console.warn('[rollback] could not restore file:', f.path, err instanceof Error ? err.message : String(err));
    }
  }

  // Restore env (process-level only — does NOT touch .env file)
  for (const [k, v] of Object.entries(snapshot.payload.env ?? {})) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
    envRestored++;
  }

  // DB rows: caller restores via their own code; we just count + log.
  for (const [table, rows] of Object.entries(snapshot.payload.db ?? {})) {
    dbAvailable += rows.length;
    console.info(`[rollback] DB payload available for caller-driven restore: ${table} (${rows.length} rows)`);
  }

  console.info(`[rollback] restore complete: ${snapshotId} (files=${filesRestored}, env=${envRestored}, db=${dbAvailable})`);
  return { restored: snapshot, result: { files: filesRestored, env: envRestored, db: dbAvailable } };
}

// ─── list / load / discard ────────────────────────────────────────────
export function listSnapshots(scope?: SnapshotScope): Snapshot[] {
  if (!existsSync(SNAPSHOT_DIR)) return [];
  const out: Snapshot[] = [];
  for (const f of readdirSync(SNAPSHOT_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const snap = JSON.parse(readFileSync(join(SNAPSHOT_DIR, f), 'utf8')) as Snapshot;
      if (scope && snap.scope !== scope && scope !== 'mixed') continue;
      out.push(snap);
    } catch { /* skip corrupt */ }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function loadSnapshot(id: string): Snapshot | null {
  const p = join(SNAPSHOT_DIR, `${id}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Snapshot;
  } catch {
    return null;
  }
}

export function discardSnapshot(id: string): boolean {
  const p = join(SNAPSHOT_DIR, `${id}.json`);
  if (!existsSync(p)) return false;
  try {
    rmSync(p, { force: true });
    // Clean up associated bak files
    if (existsSync(FILE_BAK_DIR)) {
      for (const f of readdirSync(FILE_BAK_DIR)) {
        if (f.startsWith(`${id}__`)) {
          try { rmSync(join(FILE_BAK_DIR, f), { force: true }); } catch { /* ignore */ }
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

// ─── snapshotStats ────────────────────────────────────────────────────
export function snapshotStats(): { count: number; totalBytes: number; oldest?: string; newest?: string } {
  const snaps = listSnapshots();
  let totalBytes = 0;
  for (const s of snaps) {
    const p = join(SNAPSHOT_DIR, `${s.id}.json`);
    try { totalBytes += statSync(p).size; } catch { /* ignore */ }
  }
  return {
    count: snaps.length,
    totalBytes,
    oldest: snaps[snaps.length - 1]?.createdAt,
    newest: snaps[0]?.createdAt,
  };
}

// ─── withRollback (convenience wrapper) ───────────────────────────────
// Wraps a destructive operation in a snapshot/restore lifecycle.
// If the operation throws, automatically rolls back and re-throws.
// If it succeeds, the snapshot is discarded (use keepOnSuccess=true to retain).
export async function withRollback<T>(
  scope: SnapshotScope,
  payload: SnapshotPayload,
  reason: string,
  fn: () => Promise<T>,
  opts?: { keepOnSuccess?: boolean },
): Promise<{ result: T; snapshotId: string; rolledBack: boolean }> {
  const snap = createSnapshot(scope, payload, reason);
  try {
    const result = await fn();
    if (!opts?.keepOnSuccess) {
      discardSnapshot(snap.id);
    }
    return { result, snapshotId: snap.id, rolledBack: false };
  } catch (err) {
    console.warn(`[rollback] operation failed, rolling back snapshot ${snap.id}:`, err instanceof Error ? err.message : String(err));
    try {
      rollback(snap.id);
    } catch (rollbackErr) {
      console.error('[rollback] rollback itself failed:', rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr));
    }
    throw err;
  }
}
