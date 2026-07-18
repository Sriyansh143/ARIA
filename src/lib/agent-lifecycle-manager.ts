// =====================================================================
// agent-lifecycle-manager.ts -- Ephemeral agent worker pool + idle reaper.
// =====================================================================
// Pure TypeScript. No worker_threads required — uses an in-memory job
// queue. Agent "instances" (ephemeral worker pool entries) are tracked
// in-process; per-task metrics are persisted to MemoryItem so
// agent-analytics.ts can aggregate them.
//
// Lifecycle:
//   1. Orchestrator calls spawnAgent(role, task) → creates AgentInstance
//      record (in-memory) with status='spawning'
//   2. Queue processor picks up the job, sets status='working'
//   3. On completion, sets status='idle' + updates lastHeartbeat
//   4. Idle Reaper (every 5 min) checks for idle agents > 15 min
//      → terminates them + sets status='terminated'
// =====================================================================

import { db } from '@/lib/db'
import { quickChat } from '@/lib/llm'
import { randomUUID } from 'crypto'

const IDLE_TIMEOUT_MS = 15 * 60 * 1000  // 15 minutes
const REAPER_INTERVAL_MS = 5 * 60 * 1000  // 5 minutes
const METRIC_SCOPE = 'agent-metric'

interface AgentInstanceRecord {
  id: string
  role: string
  status: 'spawning' | 'working' | 'idle' | 'terminated'
  parentInstanceId: string | null
  lastHeartbeat: Date
  spawnedAt: Date
  terminatedAt: Date | null
  tasksCompleted: number
  tokensUsed: number
  task: string
  systemPrompt?: string
  model?: string
  tools?: string[]
}

interface AgentJob {
  instanceId: string
  role: string
  task: string
  systemPrompt?: string
  model?: string
  tools?: string[]
}

// In-memory job queue + instance registry. Could be replaced with a
// real queue (BullMQ, etc.) later — the public API stays the same.
const jobQueue: AgentJob[] = []
const instances = new Map<string, AgentInstanceRecord>()
let processing = false

// ─── Spawn an agent for a task ───────────────────────────────────────
export async function spawnAgent(opts: {
  role: string
  task: string
  parentInstanceId?: string
  systemPrompt?: string
  model?: string
  tools?: string[]
}): Promise<{ instanceId: string; status: string }> {
  const instanceId = randomUUID()
  const now = new Date()
  const rec: AgentInstanceRecord = {
    id: instanceId,
    role: opts.role,
    status: 'spawning',
    parentInstanceId: opts.parentInstanceId ?? null,
    lastHeartbeat: now,
    spawnedAt: now,
    terminatedAt: null,
    tasksCompleted: 0,
    tokensUsed: 0,
    task: opts.task,
    systemPrompt: opts.systemPrompt,
    model: opts.model,
    tools: opts.tools,
  }
  instances.set(instanceId, rec)

  const job: AgentJob = {
    instanceId,
    role: opts.role,
    task: opts.task,
    systemPrompt: opts.systemPrompt,
    model: opts.model,
    tools: opts.tools,
  }
  jobQueue.push(job)

  // Kick off processing (non-blocking).
  void processQueue()

  return { instanceId, status: 'spawning' }
}

// ─── Process the job queue ───────────────────────────────────────────
async function processQueue(): Promise<void> {
  if (processing) return
  processing = true
  try {
    while (jobQueue.length > 0) {
      const job = jobQueue.shift()
      if (!job) break

      const rec = instances.get(job.instanceId)
      if (!rec) continue

      try {
        rec.status = 'working'
        rec.lastHeartbeat = new Date()

        const result = await executeAgentTask(job)

        rec.status = 'idle'
        rec.lastHeartbeat = new Date()
        rec.tasksCompleted += 1
        rec.tokensUsed += result.tokensUsed

        // Persist a per-task metric row so agent-analytics can aggregate.
        await persistMetric({
          agentRole: job.role,
          success: result.success,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          durationMs: result.durationMs,
          errorType: result.success ? null : (result.error ?? 'unknown'),
        }).catch(() => {})

        console.log(
          `[lifecycle] agent ${job.instanceId} (${job.role}) completed: ${result.success ? 'success' : 'failed'}`,
        )
      } catch (err) {
        rec.status = 'terminated'
        rec.terminatedAt = new Date()
        console.error(
          `[lifecycle] agent ${job.instanceId} crashed:`,
          err instanceof Error ? err.message : String(err),
        )
      }
    }
  } finally {
    processing = false
  }
}

// ─── Persist a metric row to MemoryItem ──────────────────────────────
async function persistMetric(m: {
  agentRole: string
  success: boolean
  tokensIn: number
  tokensOut: number
  durationMs: number
  errorType: string | null
}): Promise<void> {
  const id = randomUUID()
  const value = JSON.stringify({
    id,
    agentRole: m.agentRole,
    success: m.success,
    tokensIn: m.tokensIn,
    tokensOut: m.tokensOut,
    durationMs: m.durationMs,
    errorType: m.errorType,
    ts: new Date().toISOString(),
  })
  try {
    await db.memoryItem.create({
      data: {
        scope: METRIC_SCOPE,
        key: `${m.agentRole}:${id}`,
        value,
        tags: JSON.stringify([`role:${m.agentRole}`, m.success ? 'success' : 'failure']),
      },
    })
  } catch (err) {
    console.warn(
      '[lifecycle] persistMetric failed:',
      err instanceof Error ? err.message : String(err),
    )
  }
}

// ─── Execute an agent task via the LLM ───────────────────────────────
async function executeAgentTask(job: AgentJob): Promise<{
  success: boolean
  result: string
  tokensUsed: number
  tokensIn: number
  tokensOut: number
  durationMs: number
  error?: string
}> {
  const start = Date.now()
  try {
    const content = await quickChat(job.task, job.systemPrompt)
    // Rough token estimate (4 chars ≈ 1 token).
    const tokensOut = Math.ceil(content.length / 4)
    const tokensIn = Math.ceil(job.task.length / 4)
    return {
      success: true,
      result: content,
      tokensUsed: tokensIn + tokensOut,
      tokensIn,
      tokensOut,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    return {
      success: false,
      result: '',
      tokensUsed: 0,
      tokensIn: 0,
      tokensOut: 0,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ─── Idle Reaper — kills agents idle > 15 minutes ────────────────────
export async function reapIdleAgents(): Promise<number> {
  const cutoff = new Date(Date.now() - IDLE_TIMEOUT_MS)
  let reaped = 0
  for (const rec of instances.values()) {
    if (rec.status === 'idle' && rec.lastHeartbeat < cutoff) {
      rec.status = 'terminated'
      rec.terminatedAt = new Date()
      reaped++
    }
  }
  if (reaped > 0) {
    console.log(`[lifecycle] reaped ${reaped} idle agent(s)`)
  }
  return reaped
}

// ─── Start the idle reaper cron ──────────────────────────────────────
let reaperStarted = false
export function startIdleReaper(): void {
  if (reaperStarted) return
  reaperStarted = true

  const reaperTimer = setInterval(async () => {
    try {
      await reapIdleAgents()
    } catch (err) {
      console.warn(
        '[lifecycle] reaper error:',
        err instanceof Error ? err.message : String(err),
      )
    }
  }, REAPER_INTERVAL_MS)
  // Don't keep the Node event loop alive just for the reaper.
  reaperTimer.unref()

  console.log('[lifecycle] idle reaper started (runs every 5 min, kills idle > 15 min)')
}

// ─── Get active agent count ──────────────────────────────────────────
export async function getActiveAgentCount(): Promise<number> {
  let n = 0
  for (const rec of instances.values()) {
    if (rec.status === 'spawning' || rec.status === 'working' || rec.status === 'idle') n++
  }
  return n
}

// ─── Get agent stats for dashboard ───────────────────────────────────
export async function getAgentStats(): Promise<{
  active: number
  idle: number
  working: number
  terminated: number
  totalTasksCompleted: number
  totalTokensUsed: number
}> {
  let active = 0
  let idle = 0
  let working = 0
  let terminated = 0
  let totalTasksCompleted = 0
  let totalTokensUsed = 0
  for (const rec of instances.values()) {
    if (rec.status === 'spawning' || rec.status === 'working' || rec.status === 'idle') active++
    if (rec.status === 'idle') idle++
    if (rec.status === 'working') working++
    if (rec.status === 'terminated') terminated++
    totalTasksCompleted += rec.tasksCompleted
    totalTokensUsed += rec.tokensUsed
  }
  return { active, idle, working, terminated, totalTasksCompleted, totalTokensUsed }
}

// ─── Instance accessors (useful for tests / dashboards) ──────────────
export function getInstance(instanceId: string): AgentInstanceRecord | undefined {
  return instances.get(instanceId)
}

export function listInstances(): AgentInstanceRecord[] {
  return Array.from(instances.values())
}

export function terminateInstance(instanceId: string): boolean {
  const rec = instances.get(instanceId)
  if (!rec) return false
  rec.status = 'terminated'
  rec.terminatedAt = new Date()
  return true
}
