// =====================================================================
// autonomous-watchdog.ts — Kill-switch + risk gate for autonomous actions.
// =====================================================================
// Phase 6.4 #18. Monitors every autonomous action before it executes.
// If the action exceeds a risk threshold (cost, blast-radius, frequency,
// or explicit kill-switch flag), the watchdog blocks it.
//
// Risk model (checkRisk):
//   - kill-switch armed     → block all
//   - high cost (>$5 LLM)   → block (warn caller to use cheaper model)
//   - destructive action    → require explicit approval tag
//   - rate-limit exceeded   → block (>100 autonomous actions/min)
//
// killSwitch(): arms the kill-switch (only the CFO/owner role should).
//
// Adapted for v10: the original audit-logged to `prisma.autonomousAction`
// which doesn't exist in our schema. We log to `db.notification` instead
// (same intent, different model). The in-memory risk gate is unchanged.
//
// Public API:
//   checkRisk(action): { safe, reason? }
//   killSwitch(arm?):  { armed, at, by? }
//   isArmed():         boolean
//   getState():        KillSwitchState
// =====================================================================

import { db } from '@/lib/db'

const ACTION_RATE_LIMIT_PER_MIN = 100
const COST_THRESHOLD_USD = 5
const DESTRUCTIVE_ACTIONS = [
  'delete',
  'drop',
  'truncate',
  'rm -rf',
  'format',
  'reset-db',
  'wipe',
  'factory-reset',
]

interface KillSwitchState {
  armed: boolean
  at: string
  by?: string
  reason?: string
}

let switchState: KillSwitchState = { armed: false, at: new Date().toISOString() }

// Track recent action timestamps for rate-limiting.
const recentActions: number[] = []

export interface AutonomousActionInput {
  type: string
  prompt?: string
  estimatedCostUsd?: number
  agentRole?: string
  requiresApproval?: boolean
  blastRadius?: 'low' | 'medium' | 'high'
  metadata?: Record<string, unknown>
}

export interface RiskVerdict {
  safe: boolean
  reason?: string
  category?: 'kill-switch' | 'cost' | 'destructive' | 'rate-limit' | 'ok'
}

// ─── checkRisk ───────────────────────────────────────────────────────
export function checkRisk(action: AutonomousActionInput): RiskVerdict {
  // 1. Kill-switch — blocks EVERYTHING
  if (switchState.armed) {
    return {
      safe: false,
      reason: `Kill-switch armed at ${switchState.at}. All autonomous actions blocked.`,
      category: 'kill-switch',
    }
  }

  // 2. Destructive action — require explicit approval flag
  const promptLower = (action.prompt || '').toLowerCase()
  const typeLower = (action.type || '').toLowerCase()
  for (const d of DESTRUCTIVE_ACTIONS) {
    if (promptLower.includes(d) || typeLower.includes(d)) {
      if (!action.requiresApproval) {
        return {
          safe: false,
          reason: `Destructive keyword "${d}" detected — requires explicit approval (requiresApproval=true)`,
          category: 'destructive',
        }
      }
    }
  }
  if (action.blastRadius === 'high' && !action.requiresApproval) {
    return {
      safe: false,
      reason: 'High blast-radius action requires explicit approval',
      category: 'destructive',
    }
  }

  // 3. Cost guardrail
  if (action.estimatedCostUsd && action.estimatedCostUsd > COST_THRESHOLD_USD) {
    return {
      safe: false,
      reason: `Estimated cost $${action.estimatedCostUsd} exceeds $${COST_THRESHOLD_USD} threshold`,
      category: 'cost',
    }
  }

  // 4. Rate limit
  const now = Date.now()
  while (recentActions.length > 0 && now - recentActions[0] > 60_000) recentActions.shift()
  if (recentActions.length >= ACTION_RATE_LIMIT_PER_MIN) {
    return {
      safe: false,
      reason: `Rate limit: ${recentActions.length} autonomous actions in the last 60s (limit ${ACTION_RATE_LIMIT_PER_MIN})`,
      category: 'rate-limit',
    }
  }
  recentActions.push(now)

  return { safe: true, category: 'ok' }
}

// ─── killSwitch ──────────────────────────────────────────────────────
export function killSwitch(
  arm = true,
  by?: string,
  reason?: string,
): KillSwitchState {
  switchState = {
    armed: arm,
    at: new Date().toISOString(),
    by,
    reason,
  }
  // Log to Notification for audit trail (fire-and-forget).
  db.notification
    .create({
      data: {
        type: arm ? 'error' : 'success',
        title: `Kill-switch ${arm ? 'ARMED' : 'DISARMED'}`,
        message: `By ${by || 'system'}${reason ? `: ${reason}` : ''}`,
        read: false,
      },
    })
    .catch(() => {})
  console.warn(
    `[autonomous-watchdog] kill-switch ${arm ? 'ARMED' : 'DISARMED'} by ${by || 'system'}${
      reason ? `: ${reason}` : ''
    }`,
  )
  return switchState
}

// ─── isArmed ─────────────────────────────────────────────────────────
export function isArmed(): boolean {
  return switchState.armed
}

// ─── getState ────────────────────────────────────────────────────────
export function getState(): KillSwitchState {
  return { ...switchState }
}
