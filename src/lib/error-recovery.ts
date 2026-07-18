// =====================================================================
// error-recovery.ts — Detects common errors and suggests / applies fixes.
// =====================================================================
// Phase 3.3 (ROADMAP): "Add error recovery (auto-fix common issues)".
//
// `analyzeError(error, context?)` inspects the error message + stack and
// returns a structured diagnosis:
//   - fixable: true if we recognise the error pattern
//   - suggestion: human-readable fix description
//   - autoFix: optional callback that applies the fix (safe, idempotent)
//
// Recognised patterns:
//   1. Missing import ("Cannot find module 'X'" / "X is not defined")
//   2. Syntax error ("Unexpected token", "SyntaxError")
//   3. Undefined variable ("X is not defined", "Cannot read property of undefined")
//   4. Missing directory/file ("ENOENT", "no such file or directory")
//   5. Port in use ("EADDRINUSE")
//
// autoFix callbacks are intentionally conservative — they only act on
// filesystem paths explicitly provided in `context.filePath` and never
// modify files outside that path. They log, never throw.
//
// Adapted for v10: no changes needed — this module had zero deps on
// logger / db / redis / otel. Just re-exports the original behaviour.
// =====================================================================

import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'

export interface ErrorDiagnosis {
  fixable: boolean
  category?: string
  suggestion?: string
  autoFix?: () => Promise<void>
}

interface ErrorContext {
  filePath?: string
  source?: string
  [k: string]: unknown
}

/** Match an error message against known patterns and return a diagnosis. */
export function analyzeError(
  error: Error,
  context?: ErrorContext,
): ErrorDiagnosis {
  const msg = (error?.message || String(error)).toString()
  const stack = error?.stack || ''
  const haystack = `${msg}\n${stack}`

  // ── 1. Missing import / module not found ──────────────────────────────
  const moduleMatch =
    haystack.match(/Cannot find module ['"]([^'"]+)['"]/) ||
    haystack.match(/Module not found: ['"]([^'"]+)['"]/) ||
    haystack.match(/Failed to resolve import ['"]([^'"]+)['"]/)
  if (moduleMatch) {
    const mod = moduleMatch[1]
    return {
      fixable: true,
      category: 'missing-import',
      suggestion: `Add an import for "${mod}" at the top of the file. If it's a third-party package, run \`bun add ${mod}\` first.`,
      // No safe auto-fix — we don't know the intended symbol or whether
      // the package needs installing.
    }
  }

  // ── 2. Syntax error ───────────────────────────────────────────────────
  if (/SyntaxError|Unexpected token|Unexpected end of input/i.test(msg)) {
    return {
      fixable: false,
      category: 'syntax-error',
      suggestion:
        'Syntax error — check for unmatched braces, missing commas, or stray characters near the reported line.',
    }
  }

  // ── 3. Undefined variable ─────────────────────────────────────────────
  const undefMatch = msg.match(/([A-Za-z_$][\w$]*) is not defined/)
  if (undefMatch) {
    const name = undefMatch[1]
    return {
      fixable: true,
      category: 'undefined-variable',
      suggestion: `"${name}" is not defined. Add it to the surrounding scope, import it, or fix the typo if it was meant to be something else.`,
    }
  }

  // Cannot read properties of undefined — common null-deref
  if (/Cannot read propert(?:y|ies) of (?:undefined|null)/i.test(msg)) {
    return {
      fixable: false,
      category: 'null-deref',
      suggestion:
        'Tried to read a property of null/undefined. Add a null-check (`x?.y`) or initialise the variable before use.',
    }
  }

  // ── 4. Missing directory / file (ENOENT) ─────────────────────────────
  const enoentMatch = msg.match(
    /ENOENT[:\s]*no such file or directory,?\s*(?:open|stat)?\s*['"]?([^'"]\S*)/i,
  )
  if (enoentMatch && context?.filePath) {
    const missingPath = enoentMatch[1] || context.filePath
    return {
      fixable: true,
      category: 'missing-path',
      suggestion: `The path "${missingPath}" doesn't exist. Auto-fix will create the parent directory (and an empty file if missing).`,
      autoFix: async () => {
        try {
          await mkdir(dirname(context.filePath!), { recursive: true })
          await writeFile(context.filePath!, '', { flag: 'a' }).catch(() => {})
          console.log(`[error-recovery] created path: ${context.filePath}`)
        } catch (err) {
          console.warn('[error-recovery] autoFix failed:', err)
        }
      },
    }
  }

  // ── 5. Port in use (EADDRINUSE) ──────────────────────────────────────
  if (/EADDRINUSE/i.test(msg)) {
    return {
      fixable: false,
      category: 'port-in-use',
      suggestion:
        'Port is already in use. Stop the conflicting process (e.g. `kill $(lsof -t -i:PORT)`) or set a different PORT env var.',
    }
  }

  // ── Unrecognised ─────────────────────────────────────────────────────
  return {
    fixable: false,
    category: 'unknown',
    suggestion: undefined,
  }
}
