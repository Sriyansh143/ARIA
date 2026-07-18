// =====================================================================
// git-checkpoint.ts — git-backed checkpoint/rollback for the agent
// workspace (closes the "Checkpoint / rollback via git" gap).
// =====================================================================
// Every file-mutating tool call in the agent loop (edit_file, multi_edit,
// create_file, bash) gets snapshotted here as a real git commit, tagged
// `jarvis-checkpoint/<uuid>` so it stays reachable even after a later
// revert moves the branch pointer backward.
//
// Design notes:
//   • Scoped to the workspace root ONLY (defaults to <cwd>/workspace).
//   • Commits go through os-executor's executeCommand, which already
//     strips secrets from the child env and applies guardrails.
//   • `skipGuardrails: true` is used for the git plumbing itself (init/
//     add/commit/tag/log/reset) since these are internal bookkeeping
//     commands, not agent-authored shell.
//   • Revert is `git reset --hard <hash>` + `git clean -fd`. This is
//     destructive to the working tree by design (that's what "rollback"
//     means) but NOT destructive to history: every checkpoint has a tag,
//     so nothing becomes unreachable — you can always revert forward
//     again to a "later" checkpoint after rolling back.
// =====================================================================

import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import crypto from 'crypto'
import { executeCommand } from '@/lib/os-executor'
import { logger } from '@/lib/logger'

// ── C1 hardening: strict UUID validation ─────────────────────────────
const CHECKPOINT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function assertValidCheckpointId(id: string): void {
  if (typeof id !== 'string' || !CHECKPOINT_ID_RE.test(id)) {
    throw new Error(`Invalid checkpoint ID: ${JSON.stringify(id)}`)
  }
}

export interface Checkpoint {
  id: string
  hash: string
  message: string
  sessionId?: string
  tool?: string
  verifyStatus?: 'passed' | 'failed' | 'skipped'
  timestamp: string
}

// ── In-process mutex (replaces redis-client distributed lock) ────────
let _checkpointLock: Promise<unknown> = Promise.resolve()
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _checkpointLock
  let release!: () => void
  _checkpointLock = new Promise<void>((resolve) => { release = resolve })
  await prev
  try {
    return await fn()
  } finally {
    release()
  }
}

// ── Workspace root resolution ────────────────────────────────────────
let _workspaceRoot: string | null = null
export function setWorkspaceRoot(path: string): void {
  _workspaceRoot = path
}
export function getWorkspaceRoot(): string {
  if (_workspaceRoot) return _workspaceRoot
  const root = process.env.JARVIS_WORKSPACE_ROOT || join(process.cwd(), 'workspace')
  try { mkdirSync(root, { recursive: true }) } catch { /* ignore */ }
  _workspaceRoot = root
  return root
}

async function git(cmd: string, cwd: string) {
  return executeCommand(cmd, { cwd, timeout: 15_000, skipGuardrails: true })
}

/** Idempotently ensure the workspace root is a git repo. Returns the root. */
export async function ensureCheckpointRepo(): Promise<string> {
  const dir = getWorkspaceRoot()
  if (!existsSync(join(dir, '.git'))) {
    await git('git init -q', dir)
    await git('git config user.email "agent@jarvis.local"', dir)
    await git('git config user.name "JARVIS Agent"', dir)
    await git('git add -A', dir)
    await git('git commit -q --allow-empty -m "jarvis-checkpoint: workspace initialized"', dir)
  }
  return dir
}

/**
 * Stage + commit whatever changed in the workspace since the last
 * checkpoint. Returns null (no-op) if nothing changed.
 */
export async function createCheckpoint(opts: {
  label: string
  sessionId?: string
  tool?: string
  verifyStatus?: 'passed' | 'failed' | 'skipped'
}): Promise<Checkpoint | null> {
  return withLock(() => createCheckpointLocked(opts))
}

async function createCheckpointLocked(opts: {
  label: string
  sessionId?: string
  tool?: string
  verifyStatus?: 'passed' | 'failed' | 'skipped'
}): Promise<Checkpoint | null> {
  const dir = await ensureCheckpointRepo()
  await git('git add -A', dir)
  const status = await git('git status --porcelain', dir)
  if (!status.stdout.trim()) return null

  const id = crypto.randomUUID()
  const message = [
    `jarvis-checkpoint: ${opts.label}`,
    '',
    `Checkpoint-Id: ${id}`,
    opts.sessionId ? `Session-Id: ${opts.sessionId}` : null,
    opts.tool ? `Tool: ${opts.tool}` : null,
    opts.verifyStatus ? `Verify-Status: ${opts.verifyStatus}` : null,
  ].filter((l): l is string => l !== null).join('\n')

  // Write the message to a temp file rather than inlining it in the
  // shell command — avoids quoting/escaping bugs.
  const tmpDir = mkdtempSync(join(tmpdir(), 'jarvis-ckpt-'))
  const tmpFile = join(tmpDir, 'msg.txt')
  writeFileSync(tmpFile, message, 'utf8')

  const commit = await git(`git commit -q -F "${tmpFile}"`, dir)
  if (!commit.success) {
    logger.warn({ stderr: commit.stderr }, 'git-checkpoint: commit failed')
    return null
  }
  const hashRes = await git('git rev-parse HEAD', dir)
  const hash = hashRes.stdout.trim()
  await git(`git tag jarvis-checkpoint/${id} ${hash}`, dir)

  logger.debug({ id, hash: hash.slice(0, 10), tool: opts.tool }, 'git-checkpoint: created')

  return {
    id,
    hash,
    message: opts.label,
    sessionId: opts.sessionId,
    tool: opts.tool,
    verifyStatus: opts.verifyStatus,
    timestamp: new Date().toISOString(),
  }
}

/** List checkpoints, newest first. Optionally filtered to one session. */
export async function listCheckpoints(opts?: {
  sessionId?: string
  limit?: number
}): Promise<Checkpoint[]> {
  const dir = await ensureCheckpointRepo()
  const limit = Math.min(opts?.limit ?? 50, 500)
  // \x1f splits hash/date/body; \x1e splits commits.
  const res = await git(`git log --format='%H%x1f%aI%x1f%B%x1e' -n ${limit}`, dir)
  if (!res.success || !res.stdout.trim()) return []

  const checkpoints: Checkpoint[] = []
  for (const entry of res.stdout.split('\x1e')) {
    if (!entry.trim()) continue
    const [hash, date, body] = entry.split('\x1f')
    if (!body || !body.includes('jarvis-checkpoint:')) continue
    const idMatch = body.match(/Checkpoint-Id:\s*(\S+)/)
    if (!idMatch) continue
    const sessionMatch = body.match(/Session-Id:\s*(\S+)/)
    if (opts?.sessionId && sessionMatch?.[1] !== opts.sessionId) continue
    const toolMatch = body.match(/Tool:\s*(\S+)/)
    const verifyMatch = body.match(/Verify-Status:\s*(\S+)/)
    const labelMatch = body.match(/jarvis-checkpoint:\s*(.+)/)
    checkpoints.push({
      id: idMatch[1],
      hash: hash.trim(),
      message: labelMatch?.[1]?.trim() || '',
      sessionId: sessionMatch?.[1],
      tool: toolMatch?.[1],
      verifyStatus: verifyMatch?.[1] as Checkpoint['verifyStatus'],
      timestamp: (date || '').trim() || new Date().toISOString(),
    })
  }
  return checkpoints
}

/**
 * Roll the workspace back to a checkpoint. Destructive to the working
 * tree but not to history — every checkpoint's tag survives.
 */
export async function revertToCheckpoint(
  id: string,
): Promise<{ success: boolean; message: string; hash?: string }> {
  assertValidCheckpointId(id)
  const dir = await ensureCheckpointRepo()
  const tag = `jarvis-checkpoint/${id}`
  const check = await git(`git rev-parse ${tag}`, dir)
  if (!check.success) {
    return { success: false, message: `Checkpoint ${id} not found.` }
  }
  const hash = check.stdout.trim()
  const reset = await git(`git reset --hard ${hash}`, dir)
  if (!reset.success) {
    return { success: false, message: `Revert failed: ${reset.stderr}` }
  }
  await git('git clean -fd', dir)
  logger.info({ id, hash: hash.slice(0, 10) }, 'git-checkpoint: reverted')
  return { success: true, message: `Reverted to checkpoint ${id}.`, hash }
}

/** Discard (delete) a checkpoint tag — used by rollback-snapshot-cleanup cron. */
export async function discardSnapshot(id: string): Promise<{ success: boolean; message: string }> {
  assertValidCheckpointId(id)
  const dir = await ensureCheckpointRepo()
  const tag = `jarvis-checkpoint/${id}`
  const res = await git(`git tag -d ${tag}`, dir)
  if (!res.success) {
    return { success: false, message: `Tag ${tag} not found or already deleted.` }
  }
  return { success: true, message: `Discarded snapshot ${id}.` }
}
