// =====================================================================
// guardrails.ts — Input/output safety filters + HITL approval queue.
// =====================================================================
// Adapted for v10:
//   • Removed `redis-client` dependency — HITL approvals are now backed
//     by an in-memory Map (single-instance, which is our deployment
//     model). The public API (`registerPendingApproval`,
//     `resolveApproval`, `listPendingApprovals`) is preserved.
//   • Removed `telegram-broadcaster.sendToOwner` — approvals surface as
//     a Notification row that the dashboard renders.
//   • Removed `timer-util.unrefTimer` — we call `.unref()` directly on
//     Node.js timers.
//   • Removed `logger` — replaced with console.
//
// The fail-closed guardrail logic (DANGEROUS_PATTERNS, WHITELISTED_PREFIXES,
// PROTECTED_PATHS, DESTRUCTIVE_PATTERNS) is unchanged from the original
// SEC-4-H3 audit.
// =====================================================================

import { db } from '@/lib/db'

export interface PendingApproval {
  id: string
  command: string
  reason: string
  createdAt: number
  expiresAt: number
  status: 'pending' | 'approved' | 'rejected' | 'timeout'
  resolve?: (decision: { approved: boolean; timeout: boolean }) => void
}

// In-memory HITL approval queue. (Originally Redis-backed for multi-
// instance correctness; we run single-instance so a local Map is enough.)
const pendingApprovals = new Map<string, PendingApproval>()
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const APPROVAL_POLL_MS = 2_000

type SerializablePending = Omit<PendingApproval, 'resolve'>

/** Register a pending approval. */
export async function registerPendingApproval(
  a: PendingApproval,
): Promise<void> {
  pendingApprovals.set(a.id, a)
}

/**
 * Resolve a pending approval (called by the dashboard's
 * POST /api/approvals endpoint or any UI callback). Resolves the paused
 * promise if we own it.
 */
export async function resolveApproval(
  id: string,
  decision: 'approved' | 'rejected',
): Promise<boolean> {
  const local = pendingApprovals.get(id)
  if (local && local.status === 'pending') {
    local.status = decision
    local.resolve?.({ approved: decision === 'approved', timeout: false })
    pendingApprovals.delete(id)
    return true
  }
  return false
}

/** List all pending approvals (for the dashboard UI). */
export async function listPendingApprovals(): Promise<SerializablePending[]> {
  const now = Date.now()
  const out: SerializablePending[] = []
  for (const a of pendingApprovals.values()) {
    if (a.status === 'pending' && a.expiresAt > now) {
      const { resolve: _resolve, ...rest } = a
      void _resolve
      out.push(rest)
    }
  }
  return out
}

// ─── Guardrail pattern tables ────────────────────────────────────────
const DANGEROUS_PATTERNS: RegExp[] = [
  // Destructive filesystem operations
  /rm\s+-rf\s+\//i,
  /rm\s+-rf\s+\~/i,
  /del\s+\/[sfq]\s+C:\\Windows/i,
  /format\s+[A-Z]:/i,
  /diskpart/i,
  /reg\s+delete\s+HKLM/i,
  /\.ssh\//i,
  /\.env\b/i,
  /\.aws\//i,
  /id_rsa/i,
  /nmap\s+/i,
  // Download-and-execute patterns — ALL variants blocked.
  /curl\s+.*\|\s*(sh|bash|zsh|fish|dash|ksh)\b/i,
  /wget\s+.*\|\s*(sh|bash|zsh|fish|dash|ksh)\b/i,
  /curl\s+.*\|\s*sudo\s+(sh|bash|zsh)/i,
  /wget\s+.*\|\s*sudo\s+(sh|bash|zsh)/i,
  /curl\s+.*\|\s*python/i,
  /wget\s+.*\|\s*python/i,
  /curl\s+.*\|\s*node/i,
  /wget\s+.*\|\s*node/i,
  /curl\s+.*\|\s*perl/i,
  /wget\s+.*\|\s*perl/i,
  /curl\s+.*\|\s*ruby/i,
  /wget\s+.*\|\s*ruby/i,
  /curl\s+.*\|\s*php/i,
  /wget\s+.*\|\s*php/i,
  // Bind/reverse shells
  /ncat\s+.*-e\s+/i,
  /nc\s+.*-e\s+/i,
  /socat\s+.*EXEC:/i,
  /bash\s+-i\s+>&/i,
  /sh\s+-i\s+>&/i,
  /0\.0\.0\.0\s+\d+.*-e\s+/i,
  // Interpreter -c/-e/-n with arbitrary code (RCE primitives)
  /python\d?\s+-c\s+/i,
  /python\d?\s+-c\s*['"]/i,
  /node\s+-e\s+/i,
  /node\s+-e\s*['"]/i,
  /node\s+--eval\s+/i,
  /perl\s+-e\s+/i,
  /perl\s+-e\s*['"]/i,
  /ruby\s+-e\s+/i,
  /ruby\s+-e\s*['"]/i,
  /php\s+-r\s+/i,
  /php\s+-r\s*['"]/i,
  /powershell\s+-Command\s+/i,
  /powershell\s+-EncodedCommand\s+/i,
  /pwsh\s+-Command\s+/i,
  /pwsh\s+-EncodedCommand\s+/i,
  /Invoke-Expression/i,
  /Invoke-WebRequest\s+.*\|\s*Invoke-Expression/i,
  /iex\s*\(/i,
  // Base64-decoded execution (common obfuscation)
  /base64\s+-d\s*\|\s*(sh|bash|python|node|perl)/i,
  /echo\s+.*\|\s*base64\s+-d\s*\|\s*(sh|bash|python|node)/i,
]
const WHITELISTED_PREFIXES = [
  'git status',
  'git log',
  'git diff',
  'git branch',
  'git show',
  'ls',
  'dir',
  'cat',
  'echo',
  'pwd',
  'hostname',
  'whoami',
  'date',
  'ollama list',
  'ollama ps',
  'ollama show',
  'node --version',
  'npm --version',
  'python --version',
  'uname',
  'df',
  'free',
  'uptime',
  'top -n 1',
]
const PROTECTED_PATHS: RegExp[] = [
  /^\/etc\//,
  /^C:\\Windows\System32/i,
  /\.ssh/i,
  /\.aws/i,
  /\.env/i,
  /\.git\//i,
  /id_rsa/i,
  /\/root\//i,
]
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /rm\s+/i,
  /del\s+/i,
  /rmdir\s+/i,
  /mv\s+/i,
  /chmod\s+/i,
  /chown\s+/i,
  /npm\s+install/i,
  /pip\s+install/i,
  /apt\s+install/i,
  /brew\s+install/i,
  /git\s+push/i,
  /git\s+reset/i,
  /git\s+checkout/i,
  /git\s+merge/i,
  /docker\s+/i,
  /kubectl\s+/i,
  /taskkill\s+/i,
  /kill\s+/i,
  /killall\s+/i,
  /pkill\s+/i,
  /shutdown\s+/i,
  /reboot\s+/i,
  /halt\s+/i,
  /reg\s+add/i,
  /reg\s+import/i,
  /Start-Process/i,
  /Set-Content/i,
  /Out-File/i,
  /Add-Content/i,
  /tee\s+/i,
  /dd\s+/i,
  /mkfs/i,
  /mount\s+/i,
  /umount\s+/i,
]

export type ActionSafety = 'safe' | 'requires-approval' | 'blocked'
export interface GuardrailResult {
  safety: ActionSafety
  reason: string
  command: string
  timestamp: string
}

export function checkCommand(command: string): GuardrailResult {
  const trimmed = command.trim()
  const timestamp = new Date().toISOString()

  // 1. BLOCKED — always refused, no approval possible.
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        safety: 'blocked',
        reason: `Dangerous pattern: ${pattern.source}`,
        command: trimmed,
        timestamp,
      }
    }
  }

  // 2. Whitelist check — but only grant immunity if NO shell metacharacters
  // AND NO protected paths are present.
  let whitelisted = false
  for (const prefix of WHITELISTED_PREFIXES) {
    if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
      whitelisted = true
      break
    }
  }
  // Check for shell metacharacters that could chain commands.
  const hasShellMeta = /[;|&`$()]|\$\(|&&|\|\||>\s|<\s/.test(trimmed)
  if (whitelisted && !hasShellMeta) {
    // Still check protected paths — `cat .env` should require approval.
    for (const pattern of PROTECTED_PATHS) {
      if (pattern.test(trimmed)) {
        return {
          safety: 'requires-approval',
          reason: `Protected path: ${pattern.source}`,
          command: trimmed,
          timestamp,
        }
      }
    }
    return { safety: 'safe', reason: 'Whitelisted', command: trimmed, timestamp }
  }

  // 3. Destructive patterns → require approval.
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        safety: 'requires-approval',
        reason: `Destructive: ${pattern.source}`,
        command: trimmed,
        timestamp,
      }
    }
  }

  // 4. Protected paths → require approval.
  for (const pattern of PROTECTED_PATHS) {
    if (pattern.test(trimmed)) {
      return {
        safety: 'requires-approval',
        reason: `Protected path: ${pattern.source}`,
        command: trimmed,
        timestamp,
      }
    }
  }

  // 5. If whitelisted but had shell metacharacters, require approval.
  if (whitelisted) {
    return {
      safety: 'requires-approval',
      reason: 'Whitelisted command with shell metacharacters',
      command: trimmed,
      timestamp,
    }
  }

  // SEC-4-H3: fail-closed — unknown commands require approval. Exception:
  // single-token read-only commands like `ls`, `date`, `pwd` are still safe.
  const singleToken = trimmed.split(/\s+/).filter(Boolean)
  const SAFE_SINGLE_TOKENS = new Set([
    'ls',
    'dir',
    'pwd',
    'date',
    'hostname',
    'whoami',
    'uname',
    'uptime',
    'free',
    'df',
    'top',
    'ps',
    'env',
    'id',
    'groups',
    'arch',
    'nproc',
  ])
  if (
    singleToken.length === 1 &&
    SAFE_SINGLE_TOKENS.has(singleToken[0].toLowerCase())
  ) {
    return {
      safety: 'safe',
      reason: 'Safe single-token command',
      command: trimmed,
      timestamp,
    }
  }
  return {
    safety: 'requires-approval',
    reason: 'Unknown command — default requires approval (SEC-4-H3 fail-closed)',
    command: trimmed,
    timestamp,
  }
}

// ─── HITL approval request ──────────────────────────────────────────
export async function requestApproval(
  command: string,
  reason: string,
  context?: string,
): Promise<{ approved: boolean; timeout: boolean }> {
  const id = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  const now = Date.now()
  const approval: PendingApproval = {
    id,
    command,
    reason,
    createdAt: now,
    expiresAt: now + APPROVAL_TIMEOUT_MS,
    status: 'pending',
  }

  const decisionPromise = new Promise<{ approved: boolean; timeout: boolean }>(
    (resolve) => {
      approval.resolve = resolve
    },
  )
  await registerPendingApproval(approval)

  // Surface the pending approval via Notification so the dashboard can
  // show it (originally sent as a Telegram message with inline buttons).
  try {
    await db.notification.create({
      data: {
        type: 'warn',
        title: 'Approval Required',
        message: `Command: ${command.slice(0, 120)}\nReason: ${reason}${
          context ? `\nContext: ${context.slice(0, 120)}` : ''
        }\nApprove via /api/approvals within 5 min`,
        read: false,
      },
    })
    console.log(
      `[guardrails] approval requested: id=${id} cmd=${command.slice(0, 80)}`,
    )
  } catch (err) {
    console.warn(
      `[guardrails] failed to record approval notification: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<{ approved: boolean; timeout: boolean }>(
    (resolve) => {
      timeoutHandle = setTimeout(() => {
        const a = pendingApprovals.get(id)
        if (a && a.status === 'pending') {
          a.status = 'timeout'
          pendingApprovals.delete(id)
        }
        resolve({ approved: false, timeout: true })
      }, APPROVAL_TIMEOUT_MS)
      // unref so the timer doesn't hold the event loop alive.
      timeoutHandle?.unref?.()
    },
  )

  // Periodically clean up expired entries while waiting.
  const cleanup = setInterval(() => {
    for (const [k, v] of pendingApprovals) {
      if (v.expiresAt < Date.now() && v.status === 'pending') {
        v.status = 'timeout'
        v.resolve?.({ approved: false, timeout: true })
        pendingApprovals.delete(k)
      }
    }
  }, APPROVAL_POLL_MS)
  cleanup.unref?.()

  try {
    return await Promise.race([decisionPromise, timeoutPromise])
  } finally {
    clearInterval(cleanup)
    if (timeoutHandle) clearTimeout(timeoutHandle)
    pendingApprovals.delete(id)
  }
}

export function checkPlan(steps: string[]): {
  safe: string[]
  requireApproval: string[]
  blocked: string[]
} {
  const safe: string[] = []
  const requireApproval: string[] = []
  const blocked: string[] = []
  for (const step of steps) {
    const r = checkCommand(step)
    if (r.safety === 'safe') safe.push(step)
    else if (r.safety === 'requires-approval') requireApproval.push(step)
    else blocked.push(step)
  }
  return { safe, requireApproval, blocked }
}

export const SANDBOX_CONFIG = {
  allowedDirs: [
    'download/',
    'download/artifacts/',
    'logs/',
    'tmp/',
    'src/',
    'scripts/',
    'prisma/',
    'public/',
  ],
  forbiddenDirs: [
    '.ssh/',
    '.aws/',
    '.env',
    '.env.local',
    'node_modules/',
    '.next/',
    '.git/',
  ],
  maxExecutionTime: 30_000,
  maxOutputSize: 1_000_000,
}
