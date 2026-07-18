// =====================================================================
// workflow-engine.ts — Visual workflow engine.
// Supports: drag-and-drop node definitions, templates, conditional
// branching, parallel execution paths, replay/debugging.
// =====================================================================
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'

export interface WorkflowNode {
  id: string
  type: 'prompt' | 'agent' | 'condition' | 'parallel' | 'action' | 'output'
  label: string
  config: Record<string, unknown>
  next?: string[]        // for branching: multiple next nodes
  condition?: string     // for condition nodes: JS expression
}

export interface WorkflowEdge {
  from: string
  to: string
  label?: string
}

export interface Workflow {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  entryNode: string
}

// ── Workflow templates ──
export const WORKFLOW_TEMPLATES: Workflow[] = [
  {
    id: 'tpl-code-review',
    name: 'Code Review',
    description: 'Automated code review: analyze → review → report',
    entryNode: 'analyze',
    nodes: [
      { id: 'analyze', type: 'agent', label: 'Analyze Code', config: { agent: 'Code-Specialist', action: 'analyze' }, next: ['review'] },
      { id: 'review', type: 'agent', label: 'Review', config: { agent: 'Quality-Reviewer', action: 'review' }, next: ['report'] },
      { id: 'report', type: 'output', label: 'Generate Report', config: {} },
    ],
    edges: [{ from: 'analyze', to: 'review' }, { from: 'review', to: 'report' }],
  },
  {
    id: 'tpl-bug-fix',
    name: 'Bug Fix',
    description: 'Reproduce → diagnose → fix → test',
    entryNode: 'reproduce',
    nodes: [
      { id: 'reproduce', type: 'agent', label: 'Reproduce Bug', config: { agent: 'QA-Tester' }, next: ['diagnose'] },
      { id: 'diagnose', type: 'agent', label: 'Diagnose', config: { agent: 'Backend-Architect' }, next: ['fix'] },
      { id: 'fix', type: 'agent', label: 'Apply Fix', config: { agent: 'Code-Specialist' }, next: ['test'] },
      { id: 'test', type: 'agent', label: 'Verify Fix', config: { agent: 'QA-Tester' }, next: ['done'] },
      { id: 'done', type: 'output', label: 'Done', config: {} },
    ],
    edges: [{ from: 'reproduce', to: 'diagnose' }, { from: 'diagnose', to: 'fix' }, { from: 'fix', to: 'test' }, { from: 'test', to: 'done' }],
  },
  {
    id: 'tpl-feature-dev',
    name: 'Feature Development',
    description: 'Spec → design → implement → test → deploy',
    entryNode: 'spec',
    nodes: [
      { id: 'spec', type: 'agent', label: 'Write Spec', config: { agent: 'Product-Manager' }, next: ['design'] },
      { id: 'design', type: 'agent', label: 'Design', config: { agent: 'Backend-Architect' }, next: ['implement'] },
      { id: 'implement', type: 'agent', label: 'Implement', config: { agent: 'Code-Specialist' }, next: ['test'] },
      { id: 'test', type: 'agent', label: 'Test', config: { agent: 'QA-Tester' }, next: ['deploy'] },
      { id: 'deploy', type: 'action', label: 'Deploy', config: { agent: 'DevOps-Engineer' }, next: ['done'] },
      { id: 'done', type: 'output', label: 'Shipped', config: {} },
    ],
    edges: [{ from: 'spec', to: 'design' }, { from: 'design', to: 'implement' }, { from: 'implement', to: 'test' }, { from: 'test', to: 'deploy' }, { from: 'deploy', to: 'done' }],
  },
  {
    id: 'tpl-deploy',
    name: 'Deploy',
    description: 'Build → test → deploy → verify',
    entryNode: 'build',
    nodes: [
      { id: 'build', type: 'action', label: 'Build', config: {}, next: ['test'] },
      { id: 'test', type: 'agent', label: 'Run Tests', config: { agent: 'QA-Tester' }, next: ['check'] },
      { id: 'check', type: 'condition', label: 'Tests Pass?', config: {}, condition: 'tests.passed', next: ['deploy', 'notify'] },
      { id: 'deploy', type: 'action', label: 'Deploy', config: {}, next: ['verify'] },
      { id: 'verify', type: 'agent', label: 'Verify', config: { agent: 'Site-Reliability-Engineer' }, next: ['done'] },
      { id: 'notify', type: 'output', label: 'Notify Failure', config: {} },
      { id: 'done', type: 'output', label: 'Deployed', config: {} },
    ],
    edges: [
      { from: 'build', to: 'test' }, { from: 'test', to: 'check' },
      { from: 'check', to: 'deploy', label: 'yes' }, { from: 'check', to: 'notify', label: 'no' },
      { from: 'deploy', to: 'verify' }, { from: 'verify', to: 'done' },
    ],
  },
]

// ── Conditional branching ──
export function evaluateCondition(expression: string, context: Record<string, unknown>): boolean {
  try {
    const keys = Object.keys(context)
    const values = Object.values(context)
    const fn = new Function(...keys, `return (${expression})`)
    return !!fn(...values)
  } catch {
    return false
  }
}

// ── Parallel execution ──
export async function executeParallel<T>(
  tasks: Array<() => Promise<T>>,
  options: { maxConcurrency?: number; timeoutMs?: number } = {}
): Promise<Array<{ success: boolean; result?: T; error?: string }>> {
  const { maxConcurrency = 5, timeoutMs = 30_000 } = options
  const results: Array<{ success: boolean; result?: T; error?: string }> = []
  // Execute in batches of maxConcurrency
  for (let i = 0; i < tasks.length; i += maxConcurrency) {
    const batch = tasks.slice(i, i + maxConcurrency)
    const batchResults = await Promise.allSettled(
      batch.map((task) => Promise.race([
        task(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]))
    )
    for (const r of batchResults) {
      if (r.status === 'fulfilled') results.push({ success: true, result: r.value })
      else results.push({ success: false, error: r.reason?.message || 'failed' })
    }
  }
  return results
}

// ── Workflow replay + debugging ──
export interface WorkflowExecutionLog {
  workflowId: string
  runId: string
  nodeId: string
  status: 'started' | 'completed' | 'failed' | 'skipped'
  input?: unknown
  output?: unknown
  error?: string
  timestamp: number
  durationMs?: number
}

const executionLogs: WorkflowExecutionLog[] = []

export function logWorkflowStep(log: Omit<WorkflowExecutionLog, 'timestamp'>): void {
  executionLogs.push({ ...log, timestamp: Date.now() })
  if (executionLogs.length > 1000) executionLogs.shift() // keep last 1000
}

export function getWorkflowReplay(runId: string): WorkflowExecutionLog[] {
  return executionLogs.filter((l) => l.runId === runId).sort((a, b) => a.timestamp - b.timestamp)
}

export function debugWorkflow(runId: string): {
  steps: WorkflowExecutionLog[]
  failedSteps: WorkflowExecutionLog[]
  totalDurationMs: number
  summary: string
} {
  const steps = getWorkflowReplay(runId)
  const failedSteps = steps.filter((s) => s.status === 'failed')
  const totalDurationMs = steps.reduce((sum, s) => sum + (s.durationMs || 0), 0)
  const summary = `Run ${runId}: ${steps.length} steps, ${failedSteps.length} failed, ${totalDurationMs}ms total`
  return { steps, failedSteps, totalDurationMs, summary }
}

// ── Save/load workflows to DB (uses MemoryItem as a key-value store) ──
export async function saveWorkflow(workflow: Workflow): Promise<void> {
  try {
    await db.memoryItem.upsert({
      where: { key_scope: { key: `workflow:${workflow.id}`, scope: 'workflow' } },
      create: {
        scope: 'workflow',
        key: `workflow:${workflow.id}`,
        value: JSON.stringify(workflow),
        tags: JSON.stringify([workflow.id]),
      },
      update: {
        value: JSON.stringify(workflow),
        tags: JSON.stringify([workflow.id]),
      },
    })
  } catch (err) {
    logger.warn({ err: (err as Error).message, workflowId: workflow.id }, 'workflow-engine: saveWorkflow failed')
  }
}

export async function loadWorkflow(workflowId: string): Promise<Workflow | null> {
  try {
    const row = await db.memoryItem.findUnique({
      where: { key_scope: { key: `workflow:${workflowId}`, scope: 'workflow' } },
    })
    if (!row) return null
    return JSON.parse(row.value) as Workflow
  } catch (err) {
    logger.warn({ err: (err as Error).message, workflowId }, 'workflow-engine: loadWorkflow failed')
    return null
  }
}

export async function listWorkflows(): Promise<Workflow[]> {
  try {
    const rows = await db.memoryItem.findMany({ where: { scope: 'workflow' } })
    return rows
      .map(r => {
        try { return JSON.parse(r.value) as Workflow } catch { return null }
      })
      .filter((w): w is Workflow => w !== null)
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'workflow-engine: listWorkflows failed')
    return []
  }
}
