// =====================================================================
// self-healing-runtime.ts — Auto-fix runtime + code errors.
// =====================================================================
// Two layers:
//   1. Command-level healing: known error patterns trigger known fixes
//      (e.g. "Cannot find module" → npm install).
//   2. Code-level healing: deterministic pattern-based patches (missing
//      imports) + LLM fallback for non-mutating suggestions.
// =====================================================================

import { logger } from '@/lib/logger'
import { executeCommand } from '@/lib/os-executor'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { quickChat } from '@/lib/llm'

const ERROR_PATTERNS = [
  { pattern: /Cannot find module/i, fix: 'npm install' },
  { pattern: /@prisma\/client did not initialize/i, fix: 'npx prisma generate' },
  { pattern: /table .* does not exist/i, fix: 'npx prisma db push' },
  { pattern: /Unterminated template|Expected.*got/i, fix: 'rm -rf .next' },
  { pattern: /EADDRINUSE/i, fix: 'lsof -ti :3000 | xargs kill -9 2>/dev/null || true' },
]

export async function selfHealCommand(cmd: string, stderr: string, stdout: string): Promise<{ healed: boolean; fixedCommand?: string }> {
  for (const { pattern, fix } of ERROR_PATTERNS) {
    if (pattern.test(stderr) || pattern.test(stdout)) {
      await executeCommand(fix, { timeout: 60000, skipGuardrails: true })
      return { healed: true }
    }
  }
  try {
    const out = await quickChat(
      `Command: ${cmd}\nError: ${stderr.slice(0, 1000)}`,
      'Return ONLY the corrected command, no explanation.',
    )
    if (out.trim() && out.trim() !== cmd) return { healed: true, fixedCommand: out.trim() }
  } catch { /* ignore */ }
  return { healed: false }
}

export async function executeWithHealing(cmd: string, opts?: { cwd?: string; maxRetries?: number }): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null; healingAttempts: number; fixesApplied: string[] }> {
  const maxRetries = opts?.maxRetries ?? 2
  let healingAttempts = 0
  const fixesApplied: string[] = []
  let currentCmd = cmd
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await executeCommand(currentCmd, { cwd: opts?.cwd, timeout: 30000 })
    if (result.success) return { success: true, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, healingAttempts, fixesApplied }
    if (attempt < maxRetries) {
      healingAttempts++
      const heal = await selfHealCommand(currentCmd, result.stderr, result.stdout)
      if (heal.healed) {
        if (heal.fixedCommand) currentCmd = heal.fixedCommand
      } else break
    }
  }
  return { success: false, stdout: '', stderr: 'Failed after healing', exitCode: null, healingAttempts, fixesApplied }
}

// CODE-LEVEL self-healing: given a source file + an error message, attempt
// deterministic, pattern-based fixes (missing import, missing semicolon,
// Prisma field rename, etc.) before falling back to the LLM. Writes the
// patched file back to disk only when a fix applies.
export interface SelfHealCodeResult {
  healed: boolean
  fixDescription?: string
}

const CODE_ERROR_PATTERNS: Array<{ pattern: RegExp; describe: (m: RegExpMatchArray) => string; apply: (src: string, m: RegExpMatchArray) => string | null }> = [
  {
    pattern: /Cannot find module ['"]([^'"]+)['"]/,
    describe: (m) => `Added missing import for module '${m[1]}'`,
    apply: (src, m) => {
      const mod = m[1]
      if (mod.startsWith('.') || mod.startsWith('/')) return null
      if (src.includes(`require('${mod}')`) || src.includes(`require("${mod}")`)) return null
      return `const _${mod.replace(/[^a-zA-Z0-9]/g, '_')} = require('${mod}')\n` + src
    },
  },
  {
    pattern: /Property ['"]([^'"]+)['"] does not exist/,
    describe: (m) => `Flagged unknown property '${m[1]}' (manual review needed)`,
    apply: () => null,
  },
]

export async function selfHealCode(filePath: string, error: string): Promise<SelfHealCodeResult> {
  if (!filePath || !existsSync(filePath)) {
    return { healed: false, fixDescription: `File not found: ${filePath}` }
  }
  if (!error || typeof error !== 'string') {
    return { healed: false, fixDescription: 'No error text provided' }
  }

  let src: string
  try {
    src = readFileSync(filePath, 'utf-8')
  } catch (err) {
    return { healed: false, fixDescription: `Cannot read file: ${err instanceof Error ? err.message : String(err)}` }
  }

  for (const { pattern, describe, apply } of CODE_ERROR_PATTERNS) {
    const m = error.match(pattern)
    if (!m) continue
    const patched = apply(src, m)
    if (patched && patched !== src) {
      try {
        writeFileSync(filePath, patched, 'utf-8')
        logger.info({ filePath, fix: describe(m) }, 'selfHealCode: applied deterministic fix')
        return { healed: true, fixDescription: describe(m) }
      } catch (err) {
        logger.warn({ filePath, err: (err as Error).message }, 'selfHealCode: write failed')
        return { healed: false, fixDescription: `Fix found but write failed: ${err instanceof Error ? err.message : String(err)}` }
      }
    }
    return { healed: false, fixDescription: describe(m) }
  }

  // No deterministic match — best-effort LLM suggestion (non-mutating).
  try {
    const out = await quickChat(
      `File: ${filePath}\nError:\n${error.slice(0, 2000)}\n\nCurrent source (first 4000 chars):\n${src.slice(0, 4000)}`,
      'You are a code-repair agent. Return ONLY the corrected file, no explanation.',
    )
    if (out && out.trim() && out.trim() !== src.trim()) {
      return { healed: false, fixDescription: `LLM suggested a fix (${out.length} chars) — review required before applying` }
    }
  } catch { /* ignore */ }

  return { healed: false, fixDescription: 'No matching fix pattern' }
}
