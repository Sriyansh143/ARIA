/**
 * AutoGPT-inspired trigger system.
 * Triggers fire tasks automatically based on time, external HTTP calls,
 * file system changes, or internal events.
 *
 * Pattern #10 from docs/OPEN-SOURCE-RESEARCH.md — AutoGPT-style task triggers.
 *
 * Four trigger types are supported:
 *   - cron    : time-based, reuses the existing 'every:Nm|Nh|Ns' / 'daily:HH:MM'
 *               schedule expressions already understood by the scheduler.
 *   - webhook : external HTTP POST fires the task at /api/webhooks/<path>.
 *   - file    : polls a file path on each scheduler tick and fires when mtime
 *               changes (no persistent watchers — keeps the polling model).
 *   - event   : fired by the in-process event bus (see src/lib/event-bus.ts).
 *
 * Trigger configs are persisted as MemoryItem rows with scope='trigger' and
 * key=`trigger:<type>:<identifier>` (identifier = schedule / path / path / eventName
 * depending on the trigger type).
 */

export type TriggerType = 'cron' | 'webhook' | 'file' | 'event'

export interface CronTrigger {
  type: 'cron'
  /** Schedule expression: 'every:Nm', 'every:Nh', 'every:Ns', or 'daily:HH:MM' */
  schedule: string
}

export interface WebhookTrigger {
  type: 'webhook'
  /** Unique webhook path, e.g. 'github-push' → fires at /api/webhooks/github-push */
  path: string
  /** Optional secret for HMAC verification (sha256 of body) */
  secret?: string
}

export interface FileTrigger {
  type: 'file'
  /** Absolute path or glob pattern to watch */
  path: string
  /** Events: 'create' | 'modify' | 'delete' */
  events: string[]
}

export interface EventTrigger {
  type: 'event'
  /** Event name to listen for, e.g. 'task.completed', 'agent.error' */
  eventName: string
}

export type Trigger = CronTrigger | WebhookTrigger | FileTrigger | EventTrigger

export interface TriggerConfig {
  trigger: Trigger
  /** Task to fire when the trigger fires */
  taskPrompt: string
  /** Agent to assign the task to */
  agentId?: string
  /** Whether this trigger is enabled */
  enabled: boolean
  /** Last time this trigger fired (ISO string) */
  lastFired?: string
  /** Number of times this trigger has fired */
  fireCount: number
}

/** Validate a trigger config. Returns {valid, errors}. */
export function validateTriggerConfig(obj: any): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!obj || typeof obj !== 'object') return { valid: false, errors: ['Config required'] }
  if (!obj.trigger || typeof obj.trigger !== 'object') {
    errors.push('trigger required')
    return { valid: false, errors }
  }
  const t = obj.trigger
  if (!['cron', 'webhook', 'file', 'event'].includes(t.type)) {
    errors.push(`trigger.type must be cron|webhook|file|event (got ${t.type})`)
    return { valid: false, errors }
  }
  if (t.type === 'cron' && !t.schedule) errors.push('cron trigger requires schedule')
  if (t.type === 'webhook' && !t.path) errors.push('webhook trigger requires path')
  if (t.type === 'webhook' && t.path && !/^[a-z0-9-]+$/.test(t.path))
    errors.push('webhook path must be kebab-case')
  if (t.type === 'file' && !t.path) errors.push('file trigger requires path')
  if (t.type === 'file' && t.events && !Array.isArray(t.events))
    errors.push('file trigger events must be array')
  if (t.type === 'event' && !t.eventName) errors.push('event trigger requires eventName')
  if (!obj.taskPrompt || typeof obj.taskPrompt !== 'string') errors.push('taskPrompt required')
  return { valid: errors.length === 0, errors }
}

/**
 * Check if a cron schedule is due. Returns true if it should fire now.
 *
 * For `every:Nm|Nh|Ns` — fires when (now - lastFired) >= N units.
 * For `daily:HH:MM`  — fires only in the 60s window when the clock hits HH:MM,
 *                       once per day (subsequent ticks in the same minute are
 *                       suppressed by comparing lastFired's date).
 */
export function isCronDue(schedule: string, lastFired?: string): boolean {
  const now = Date.now()
  const last = lastFired ? new Date(lastFired).getTime() : 0

  const everyMatch = schedule.match(/^every:(\d+)([mhs])$/)
  if (everyMatch) {
    const n = parseInt(everyMatch[1])
    const unit = everyMatch[2]
    const ms =
      unit === 's' ? n * 1000 : unit === 'm' ? n * 60_000 : n * 3_600_000
    return now - last >= ms
  }

  const dailyMatch = schedule.match(/^daily:(\d{2}):(\d{2})$/)
  if (dailyMatch) {
    const h = parseInt(dailyMatch[1])
    const m = parseInt(dailyMatch[2])
    const now2 = new Date(now)
    // Check if current time matches HH:MM (within 60s window) and not already fired today.
    if (now2.getHours() === h && now2.getMinutes() === m) {
      if (!lastFired) return true
      const lastDate = new Date(last)
      return lastDate.toDateString() !== now2.toDateString()
    }
    return false
  }

  return false
}

/**
 * Compute a stable identifier for a trigger — used to build its MemoryItem key.
 * Returns a kebab-safe string derived from the trigger's distinguishing field.
 */
export function triggerIdentifier(trigger: Trigger): string {
  switch (trigger.type) {
    case 'cron':
      // 'every:30m' → 'every-30m'
      return trigger.schedule.replace(/[^a-z0-9]+/gi, '-')
    case 'webhook':
      return trigger.path
    case 'file':
      // '/var/log/syslog' → 'var-log-syslog'
      return trigger.path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
    case 'event':
      // 'task.completed' → 'task-completed'
      return trigger.eventName.replace(/[^a-z0-9]+/gi, '-')
  }
}

/** Build the MemoryItem key for a trigger config. */
export function triggerKey(config: TriggerConfig): string {
  return `trigger:${config.trigger.type}:${triggerIdentifier(config.trigger)}`
}
