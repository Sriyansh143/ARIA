// 06 — Few-Shot Learning. Injects a small number of (input, output)
// examples into the prompt so the model imitates the demonstrated pattern.
// If no examples are supplied, a built-in default set is used.
//
// Adapted from v8 zip: uses our chat(userMessage, history, systemPrompt).

import { chat, type ChatTurn } from '@/lib/llm'

const DEFAULT_MODEL = 'glm-4.6'

export interface FewShotExample {
  input: string
  output: string
}

export const DEFAULT_EXAMPLES: FewShotExample[] = [
  { input: 'Translate: Hello, how are you?', output: 'Hola, ¿cómo estás?' },
  { input: 'Translate: I would like a coffee, please.', output: 'Quisiera un café, por favor.' },
  { input: 'Translate: Where is the train station?', output: '¿Dónde está la estación de tren?' },
]

export interface FewShotResult {
  answer: string
  examplesUsed: number
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

export async function fewShotLearning(
  prompt: string,
  examples: FewShotExample[] = DEFAULT_EXAMPLES,
  model: string = DEFAULT_MODEL,
): Promise<FewShotResult> {
  const started = Date.now()
  const exampleBlock = examples
    .map((ex, i) => `### Example ${i + 1}\nInput: ${ex.input}\nOutput: ${ex.output}`)
    .join('\n\n')

  const messages: Msg[] = [
    {
      role: 'system',
      content:
        'You learn by example. Below are demonstrated input→output pairs. Follow the same pattern, style, and format when answering the final Input. Do not add commentary — produce only the Output.',
    },
    { role: 'user', content: `${exampleBlock}\n\n### Now\nInput: ${prompt}\nOutput:` },
  ]

  try {
    const answer = await llmCall(messages)
    return { answer, examplesUsed: examples.length, model, latencyMs: Date.now() - started }
  } catch (err: unknown) {
    // Fallback: zero-shot retry without examples.
    try {
      const r = await chat(prompt, [], '')
      return {
        answer: r.content,
        examplesUsed: 0,
        model,
        latencyMs: Date.now() - started,
        fallback: true,
        error: err instanceof Error ? err.message : String(err),
      }
    } catch (err2: unknown) {
      return {
        answer: '',
        examplesUsed: 0,
        model,
        latencyMs: Date.now() - started,
        fallback: true,
        error: err2 instanceof Error ? err2.message : String(err2),
      }
    }
  }
}
