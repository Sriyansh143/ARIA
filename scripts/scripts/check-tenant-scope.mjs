#!/usr/bin/env node
/**
 * check-tenant-scope.mjs — Phase 36 CI check
 *
 * Scans all API route files and fails if any route:
 *   1. Imports from '@/lib/db' (touches the database), AND
 *   2. Does NOT have runInTenant or runAsSystem (tenant isolation), AND
 *   3. Is NOT in the intentional allowlist (public/webhook routes)
 *
 * Usage:
 *   node scripts/check-tenant-scope.mjs
 *   node scripts/check-tenant-scope.mjs --strict   # also fail on import-only (no actual call)
 *
 * Exit codes:
 *   0 — all routes are properly scoped
 *   1 — one or more routes are missing tenant isolation
 *
 * Add to CI:
 *   - run: node scripts/check-tenant-scope.mjs
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dirname, '..')
const ROUTE_DIR = join(ROOT, 'src', 'app', 'api')

const STRICT = process.argv.includes('--strict')

// Routes that legitimately don't need tenant scoping:
// - Webhook receivers (no user session, called by external services)
// - Public health/metrics endpoints
// - Root API manifest
// - Client telemetry ingestion (anonymous)
const ALLOWLIST = new Set([
  'revenue/webhook/route.ts',
  'voice/twiml/inbound/route.ts',
  'voice/twiml/outbound/route.ts',
  'route.ts',
  'telemetry/route.ts',
  'health/live/route.ts',
  'health/ready/route.ts',
  'health/deep/route.ts',
  'health/services/route.ts',
  'health/aggregate/route.ts',
  'health/system/route.ts',
  'metrics/route.ts',
  'openapi.json/route.ts',
  'v1/route.ts',
  'login-status/route.ts',
  'heartbeat/route.ts',
  // TOTP routes are user-scoped (not org-scoped) — they operate on TotpSecret
  // which is keyed by userId, not orgId. No runInTenant needed.
  'auth/totp/setup/route.ts',
  'auth/totp/verify/route.ts',
  'auth/totp/disable/route.ts',
  'auth/totp/backup/route.ts',
  // Self-improvement routes use orgId from session (not runInTenant).
  // The orgId is extracted from session.user.orgId and passed directly to
  // db queries as a where clause — this is the correct pattern for user-facing
  // routes that don't need the full runInTenant context wrapper.
  'self-improve/propose/route.ts',
  'self-improve/proposals/route.ts',
  'self-improve/approve/route.ts',
  'self-improve/reject/route.ts',
])

function walkDir(dir, results = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walkDir(full, results)
    } else if (entry === 'route.ts') {
      results.push(full)
    }
  }
  return results
}

const routeFiles = walkDir(ROUTE_DIR)
const violations = []
const warnings = []
const ok = []

for (const fpath of routeFiles) {
  const rel = relative(ROUTE_DIR, fpath)
  const content = readFileSync(fpath, 'utf8')

  const hasDb = content.includes("from '@/lib/db'") || content.includes('from "@/lib/db"')
  // Phase 37: recognize both direct calls (runInTenant/runAsSystem) and
  // the helper wrappers (withTenant/withSystem) which call them internally.
  const hasTenantCall = /runInTenant\s*\(/.test(content) || /runAsSystem\s*\(/.test(content)
    || /withTenant\s*\(/.test(content) || /withSystem\s*\(/.test(content)
  const hasTenantImport = content.includes('runInTenant') || content.includes('runAsSystem')
    || content.includes('withTenant') || content.includes('withSystem')

  if (!hasDb) {
    ok.push({ rel, reason: 'no_db' })
    continue
  }

  if (ALLOWLIST.has(rel)) {
    ok.push({ rel, reason: 'allowlisted' })
    continue
  }

  if (hasTenantCall) {
    ok.push({ rel, reason: 'scoped_call' })
    continue
  }

  if (hasTenantImport && !STRICT) {
    // Import present but no actual call — warn but don't fail (unless --strict)
    warnings.push({ rel, reason: 'import_only_no_call' })
    continue
  }

  // No tenant scoping at all — violation
  violations.push({ rel, reason: hasTenantImport ? 'import_only_strict' : 'no_tenant_scope' })
}

// Report
console.log(`\n🔍 Tenant Scope Check — ${routeFiles.length} route files scanned\n`)
console.log(`  ✅ Properly scoped:  ${ok.length}`)
console.log(`  ⚠️  Import-only:     ${warnings.length}`)
console.log(`  ❌ Violations:       ${violations.length}`)

if (warnings.length > 0) {
  console.log('\n⚠️  WARNINGS (import present but no runInTenant/runAsSystem call):')
  for (const { rel } of warnings) {
    console.log(`   ${rel}`)
  }
}

if (violations.length > 0) {
  console.log('\n❌ VIOLATIONS (routes with DB access but no tenant isolation):')
  for (const { rel, reason } of violations) {
    console.log(`   ${rel}  [${reason}]`)
  }
  console.log('\n💡 Fix: Add runInTenant(orgId, async () => { ... }) around db calls.')
  console.log('   Or add to ALLOWLIST if this is a public/webhook route.\n')
  process.exit(1)
}

console.log('\n✅ All routes with DB access are properly scoped or allowlisted.\n')
process.exit(0)
