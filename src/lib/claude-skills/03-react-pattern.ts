// 03 — ReAct (Reason+Act) loop. Alternates reasoning and tool/action steps
// up to maxIter (capped at 5), then synthesises a final answer. Each iteration:
// THOUGHT → ACTION → OBSERVATION. Final: ANSWER.
//
// Adapted from v8 zip: uses our chat(userMessage, history, systemPrompt).

import { chat, type ChatTurn } from '@/lib/llm'

const DEFAULT_MODEL = 'glm-4.6'
const MAX_ITER_CAP = 5

export interface ReactTool {
  name: string
  description: string
  run: (input: string) => Promise<string>
}
export interface ReactStep {
  thought: string
  action?: string
  actionInput?: string
  observation?: string
}
export interface ReactResult {
  steps: ReactStep[]
  answer: string
  model: string
  iterations: number
  latencyMs: number
  fallback?: boolean
  error?: string
}

type Msg = { role: 'system' | 'user' | 'assistant'; content: string }

async function llmCall(messages: Msg[]): Promise<string> {
  const sys = messages.find((m) => m.role === 'system')?.content ?? ''
  const convo = messages.filter((m) => m.role !== 'system')
  if (convo.length === 0) throw new Error('no user message')
  const last = convo[convo.length - 1]
  const history: ChatTurn[] = convo.slice(0, -1).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))
  const r = await chat(last.content, history, sys)
  return r.content
}

function parseStep(text: string): ReactStep {
  const thought = (text.match(/THOUGHT:\s*([\s\S]*?)(?:\nACTION:|$)/i)?.[1] || '').trim()
  const action = (text.match(/ACTION:\s*([^\n]+)/i)?.[1] || '').trim().split('(')[0].trim()
  const actionInput = (text.match(/ACTION_INPUT:\s*([\s\S]*?)(?:\nOBSERVATION:|$)/i)?.[1] || '').trim()
  return { thought, action: action || undefined, actionInput: actionInput || undefined }
}

export async function reactPattern(
  task: string,
  availableTools: ReactTool[] = [],
  maxIter: number = MAX_ITER_CAP,
  model: string = DEFAULT_MODEL,
): Promise<ReactResult> {
  const started = Date.now()
  // Cap iterations to avoid runaway loops.
  const cappedIter = Math.max(1, Math.min(MAX_ITER_CAP, maxIter))
  const steps: ReactStep[] = []
  const toolList = availableTools.map((t) => `- ${t.name}: ${t.description}`).join('\n')
  const system = `You are a ReAct agent. Use this loop:
THOUGHT: <reasoning about what to do next>
ACTION: <tool name or "FINISH">
ACTION_INPUT: <input for the tool, or the final answer if ACTION=FINISH>

Available tools:
${toolList || '(no tools — use FINISH with your best answer)'}`

  let scratchpad = ''
  for (let i = 0; i < cappedIter; i++) {
    let out = ''
    try {
      out = await llmCall([
        { role: 'system', content: system },
        { role: 'user', content: `Task: ${task}\n${scratchpad}\n\nProduce the next THOUGHT/ACTION/ACTION_INPUT.` },
      ])
    } catch (err: unknown) {
      return {
        steps,
        answer: '[ReAct LLM call failed]',
        model,
        iterations: i,
        latencyMs: Date.now() - started,
        fallback: true,
        error: err instanceof Error ? err.message : String(err),
      }
    }
    const step = parseStep(out)
    steps.push(step)
    if (!step.action || step.action.toUpperCase() === 'FINISH') {
      return {
        steps,
        answer: step.actionInput || step.thought || '[no answer produced]',
        model,
        iterations: i + 1,
        latencyMs: Date.now() - started,
      }
    }
    const tool = availableTools.find((t) => t.name === step.action)
    let observation = '[unknown tool]'
    if (tool) {
      try {
        observation = await tool.run(step.actionInput || '')
      } catch (err: unknown) {
        observation = `[tool error: ${err instanceof Error ? err.message : String(err)}]`
      }
    }
    step.observation = observation
    scratchpad += `\nTHOUGHT: ${step.thought}\nACTION: ${step.action}\nACTION_INPUT: ${step.actionInput}\nOBSERVATION: ${observation}\n`
  }
  // Exhausted — synthesise.
  try {
    const answer = await llmCall([
      { role: 'system', content: 'Synthesise a final answer from the ReAct scratchpad.' },
      { role: 'user', content: `Task: ${task}\n${scratchpad}\n\nFinal answer:` },
    ])
    return { steps, answer, model, iterations: cappedIter, latencyMs: Date.now() - started }
  } catch (err: unknown) {
    return {
      steps,
      answer: steps[steps.length - 1]?.thought || '[no answer]',
      model,
      iterations: cappedIter,
      latencyMs: Date.now() - started,
      fallback: true,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
