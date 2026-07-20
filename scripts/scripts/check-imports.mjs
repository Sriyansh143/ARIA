#!/usr/bin/env node
// =====================================================================
// scripts/check-imports.mjs — Phase 40 CI guard
// =====================================================================
// Verifies that every @/lib/* import in the codebase resolves to an
// actual file. Fails the build if any import target doesn't exist.
//
// Usage:
//   node scripts/check-imports.mjs
//
// Exit codes:
//   0 — all imports resolve
//   1 — broken imports found
// =====================================================================

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative, resolve } from 'path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

// Build the set of all resolvable @/lib/* paths
function buildLibIndex() {
  const index = new Set()
  const libDir = join(SRC, 'lib')

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        walk(full)
        // Directory itself resolves if it has an index file
        if (existsSync(join(full, 'index.ts')) || existsSync(join(full, 'index.tsx'))) {
          const key = '@/lib' + full.slice(libDir.length).replace(/\\/g, '/')
          index.add(key)
        }
      } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        const key = '@/lib' + full.slice(libDir.length).replace(/\\/g, '/').replace(/\.(tsx?)$/, '')
        index.add(key)
      }
    }
  }

  if (existsSync(libDir)) walk(libDir)
  return index
}

function walkSrc(dir, results = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (['node_modules', '.next', '.git', 'dist', 'coverage'].includes(entry)) continue
      walkSrc(full, results)
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      results.push(full)
    }
  }
  return results
}

const libIndex = buildLibIndex()
const allFiles = walkSrc(SRC)

const importPattern = /from\s+['"](@\/lib\/[^'"]+)['"]/g

let broken = 0
const report = []

for (const file of allFiles) {
  const rel = relative(ROOT, file)
  let content
  try { content = readFileSync(file, 'utf8') } catch { continue }

  const fileIssues = []
  let match
  importPattern.lastIndex = 0
  while ((match = importPattern.exec(content)) !== null) {
    const imp = match[1]
    if (!libIndex.has(imp)) {
      // Check if it might be a directory import without index
      const asDir = join(SRC, imp.replace('@/', ''))
      if (!existsSync(asDir)) {
        fileIssues.push(`  Missing: ${imp}`)
        broken++
      }
    }
  }

  if (fileIssues.length > 0) {
    report.push(`\n❌ ${rel}`)
    report.push(...fileIssues)
  }
}

if (broken === 0) {
  console.log(`✅ check-imports: all @/lib/* imports resolve (${allFiles.length} files checked, ${libIndex.size} lib exports indexed)`)
  process.exit(0)
} else {
  console.error(`\n🚨 check-imports: ${broken} broken import(s) found`)
  console.error(report.join('\n'))
  process.exit(1)
}
