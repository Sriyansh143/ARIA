// =====================================================================
// agent-collab.ts — Structured agent collaboration.
// =====================================================================
// agent-bus.ts gives raw primitives (send / broadcast / blackboard).
// This module layers a STRUCTURED protocol on top so multiple agents can
// collaborate the way Teamily AI's department-supervisor model does:
//
//   1. Capability discovery — agents register {capabilities}; others ask
//      "who can do X?" and get back matching agent ids.
//   2. Typed task handoff — a supervisor delegates a sub-task to a worker
//      with a typed contract (input schema, deadline, priority) and awaits
//      a typed result (or failure) via a correlation id.
//   3. Shared-plan negotiation — an agent proposes a plan; peers amend /
//      approve; the plan is versioned on the blackboard.
//   4. Supervisor-worker orchestration — decompose → assign → aggregate.
//   5. Agent lifecycle — spawn / heartbeat / status / terminate registry.
//   6. Conversation threading — messages carry a threadId so a delegation
//      keeps its own context across many turns.
//
// All state lives in-process (Map + blackboard). Single-node dev works
// with zero config.
// =====================================================================

import { randomUUID } from 'crypto'
import { sendToAgent, onAgentMessage, blackboard, type AgentMessage } from '@/lib/agent-bus'

const REGISTRY_TTL = 120 // seconds; agents must heartbeat within this window

// ── In-process handoff reply registry ────────────────────────────────
//
// Replaces the Redis pub/sub reply channel. When a supervisor delegates
// a task, it registers a Promise resolver keyed by corrId. When a worker
// completes the task (via serveHandoffs), it calls `replyHandoff(corrId,
// result)` which resolves the waiting promise. Timeouts are handled by
// the supervisor side.

type HandoffResolver = (result: unknown) => void
const handoffResolvers = new Map<string, HandoffResolver>()

function replyHandoff(corrId: string, result: unknown): void {
  const resolve = handoffResolvers.get(corrId)
  if (resolve) {
    handoffResolvers.delete(corrId)
    resolve(result)
  }
}

// ── 1. Capability discovery + lifecycle registry ────────────────────

export type AgentStatus = 'idle' | 'busy' | 'draining' | 'terminated'

export interface AgentRecord {
  agentId: string
  role: string
  capabilities: string[]
  status: AgentStatus
  orgId?: string
  lastHeartbeat: number
  spawnedAt: number
  meta?: Record<string, unknown>
}

const localRegistry = new Map<string, AgentRecord>()

async function readRegistry(): Promise<Record<string, AgentRecord>> {
  const out: Record<string, AgentRecord> = {}
  for (const [id, rec] of localRegistry) out[id] = rec
  return out
}

async function writeRecord(rec: AgentRecord): Promise<void> {
  localRegistry.set(rec.agentId, rec)
}

/** Register (spawn) an agent with its capabilities. */
export async function registerAgent(input: {
  agentId?: string
  role: string
  capabilities: string[]
  orgId?: string
  meta?: Record<string, unknown>
}): Promise<AgentRecord> {
  const now = Date.now()
  const rec: AgentRecord = {
    agentId: input.agentId ?? `agent_${randomUUID()}`,
    role: input.role,
    capabilities: input.capabilities,
    status: 'idle',
    orgId: input.orgId,
    lastHeartbeat: now,
    spawnedAt: now,
    meta: input.meta,
  }
  await writeRecord(rec)
  if (process.env.NODE_ENV !== 'production') {
    console.debug('[agent-collab] agent registered', {
      agentId: rec.agentId,
      role: rec.role,
      caps: rec.capabilities.length,
    })
  }
  return rec
}

/** Heartbeat + optional status update. Keeps the agent alive in the registry. */
export async function heartbeat(agentId: string, status?: AgentStatus): Promise<void> {
  const reg = await readRegistry()
  const rec = reg[agentId]
  if (!rec) return
  rec.lastHeartbeat = Date.now()
  if (status) rec.status = status
  await writeRecord(rec)
}

/** Terminate (deregister) an agent. */
export async function terminateAgent(agentId: string): Promise<void> {
  localRegistry.delete(agentId)
  if (process.env.NODE_ENV !== 'production') {
    console.debug('[agent-collab] agent terminated', { agentId })
  }
}

/** Find live agents matching a capability. Filters out stale heartbeats. */
export async function findCapableAgents(capability: string, orgId?: string): Promise<AgentRecord[]> {
  const reg = await readRegistry()
  const cutoff = Date.now() - REGISTRY_TTL * 1000
  return Object.values(reg).filter(
    (r) =>
      r.status !== 'terminated' &&
      r.lastHeartbeat >= cutoff &&
      r.capabilities.includes(capability) &&
      (orgId ? r.orgId === orgId : true),
  )
}

/** List all live agents (optionally scoped to an org). */
export async function listAgents(orgId?: string): Promise<AgentRecord[]> {
  const reg = await readRegistry()
  const cutoff = Date.now() - REGISTRY_TTL * 1000
  return Object.values(reg).filter(
    (r) => r.lastHeartbeat >= cutoff && (orgId ? r.orgId === orgId : true),
  )
}

// ── Find the best agent for a skill (capability + status + load) ────
//
// "findBestAgent by skill+status+load" — surfaces the most appropriate
// agent for a given capability. Prefers idle agents, then least-recently
// used (proxy for low load). Returns null if no capable agent is alive.

export async function findBestAgent(
  capability: string,
  opts?: { orgId?: string; preferStatus?: AgentStatus },
): Promise<AgentRecord | null> {
  const capable = await findCapableAgents(capability, opts?.orgId)
  if (capable.length === 0) return null
  const preferred = opts?.preferStatus ?? 'idle'
  // 1. Prefer agents with the preferred status (idle by default).
  const idle = capable.filter((a) => a.status === preferred)
  if (idle.length > 0) {
    idle.sort((a, b) => a.lastHeartbeat - b.lastHeartbeat) // least-recently-used first
    return idle[0]
  }
  // 2. Fall back to any agent, least-recently-used first.
  capable.sort((a, b) => a.lastHeartbeat - b.lastHeartbeat)
  return capable[0]
}

// ── 2. Typed task handoff (request/reply with correlation) ──────────

export interface HandoffContract<I = unknown> {
  capability: string          // what the worker must be able to do
  input: I                    // typed task input
  priority?: 'low' | 'normal' | 'high'
  deadlineMs?: number         // max time the worker may take
  threadId?: string           // conversation threading
}

export interface HandoffResult<O = unknown> {
  ok: boolean
  corrId: string
  output?: O
  error?: string
  workerId: string
  durationMs: number
}

/**
 * Delegate a sub-task to a specific worker (or auto-pick the best capable
 * one) and await a typed reply. Resolves with ok:false on timeout so the
 * supervisor can re-plan rather than hang forever.
 */
export async function delegateTask<I, O>(
  supervisorId: string,
  contract: HandoffContract<I>,
  opts?: { workerId?: string; orgId?: string; timeoutMs?: number },
): Promise<HandoffResult<O>> {
  const corrId = randomUUID()
  const timeoutMs = opts?.timeoutMs ?? contract.deadlineMs ?? 60_000
  const started = Date.now()

  // Pick a worker.
  let workerId = opts?.workerId
  if (!workerId) {
    const best = await findBestAgent(contract.capability, { orgId: opts?.orgId })
    if (!best) {
      return {
        ok: false,
        corrId,
        error: `no agent with capability "${contract.capability}"`,
        workerId: '',
        durationMs: 0,
      }
    }
    workerId = best.agentId
  }

  // Register a reply resolver BEFORE sending to avoid a race.
  const replyPromise = new Promise<HandoffResult<O>>((resolve) => {
    const timer = setTimeout(() => {
      if (handoffResolvers.delete(corrId)) {
        resolve({
          ok: false,
          corrId,
          error: 'handoff timed out',
          workerId: workerId!,
          durationMs: Date.now() - started,
        })
      }
    }, timeoutMs)
    // Make the timer non-blocking on the event loop.
    timer.unref?.()

    handoffResolvers.set(corrId, (raw) => {
      clearTimeout(timer)
      const r = raw as HandoffResult<O>
      resolve({ ...r, durationMs: Date.now() - started })
    })
  })

  // Send the handoff request to the worker's inbox.
  await sendToAgent(supervisorId, workerId, {
    kind: 'handoff-request',
    corrId,
    contract,
  }, 'handoff')

  return replyPromise
}

/**
 * Worker side: listen for handoff requests, run `executor`, and reply.
 * Returns an unsubscribe fn. The executor gets the typed input and must
 * return the typed output (or throw to signal failure).
 */
export async function serveHandoffs<I, O>(
  workerId: string,
  executor: (input: I, ctx: { corrId: string; from: string; contract: HandoffContract<I> }) => Promise<O>,
): Promise<() => Promise<void>> {
  return onAgentMessage(workerId, async (msg: AgentMessage) => {
    const body = msg.payload as { kind?: string; corrId?: string; contract?: HandoffContract<I> } | undefined
    if (!body || body.kind !== 'handoff-request') return
    const contract = body.contract
    if (!contract) return
    const corrId = body.corrId ?? ''
    if (!corrId) return
    const started = Date.now()
    await heartbeat(workerId, 'busy')
    let result: HandoffResult<O>
    try {
      const output = await executor(contract.input, { corrId, from: msg.from, contract })
      result = { ok: true, corrId, output, workerId, durationMs: Date.now() - started }
    } catch (err) {
      result = {
        ok: false,
        corrId,
        error: err instanceof Error ? err.message : String(err),
        workerId,
        durationMs: Date.now() - started,
      }
    }
    await heartbeat(workerId, 'idle')
    replyHandoff(corrId, result)
  })
}

// ── 3. Knowledge sharing ────────────────────────────────────────────
//
// An agent posts a knowledge artifact (text/JSON) to a shared namespace
// on the blackboard so any other agent can read it. Useful for passing
// learned facts, partial results, or context across handoffs.

export async function shareKnowledge(
  namespace: string,
  author: string,
  key: string,
  knowledge: unknown,
): Promise<void> {
  await blackboard.post(`knowledge:${namespace}`, key, knowledge, author)
}

export async function readKnowledge<T = unknown>(
  namespace: string,
  key: string,
): Promise<T | null> {
  const entry = await blackboard.read(`knowledge:${namespace}`, key)
  return (entry?.value as T) ?? null
}

export async function listKnowledge(namespace: string): Promise<Array<{ key: string; value: unknown; author: string; ts: number }>> {
  return blackboard.readAll(`knowledge:${namespace}`)
}

// ── 4. Shared-plan negotiation ──────────────────────────────────────

export interface PlanStep {
  id: string
  description: string
  capability?: string
  assignee?: string
  status: 'proposed' | 'approved' | 'rejected' | 'done'
}

export interface SharedPlan {
  planId: string
  version: number
  goal: string
  steps: PlanStep[]
  proposedBy: string
  approvedBy: string[]
  updatedAt: number
}

const PLAN_NS = (planId: string) => `plan:${planId}`

/** Propose a new shared plan. Persisted + announced on the blackboard. */
export async function proposePlan(
  namespace: string,
  proposedBy: string,
  goal: string,
  steps: Omit<PlanStep, 'status'>[],
): Promise<SharedPlan> {
  const plan: SharedPlan = {
    planId: randomUUID(),
    version: 1,
    goal,
    steps: steps.map((s) => ({ ...s, status: 'proposed' })),
    proposedBy,
    approvedBy: [],
    updatedAt: Date.now(),
  }
  // Persist via blackboard (in-process, lives for the lifetime of the Node process).
  await blackboard.post(PLAN_NS(plan.planId), 'plan', plan, proposedBy)
  // Also announce to the namespace so watchers see it.
  await blackboard.post(namespace, `plan:${plan.planId}`, plan, proposedBy)
  return plan
}

/** Read a plan by id. */
export async function getPlan(planId: string): Promise<SharedPlan | null> {
  const entry = await blackboard.read(PLAN_NS(planId), 'plan')
  return (entry?.value as SharedPlan) ?? null
}

/** Amend a plan (adds/updates steps) and bump the version. */
export async function amendPlan(
  namespace: string,
  planId: string,
  editor: string,
  mutate: (plan: SharedPlan) => void,
): Promise<SharedPlan | null> {
  const plan = await getPlan(planId)
  if (!plan) return null
  mutate(plan)
  plan.version += 1
  plan.updatedAt = Date.now()
  await blackboard.post(PLAN_NS(planId), 'plan', plan, editor)
  await blackboard.post(namespace, `plan:${planId}`, plan, editor)
  return plan
}

/** Approve a plan; when all listed reviewers approve, mark steps approved. */
export async function approvePlan(
  namespace: string,
  planId: string,
  approver: string,
  requiredApprovers: string[],
): Promise<SharedPlan | null> {
  return amendPlan(namespace, planId, approver, (plan) => {
    if (!plan.approvedBy.includes(approver)) plan.approvedBy.push(approver)
    const allApproved = requiredApprovers.every((r) => plan.approvedBy.includes(r))
    if (allApproved) {
      plan.steps.forEach((s) => {
        if (s.status === 'proposed') s.status = 'approved'
      })
    }
  })
}

// ── 5. Supervisor-worker orchestration ──────────────────────────────

export interface SupervisorResult<O = unknown> {
  goal: string
  planId: string
  results: Array<{ stepId: string; capability?: string; result: HandoffResult<O> }>
  succeeded: number
  failed: number
}

/**
 * Decompose a goal into steps, delegate each to a capable worker, and
 * aggregate the results. Steps without a capability are skipped (they are
 * assumed to be supervisor-local bookkeeping).
 */
export async function runSupervisor<I, O>(
  supervisorId: string,
  namespace: string,
  goal: string,
  steps: Array<{ id: string; description: string; capability?: string; input?: I }>,
  opts?: { orgId?: string; timeoutMs?: number },
): Promise<SupervisorResult<O>> {
  const plan = await proposePlan(
    namespace,
    supervisorId,
    goal,
    steps.map((s) => ({ id: s.id, description: s.description, capability: s.capability })),
  )

  const results: SupervisorResult<O>['results'] = []
  let succeeded = 0
  let failed = 0

  for (const step of steps) {
    if (!step.capability) continue
    const r = await delegateTask<I, O>(
      supervisorId,
      { capability: step.capability, input: step.input as I, threadId: plan.planId },
      { orgId: opts?.orgId, timeoutMs: opts?.timeoutMs },
    )
    results.push({ stepId: step.id, capability: step.capability, result: r })
    if (r.ok) succeeded++
    else failed++
    await amendPlan(namespace, plan.planId, supervisorId, (p) => {
      const ps = p.steps.find((x) => x.id === step.id)
      if (ps) ps.status = r.ok ? 'done' : 'rejected'
    })
  }

  return { goal, planId: plan.planId, results, succeeded, failed }
}

// ── 6. Conversation threading helper ────────────────────────────────

export interface ThreadMessage {
  threadId: string
  from: string
  text: string
  ts: number
}

const THREAD_NS = (threadId: string) => `thread:${threadId}`

/** Append a message to a collaboration thread (capped history). */
export async function appendToThread(threadId: string, from: string, text: string): Promise<void> {
  const msg: ThreadMessage = { threadId, from, text, ts: Date.now() }
  // Use the blackboard with a unique key per message so we keep history.
  await blackboard.post(THREAD_NS(threadId), `${msg.ts}`, msg, from)
  // Cap to last 200 messages: read all, delete the oldest if over cap.
  const all = await blackboard.readAll(THREAD_NS(threadId))
  if (all.length > 200) {
    const toRemove = all.slice(0, all.length - 200)
    for (const e of toRemove) {
      await blackboard.delete(THREAD_NS(threadId), e.key)
    }
  }
}

/** Read the full thread history. */
export async function readThread(threadId: string): Promise<ThreadMessage[]> {
  const entries = await blackboard.readAll(THREAD_NS(threadId))
  return entries.map((e) => e.value as ThreadMessage).sort((a, b) => a.ts - b.ts)
}

// ── Auto-delegate helper ────────────────────────────────────────────
//
// Convenience wrapper around delegateTask that picks the best capable
// agent automatically and resolves to the output (or throws on failure
// / timeout). Useful for callers that don't need the full HandoffResult.

export async function autoDelegate<I, O>(
  supervisorId: string,
  contract: HandoffContract<I>,
  opts?: { orgId?: string; timeoutMs?: number },
): Promise<O> {
  const result = await delegateTask<I, O>(supervisorId, contract, opts)
  if (!result.ok) {
    throw new Error(result.error || 'autoDelegate failed')
  }
  return result.output as O
}
