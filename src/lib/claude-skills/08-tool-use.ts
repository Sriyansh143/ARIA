// 08 — Tool Use. Asks the model to choose a tool from a declared schema,
// executes the chosen tool, then synthesises a natural-language answer.
// OpenAI function-calling style, implemented prompt-based (any model).
//
// Adapted from v8 zip: uses our chat(userMessage, history, systemPrompt).

import { chat, type ChatTurn } from '@/lib/llm'

const DEFAULT_MODEL = 'glm-4.6'

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, { type: string; description: string; required?: boolean }>
  run: (args: Record<string, unknown>) => Promise<string>
}
export interface ToolUseResult {
  chosenTool: string | null
  args: Record<string, unknown>
  observation: string
  answer: string
  model: string
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

function toolListBlock(tools: ToolSpec[]): string {
  return tools
    .map((t) => {
      const params = Object.entries(t.parameters)
        .map(([k, v]) => `${k}(${v.type}${v.required ? ', required' : ''}): ${v.description}`)
        .join('; ')
      return `- ${t.name}: ${t.description}\n  params: ${params || '(none)'}`
    })
    .join('\n')
}

export async function toolUse(
  query: string,
  tools: ToolSpec[] = [],
  model: string = DEFAULT_MODEL,
): Promise<ToolUseResult> {
  const started = Date.now()
  // No tools — answer directly.
  if (tools.length === 0) {
    try {
      const r = await chat(query, [], '')
      return { chosenTool: null, args: {}, observation: '', answer: r.content, model, latencyMs: Date.now() - started }
    } catch (err: unknown) {
      return {
        chosenTool: null,
        args: {},
        observation: '',
        answer: '',
        model,
        latencyMs: Date.now() - started,
        fallback: true,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
  // Phase 1 — Pick tool + args (strict JSON).
  let chosenTool: string | null = null
  let args: Record<string, unknown> = {}
  try {
    const r = await llmCall([
      {
        role: 'system',
        content:
          'Pick the best tool. Respond with ONLY JSON: {"tool":"<name>","args":{...}}. If none fits: {"tool":"none","args":{}}.',
      },
      { role: 'user', content: `Query: ${query}\n\nTools:\n${toolListBlock(tools)}` },
    ])
    const m = r.match(/\{[\s\S]*\}/)
    if (m) {
      const p = JSON.parse(m[0]) as { tool?: string; args?: Record<string, unknown> }
      chosenTool = p.tool || null
      args = p.args || {}
    }
  } catch (err: unknown) {
    return {
      chosenTool: null,
      args: {},
      observation: '',
      answer: '[tool selection failed]',
      model,
      latencyMs: Date.now() - started,
      fallback: true,
      error: err instanceof Error ? err.message : String(err),
    }
  }
  // Phase 2 — Execute the tool.
  let observation = ''
  if (chosenTool && chosenTool !== 'none') {
    const tool = tools.find((t) => t.name === chosenTool)
    if (tool) {
      try {
        observation = await tool.run(args)
      } catch (err: unknown) {
        observation = `[tool error: ${err instanceof Error ? err.message : String(err)}]`
      }
    } else {
      observation = `[unknown tool: ${chosenTool}]`
    }
  }
  // Phase 3 — Synthesise answer.
  try {
    const answer = await llmCall([
      {
        role: 'system',
        content: 'Use the tool observation to answer the user\'s query concisely.',
      },
      {
        role: 'user',
        content: `Query: ${query}\n\nTool used: ${chosenTool || 'none'}\nObservation: ${observation}\n\nAnswer:`,
      },
    ])
    return { chosenTool, args, observation, answer, model, latencyMs: Date.now() - started }
  } catch (err: unknown) {
    return {
      chosenTool,
      args,
      observation,
      answer: observation || '[no answer]',
      model,
      latencyMs: Date.now() - started,
      fallback: true,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
