#!/usr/bin/env node
// =====================================================================
// scripts/check-workforce-wiring.mjs — Phase 40 CI guard
// =====================================================================
// Verifies that all workforce modules export their expected functions
// and that the API routes import from the correct workforce modules.
//
// Usage:
//   node scripts/check-workforce-wiring.mjs
//
// Exit codes:
//   0 — all workforce modules properly wired
//   1 — wiring issues found
// =====================================================================

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const WORKFORCE_DIR = join(ROOT, 'src', 'lib', 'workforce')
const API_WORKFORCE_DIR = join(ROOT, 'src', 'app', 'api', 'workforce')

// Expected exports from each workforce module
const MODULE_EXPORTS = {
  'agent-identity.ts': ['DEPARTMENTS', 'buildPersona', 'applyLearning'],
  'org-chart.ts': ['ROSTER', 'ROSTER_BY_ROLE', 'agentsInDepartment', 'departmentHeads'],
  'skill-matrix.ts': ['inferRequiredSkills', 'matchAgents', 'buildSkillMatrix'],
  'task-router.ts': ['routeTask', 'decomposeTask', 'escalate', 'PriorityQueue', 'DEPARTMENT_SLA_MINUTES'],
  'agent-runtime.ts': ['runAsAgent', 'modelForTier', 'ROLE_TOOLS'],
  'meetings.ts': ['runMeeting'],
  'comms-bus.ts': ['sendDirect', 'broadcast', 'subscribeDirect', 'subscribeChannel'],
  'collaboration.ts': ['requestHelp', 'pairProgram', 'reviewChain', 'consensusVote'],
}

// Expected API routes
const API_ROUTES = [
  'task/route.ts',
  'org-chart/route.ts',
  'agent/[id]/route.ts',
  'meeting/route.ts',
  'dashboard/route.ts',
  'departments/route.ts',
  'escalate/route.ts',
]

// Expected wiring: agent/run route should import workforce modules
const AGENT_RUN_ROUTE = join(ROOT, 'src', 'app', 'api', 'agent', 'run', 'route.ts')

let issues = 0
const report = []

// 1. Check all workforce modules exist and have expected exports
console.log('\n📋 Checking workforce module exports...')
for (const [filename, expectedExports] of Object.entries(MODULE_EXPORTS)) {
  const filepath = join(WORKFORCE_DIR, filename)
  if (!existsSync(filepath)) {
    report.push(`❌ Missing module: src/lib/workforce/${filename}`)
    issues++
    continue
  }

  const content = readFileSync(filepath, 'utf8')
  const missing = []
  for (const exp of expectedExports) {
    // Check for export keyword followed by the name
    const patterns = [
      new RegExp(`export\\s+(async\\s+)?function\\s+${exp}\\b`),
      new RegExp(`export\\s+(const|class|type|interface)\\s+${exp}\\b`),
      new RegExp(`export\\s+\\{[^}]*\\b${exp}\\b[^}]*\\}`),
    ]
    if (!patterns.some(p => p.test(content))) {
      missing.push(exp)
    }
  }

  if (missing.length > 0) {
    report.push(`⚠️  src/lib/workforce/${filename}: missing exports: ${missing.join(', ')}`)
    issues++
  } else {
    console.log(`  ✅ ${filename}: all ${expectedExports.length} exports present`)
  }
}

// 2. Check all API routes exist
console.log('\n📋 Checking workforce API routes...')
for (const route of API_ROUTES) {
  const filepath = join(API_WORKFORCE_DIR, route)
  if (!existsSync(filepath)) {
    report.push(`❌ Missing API route: src/app/api/workforce/${route}`)
    issues++
  } else {
    const content = readFileSync(filepath, 'utf8')
    const hasAuth = content.includes("await auth()") || content.includes("auth()")
    const hasTenant = content.includes("runInTenant") || content.includes("runAsSystem") || content.includes("withTenant") || content.includes("withSystem")
    if (!hasAuth) {
      report.push(`⚠️  src/app/api/workforce/${route}: missing auth() check`)
      issues++
    }
    if (!hasTenant) {
      report.push(`⚠️  src/app/api/workforce/${route}: missing runInTenant/runAsSystem`)
      issues++
    }
    if (hasAuth && hasTenant) {
      console.log(`  ✅ ${route}: auth + tenant scoping present`)
    }
  }
}

// 3. Check agent/run route has workforce wiring
console.log('\n📋 Checking agent/run workforce wiring...')
if (!existsSync(AGENT_RUN_ROUTE)) {
  report.push('❌ Missing: src/app/api/agent/run/route.ts')
  issues++
} else {
  const content = readFileSync(AGENT_RUN_ROUTE, 'utf8')
  const checks = [
    { name: 'routeTask import', pattern: /import.*routeTask.*from.*workforce\/task-router/ },
    { name: 'runAsAgent import', pattern: /import.*runAsAgent.*from.*workforce\/agent-runtime/ },
    { name: 'useWorkforce schema field', pattern: /useWorkforce/ },
    { name: 'WorkforcePerformance persistence', pattern: /workforcePerformance\.(create|update|upsert)/ },
  ]
  for (const { name, pattern } of checks) {
    if (pattern.test(content)) {
      console.log(`  ✅ agent/run: ${name}`)
    } else {
      report.push(`⚠️  agent/run: missing ${name}`)
      issues++
    }
  }
}

// Final report
console.log('')
if (issues === 0) {
  console.log('✅ check-workforce-wiring: all workforce modules properly wired')
  process.exit(0)
} else {
  console.error(`🚨 check-workforce-wiring: ${issues} issue(s) found`)
  console.error(report.join('\n'))
  process.exit(1)
}
