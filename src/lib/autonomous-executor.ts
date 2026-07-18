// =====================================================================
// autonomous-executor.ts — executes autonomous tasks with self-healing +
// output verification.
// =====================================================================
// Adapted for v10: the original imported ~15 modules we don't have
// (mnc-orchestrator, dag-planner, browser-agent-native, telegram-…,
// email-native, context-memory, self-healing-runtime, os-executor's
// vision helpers, etc). We keep the core public API —
//   executeAutonomousTask({ task, ...opts })
//   quickExecute(command)
// — and implement them with what we DO have: chat() (via runAgentLoop),
// guardrails.checkCommand, self-healing.executeWithSelfHealing,
// output-verifier.verifyOutput, and os-executor.executeCommand / readFile.
// =====================================================================

import { runAgentLoop } from '@/lib/agent-loop'
import { executeCommand, readFile as osReadFile } from '@/lib/os-executor'
import { checkCommand } from '@/lib/guardrails'
import { executeWithSelfHealing } from '@/lib/self-healing'
import { verifyOutput } from '@/lib/output-verifier'

export interface AutonomousTaskOptions {
  task: string
  systemPrompt?: string
  enableSelfHealing?: boolean
  enableVerification?: boolean
  verifyThreshold?: number
  maxIterations?: number
  context?: string
}

export interface AutonomousStep {
  step: string
  action: string
  result: string
  success: boolean
  toolUsed?: string
}

export interface AutonomousTaskResult {
  success: boolean
  output: string
  steps: AutonomousStep[]
  toolsUsed: string[]
  healingAttempts: number
  verifyScore?: number
  verifyPassed?: boolean
  error?: string
  duration: number
}

/**
 * Execute an autonomous task end-to-end:
 *   1. Guardrail check (block destructive prompts)
 *   2. (optional) Self-healing wrapper for resilient execution
 *   3. (optional) Output verification — re-run with correction hint on fail
 *   4. Return structured result with steps + tool usage
 */
export async function executeAutonomousTask(
  opts: AutonomousTaskOptions,
): Promise<AutonomousTaskResult> {
  const startTime = Date.now()

  // 1. Guardrail check
  const guardrail = checkCommand(opts.task)
  if (guardrail.safety === 'blocked') {
    return {
      success: false,
      output: '',
      steps: [],
      toolsUsed: [],
      healingAttempts: 0,
      error: guardrail.reason,
      duration: Date.now() - startTime,
    }
  }

  // 2. Run via the agent loop (optionally wrapped in self-healing)
  const steps: AutonomousStep[] = []
  const toolsUsed: string[] = ['agent-loop']
  let healingAttempts = 0
  let output = ''

  try {
    if (opts.enableSelfHealing) {
      const healed = await executeWithSelfHealing({
        task: opts.task,
        systemPrompt: opts.systemPrompt,
      })
      healingAttempts = healed.attempts - 1
      output = healed.result
      steps.push({
        step: 'self-healing',
        action: opts.task.slice(0, 200),
        result: healed.result.slice(0, 500),
        success: healed.success,
        toolUsed: 'self-healing',
      })
      if (!healed.success) {
        return {
          success: false,
          output,
          steps,
          toolsUsed,
          healingAttempts,
          error: 'Self-healing exhausted retries',
          duration: Date.now() - startTime,
        }
      }
    } else {
      const result = await runAgentLoop(opts.task, {
        systemPrompt: opts.systemPrompt,
        context: opts.context,
      })
      output = result.content
      steps.push({
        step: 'agent-loop',
        action: opts.task.slice(0, 200),
        result: result.content.slice(0, 500),
        success: true,
        toolUsed: 'agent-loop',
      })
    }

    // 3. Optional verification — re-run with correction hint on fail (one retry)
    if (opts.enableVerification) {
      const verify = await verifyOutput({
        task: opts.task,
        output,
        threshold: opts.verifyThreshold,
      })
      if (!verify.passed && verify.correctionHint) {
        const replan = `Previous output scored ${verify.score}/10.\n${verify.correctionHint}\n\nOriginal task: ${opts.task}`
        const retry = await runAgentLoop(replan, {
          systemPrompt: opts.systemPrompt,
        })
        output = retry.content
        steps.push({
          step: 'verify-rerun',
          action: replan.slice(0, 200),
          result: retry.content.slice(0, 500),
          success: true,
          toolUsed: 'agent-loop',
        })
      }
      return {
        success: true,
        output,
        steps,
        toolsUsed,
        healingAttempts,
        verifyScore: verify.score,
        verifyPassed: verify.passed,
        duration: Date.now() - startTime,
      }
    }

    return {
      success: true,
      output,
      steps,
      toolsUsed,
      healingAttempts,
      duration: Date.now() - startTime,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      output: '',
      steps,
      toolsUsed,
      healingAttempts,
      error: msg,
      duration: Date.now() - startTime,
    }
  }
}

/**
 * Quick one-shot shell execution. Wraps os-executor's executeCommand and
 * returns a compact { success, output } for callers that don't need the
 * full result struct. Best-effort: stderr is included when stdout is empty.
 */
export async function quickExecute(
  command: string,
): Promise<{ success: boolean; output: string }> {
  const r = await executeCommand(command, { timeout: 30_000 })
  return {
    success: r.success,
    output: r.stdout || r.stderr,
  }
}

/**
 * Read a file from disk (small helper around os-executor.readFile) so the
 * autonomous executor can pull context files into the prompt.
 */
export function readContextFile(path: string): string | null {
  const r = osReadFile(path)
  return r.success && r.content ? r.content : null
}
