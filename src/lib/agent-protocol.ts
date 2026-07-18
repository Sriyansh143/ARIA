// =====================================================================
// agent-protocol.ts — Structured output parsing for the JARVIS agent loop.
// =====================================================================
// Replaces the fragile greedy JSON regex
//   `result.content.match(/\{[\s\S]*\}/)`
// with a multi-strategy parser inspired by Claude Code / Cursor / zcode:
//
//   1. Fast path: parse the full response as JSON.
//   2. Markdown code fence: extract the first ```json ... ``` block.
//   3. Balanced-brace scan: find the first `{ ... }` block whose braces
//      actually balance (so a stray `}` inside a string doesn't truncate
//      the JSON, and a `{` inside prose doesn't anchor on noise).
//   4. Validate the parsed object has a `type` field with one of the
//      allowed literal values, and that the per-type required fields are
//      present with plausible types.
//   5. Return null if all strategies fail — the caller falls back to
//      treating the raw text as a `final_answer` with low confidence.
//
// Also exports `buildSystemPrompt(tools, task)` — generates a system
// prompt that instructs the LLM to ALWAYS respond with a valid
// `AgentAction` JSON object, with one worked example per action type.
//
// Design rules (matching the rest of the agent-loop module):
//   • No new npm dependencies — Node.js built-ins only.
//   • Every exported symbol has explicit TypeScript types.
//   • The parser is pure (no I/O, no side effects).
//   • The parser never throws — every code path returns either a
//     validated `AgentAction` or `null`. The caller decides what to do
//     with `null` (typically: fall back to treating the raw text as a
//     final answer).
// =====================================================================

// ─── Local AgentTool type ────────────────────────────────────────────
//
// The existing agent-loop.ts does not export an `AgentTool` type. We
// define a minimal shape here so agent-protocol is self-contained and
// can be used by future tool-using code without circular imports.

export interface AgentToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description: string
  required?: boolean
  default?: unknown
  enum?: Array<string | number>
}

export interface AgentTool {
  name: string
  description: string
  parameters: Record<string, AgentToolParameter>
  /** Optional executor — when provided, runAgentLoop can invoke the tool. */
  execute?: (args: Record<string, unknown>) => Promise<string>
}

// ─── Public types ────────────────────────────────────────────────────

export type AgentAction =
  | { type: 'tool_call'; tool: string; args: Record<string, unknown>; thought: string }
  | { type: 'final_answer'; answer: string; confidence: number }
  | { type: 'clarification'; question: string }
  | {
      type: 'plan'
      steps: Array<{ id: string; description: string; tool?: string }>
    }

const VALID_TYPES = new Set<AgentAction['type']>([
  'tool_call',
  'final_answer',
  'clarification',
  'plan',
])

// ─── Strategy 1: parse the whole response as JSON ───────────────────

function tryParseFull(raw: string): unknown | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

// ─── Strategy 2: extract the first ```json ... ``` fenced block ──────

function tryParseMarkdownBlock(raw: string): unknown | null {
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/i
  const m = raw.match(fenceRe)
  if (!m || !m[1]) return null
  const candidate = m[1].trim()
  if (!candidate.startsWith('{')) return null
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

// ─── Strategy 3: balanced-brace extraction ───────────────────────────

function tryParseBalanced(raw: string): unknown | null {
  for (let start = raw.indexOf('{'); start !== -1; start = raw.indexOf('{', start + 1)) {
    const end = findMatchingBrace(raw, start)
    if (end === -1) continue
    const candidate = raw.slice(start, end + 1)
    try {
      return JSON.parse(candidate)
    } catch {
      // Not valid JSON — try the next `{`.
      continue
    }
  }
  return null
}

/**
 * Walk forward from `start` (the index of an opening `{`) and return the
 * index of the matching `}`. Honors strings (single + double + template)
 * and escape sequences. Returns -1 if no matching brace is found.
 */
function findMatchingBrace(s: string, start: number): number {
  let depth = 0
  let i = start
  let inString: '"' | "'" | '`' | null = null
  while (i < s.length) {
    const c = s[i]
    if (inString) {
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === inString) {
        inString = null
        i += 1
        continue
      }
      i += 1
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c
      i += 1
      continue
    }
    if (c === '{') {
      depth += 1
      i += 1
      continue
    }
    if (c === '}') {
      depth -= 1
      if (depth === 0) return i
      i += 1
      continue
    }
    i += 1
  }
  return -1
}

// ─── Strategy 4: validate the parsed object ──────────────────────────

function validateAction(obj: unknown): AgentAction | null {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null
  const o = obj as Record<string, unknown>
  const t = o['type']
  if (typeof t !== 'string' || !VALID_TYPES.has(t as AgentAction['type'])) return null

  switch (t) {
    case 'tool_call': {
      const tool = o['tool']
      const args = o['args']
      const thought = o['thought']
      if (typeof tool !== 'string' || tool.length === 0) return null
      if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
        return null
      }
      if (thought !== undefined && typeof thought !== 'string') return null
      return {
        type: 'tool_call',
        tool,
        args: (args as Record<string, unknown>) ?? {},
        thought: typeof thought === 'string' ? thought : '',
      }
    }
    case 'final_answer': {
      const answer = o['answer']
      const confidence = o['confidence']
      if (typeof answer !== 'string' || answer.length === 0) return null
      const conf =
        typeof confidence === 'number' && isFinite(confidence)
          ? Math.max(0, Math.min(1, confidence))
          : 0.8
      return { type: 'final_answer', answer, confidence: conf }
    }
    case 'clarification': {
      const question = o['question']
      if (typeof question !== 'string' || question.length === 0) return null
      return { type: 'clarification', question }
    }
    case 'plan': {
      const steps = o['steps']
      if (!Array.isArray(steps) || steps.length === 0) return null
      const normalized: Array<{ id: string; description: string; tool?: string }> = []
      for (const s of steps) {
        if (typeof s !== 'object' || s === null || Array.isArray(s)) return null
        const step = s as Record<string, unknown>
        const id = step['id']
        const description = step['description']
        const tool = step['tool']
        if (typeof id !== 'string' || typeof description !== 'string') return null
        if (tool !== undefined && typeof tool !== 'string') return null
        normalized.push({
          id,
          description,
          ...(typeof tool === 'string' ? { tool } : {}),
        })
      }
      return { type: 'plan', steps: normalized }
    }
    default:
      return null
  }
}

// ─── Public entry point ──────────────────────────────────────────────

/**
 * Parse an LLM response into a structured `AgentAction`. Tries four
 * strategies in order: full-JSON parse, markdown-fence extraction,
 * balanced-brace scan, validation. Returns `null` if all strategies
 * fail.
 */
export function parseAgentResponse(raw: string): AgentAction | null {
  if (typeof raw !== 'string' || raw.length === 0) return null

  const full = tryParseFull(raw)
  if (full !== null) {
    const v = validateAction(full)
    if (v !== null) return v
  }

  const fenced = tryParseMarkdownBlock(raw)
  if (fenced !== null) {
    const v = validateAction(fenced)
    if (v !== null) return v
  }

  const balanced = tryParseBalanced(raw)
  if (balanced !== null) {
    const v = validateAction(balanced)
    if (v !== null) return v
  }

  return null
}

/**
 * Robustly extract the FIRST valid JSON object from an arbitrary LLM
 * response, WITHOUT applying the AgentAction schema.
 */
export function extractJsonObject<T = unknown>(raw: string): T | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  const full = tryParseFull(raw)
  if (full !== null) return full as T
  const fenced = tryParseMarkdownBlock(raw)
  if (fenced !== null) return fenced as T
  const balanced = tryParseBalanced(raw)
  if (balanced !== null) return balanced as T
  return null
}

// ─── System prompt builder ───────────────────────────────────────────

/**
 * Build the default system prompt for `runAgentLoop`. Instructs the LLM
 * to ALWAYS respond with a single JSON object in the `AgentAction`
 * format. Includes one worked example per action type and a listing of
 * the available tools (name + description + parameter shape).
 */
export function buildSystemPrompt(tools: AgentTool[], task: string): string {
  const toolList = (tools || [])
    .map((t) => {
      const params = Object.entries(t.parameters || {})
        .map(([name, p]) => `${name}${p.required ? ' (required)' : ''}: ${p.description}`)
        .join('; ')
      return `- ${t.name}: ${t.description}${params ? ` [params: ${params}]` : ''}`
    })
    .join('\n')

  return `You are JARVIS, an autonomous AI agent. You reason step-by-step and use tools to accomplish tasks.

TASK:
${task}

AVAILABLE TOOLS:
${toolList || '(no tools available — you must answer from your own knowledge)'}

RESPONSE FORMAT — STRICT:
You MUST respond with EXACTLY ONE JSON object on the first line(s), no prose before or after. The object MUST have a "type" field set to one of: "tool_call", "final_answer", "clarification", or "plan". Pick exactly ONE type per response.

Examples:

1. Call a tool:
{"type":"tool_call","tool":"search_files","args":{"pattern":"TODO","glob":"*.ts"},"thought":"I need to find existing TODOs before adding new ones."}

2. Give the final answer (with confidence between 0 and 1):
{"type":"final_answer","answer":"The file has 3 TODOs: in auth.ts, db.ts, and llm.ts.","confidence":0.95}

3. Ask for clarification (when the task is ambiguous):
{"type":"clarification","question":"Which directory should I search — the workspace root or src/?"}

4. Emit a plan (for multi-step tasks — list sub-steps with stable IDs):
{"type":"plan","steps":[{"id":"s1","description":"Search for existing TODOs","tool":"search_files"},{"id":"s2","description":"Add a new TODO in src/lib/foo.ts","tool":"edit_file"}]}

RULES:
- Output ONLY the JSON object. No markdown fences, no leading/trailing prose.
- After a "plan" response, your NEXT response must be a "tool_call" (execute step s1).
- After every "tool_call", the system feeds you the tool result. Your next response is either another "tool_call" or a "final_answer".
- Use "final_answer" as soon as you have enough information — do not loop unnecessarily.
- If the task is impossible or ambiguous, emit "clarification" rather than guessing.
- Confidence is a number in [0, 1] indicating how sure you are of your final answer.`
}

// ─── Convenience: convert an AgentAction back to the legacy shape ────

export interface LegacyToolCall {
  tool: string
  args: Record<string, unknown>
  thought: string
}
export interface LegacyFinalAnswer {
  answer: string
  confidence: number
}

export function toLegacyToolCall(a: Extract<AgentAction, { type: 'tool_call' }>): LegacyToolCall {
  return { tool: a.tool, args: a.args, thought: a.thought }
}

export function toLegacyFinalAnswer(
  a: Extract<AgentAction, { type: 'final_answer' }>,
): LegacyFinalAnswer {
  return { answer: a.answer, confidence: a.confidence }
}
