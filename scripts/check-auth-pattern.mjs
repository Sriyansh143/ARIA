#!/usr/bin/env node
// =====================================================================
// scripts/check-auth-pattern.mjs — Phase 40 CI guard
// =====================================================================
// Fails the build if any API route still uses the NextAuth v4 pattern
// (getServerSession / authOptions) instead of the v5 pattern (auth()).
//
// Usage:
//   node scripts/check-auth-pattern.mjs
//   node scripts/check-auth-pattern.mjs --strict   # also warn on missing auth
//
// Exit codes:
//   0 — no violations found
//   1 — violations found (build should fail)
// =====================================================================

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const STRICT = process.argv.includes('--strict')

// Patterns that indicate the old NextAuth v4 API (removed in v5)
const FORBIDDEN_PATTERNS = [
  { pattern: /import\s+\{[^}]*getServerSession[^}]*\}\s+from\s+['"]next-auth['"]/, label: 'getServerSession import from next-auth' },
  { pattern: /import\s+\{[^}]*authOptions[^}]*\}\s+from\s+['"]@\/lib\/auth['"]/, label: 'authOptions import from @/lib/auth' },
  { pattern: /getServerSession\s*\(/, label: 'getServerSession() call' },
  { pattern: /authOptions\b/, label: 'authOptions reference' },
]

// Files that are intentionally allowlisted (e.g. the auth lib itself defining authOptions for migration docs)
const ALLOWLIST = new Set([
  'src/lib/auth.ts',
  'src/lib/auth-compat.ts',
  'scripts/check-auth-pattern.mjs',
])

function walkDir(dir, results = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (['node_modules', '.next', '.git', 'dist', 'coverage'].includes(entry)) continue
      walkDir(full, results)
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      results.push(full)
    }
  }
  return results
}

const apiDir = join(ROOT, 'src', 'app', 'api')
const files = walkDir(apiDir)

let violations = 0
const report = []

for (const file of files) {
  const rel = relative(ROOT, file)
  if (ALLOWLIST.has(rel)) continue

  let content
  try { content = readFileSync(file, 'utf8') } catch { continue }

  const fileViolations = []
  for (const { pattern, label } of FORBIDDEN_PATTERNS) {
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // Skip comment lines
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue
      if (pattern.test(line)) {
        fileViolations.push(`  Line ${i + 1}: [${label}] ${line.trim().slice(0, 100)}`)
        violations++
      }
    }
  }

  if (fileViolations.length > 0) {
    report.push(`\n❌ ${rel}`)
    report.push(...fileViolations)
  }
}

if (violations === 0) {
  console.log(`✅ check-auth-pattern: 0 violations across ${files.length} API route files`)
  console.log('   All routes use the correct NextAuth v5 auth() pattern.')
  process.exit(0)
} else {
  console.error(`\n🚨 check-auth-pattern: ${violations} violation(s) found in ${files.length} API route files`)
  console.error('   These files use the NextAuth v4 API (removed in v5). Fix by replacing:')
  console.error('   ❌ import { getServerSession } from "next-auth"')
  console.error('   ❌ import { authOptions } from "@/lib/auth"')
  console.error('   ❌ const session = await getServerSession(authOptions)')
  console.error('   ✅ import { auth } from "@/lib/auth"')
  console.error('   ✅ const session = await auth()')
  console.error(report.join('\n'))
  process.exit(1)
}
