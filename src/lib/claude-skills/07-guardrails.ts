// 07 — Guardrails. Lightweight input/output checks that wrap the LLM call.
// checkInput: blocks prompts containing secrets, PII patterns, or known
// injection markers. checkOutput: blocks responses containing leaked PII,
// credentials, or unsafe instructions. guardrails: composes both around a
// (prompt, response) pair.
//
// These are heuristic fast-path filters; they do NOT replace the heavier
// HITL system for shell commands. They're designed to be cheap enough to
// run inline before/after every reasoning step.
//
// No LLM calls — pure regex filters. Ported unchanged from v8 zip.

export interface GuardrailViolation {
  ok: false
  reason: string
  matchedPattern?: string
}

export interface GuardrailOk {
  ok: true
}

export type GuardrailResult = GuardrailOk | GuardrailViolation

const INPUT_BLOCKED_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i, // private keys
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /sk-[a-zA-Z0-9]{20,}/, // OpenAI-style API key
  /xox[baprs]-[a-zA-Z0-9-]{10,}/i, // Slack token
  /gh[pousr]_[A-Za-z0-9]{36}/i, // GitHub PAT
  /password\s*[:=]\s*\S{6,}/i, // password=...
  /api[_-]?key\s*[:=]\s*\S{10,}/i, // api_key=...
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN
  /\b(?:\d[ -]*?){13,16}\b/, // credit-card-shaped
]

const OUTPUT_BLOCKED_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /AKIA[0-9A-Z]{16}/,
  /sk-[a-zA-Z0-9]{20,}/,
  /xox[baprs]-[a-zA-Z0-9-]{10,}/i,
  /gh[pousr]_[A-Za-z0-9]{36}/i,
  /rm\s+-rf\s+\/(?:\s|$)/i, // catastrophic rm
  /curl\s+[^|]+\|\s*(?:sh|bash)\b/i, // curl | sh
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN leak
]

export function checkInput(prompt: string): GuardrailResult {
  for (const p of INPUT_BLOCKED_PATTERNS) {
    if (p.test(prompt)) {
      return { ok: false, reason: 'Input contains a blocked pattern (secret/PII).', matchedPattern: p.source }
    }
  }
  return { ok: true }
}

export function checkOutput(response: string): GuardrailResult {
  for (const p of OUTPUT_BLOCKED_PATTERNS) {
    if (p.test(response)) {
      return { ok: false, reason: 'Output contains a blocked pattern (leak/unsafe).', matchedPattern: p.source }
    }
  }
  return { ok: true }
}

export interface GuardrailPairResult {
  input: GuardrailResult
  output: GuardrailResult
  safe: boolean
  reasons: string[]
}

export function guardrails(prompt: string, response: string): GuardrailPairResult {
  const input = checkInput(prompt)
  const output = checkOutput(response)
  const reasons: string[] = []
  if (!input.ok) reasons.push(`input: ${input.reason}`)
  if (!output.ok) reasons.push(`output: ${output.reason}`)
  return { input, output, safe: input.ok && output.ok, reasons }
}
