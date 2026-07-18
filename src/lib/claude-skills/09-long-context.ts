// 09 — Long-Context handling. When the input exceeds maxChars, chunk it,
// summarise each chunk in parallel, then combine the summaries into a
// condensed "map" summary that fits inside the model's context window.
//
// Adapted from v8 zip: uses our chat(userMessage, history, systemPrompt).

import { chat, type ChatTurn } from '@/lib/llm'

const DEFAULT_MODEL = 'glm-4.6'
const MAX_CHUNKES_CAP = 8 // cap parallel chunk summaries

export interface LongContextResult {
  originalChars: number
  summarisedChars: number
  chunks: number
  summary: string
  model: string
  latencyMs: number
  truncated: boolean
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

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size))
  return chunks
}

async function summariseChunk(chunk: string, idx: number, total: number): Promise<string> {
  return llmCall([
    {
      role: 'system',
      content: `Summarise chunk ${idx + 1}/${total}. Preserve all facts, entities, numbers, and key claims. Prose only.`,
    },
    { role: 'user', content: chunk },
  ])
}

export async function longContext(
  text: string,
  maxChars: number = 12_000,
  model: string = DEFAULT_MODEL,
): Promise<LongContextResult> {
  const started = Date.now()
  const originalChars = text.length
  if (originalChars <= maxChars) {
    return {
      originalChars,
      summarisedChars: originalChars,
      chunks: 1,
      summary: text,
      model,
      latencyMs: Date.now() - started,
      truncated: false,
    }
  }
  // Map phase — parallel per-chunk summaries (cap chunks to avoid runaway).
  const desiredChunks = Math.ceil(originalChars / (maxChars / 2))
  const chunkCount = Math.max(1, Math.min(MAX_CHUNKES_CAP, desiredChunks))
  const chunkSize = Math.ceil(originalChars / chunkCount)
  const chunks = chunkText(text, Math.max(2000, chunkSize))
  // Honour the cap even if it produces more chunks than expected.
  const capped = chunks.slice(0, MAX_CHUNKES_CAP)

  let chunkSummaries: string[]
  try {
    chunkSummaries = await Promise.all(
      capped.map((c, i) =>
        summariseChunk(c, i, capped.length).catch(
          (e: unknown) => `[chunk ${i + 1} failed: ${e instanceof Error ? e.message : String(e)}]`,
        ),
      ),
    )
  } catch (err: unknown) {
    const truncated = text.slice(0, maxChars) + '\n[...truncated...]'
    return {
      originalChars,
      summarisedChars: truncated.length,
      chunks: 1,
      summary: truncated,
      model,
      latencyMs: Date.now() - started,
      truncated: true,
      fallback: true,
      error: err instanceof Error ? err.message : String(err),
    }
  }
  // Reduce phase — single combined summary.
  try {
    const summary = await llmCall([
      {
        role: 'system',
        content: 'Combine the partial summaries into one coherent summary. Preserve all facts. Prose only.',
      },
      { role: 'user', content: chunkSummaries.join('\n\n---\n\n') },
    ])
    return {
      originalChars,
      summarisedChars: summary.length,
      chunks: capped.length,
      summary,
      model,
      latencyMs: Date.now() - started,
      truncated: true,
    }
  } catch (err: unknown) {
    const joined = chunkSummaries.join('\n\n---\n\n')
    return {
      originalChars,
      summarisedChars: joined.length,
      chunks: capped.length,
      summary: joined,
      model,
      latencyMs: Date.now() - started,
      truncated: true,
      fallback: true,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
