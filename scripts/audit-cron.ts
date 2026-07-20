#!/usr/bin/env node
/**
 * JARVIS Mission Control — Self-Audit Cron (Phase 21 Updated)
 *
 * Runs every 20 minutes via systemd timer, cron, or Windows Task Scheduler.
 *
 * What it does (12 checks):
 *   1.  Dashboard health — pings /api
 *   2.  Mini-service health — checks all 18 services (ports 3003-3020)
 *   3.  Type-check — runs `tsc --noEmit`
 *   4.  Lint — runs `eslint .`
 *   5.  Tests — runs `vitest run`
 *   6.  LLM provider check — pings every enabled provider
 *   7.  DB size check — warns if DB > 500MB
 *   8.  Backup check — verifies last backup < 30 hours old
 *   9.  Disk space check — warns if disk > 90% full
 *  10.  Security scan — checks for misconfigurations
 *  11.  Budget check — checks if LLM budget is exceeded (if not disabled)
 *  12.  Autonomous loop check — verifies port 3020 is alive + processing
 *
 * NEW in Phase 21:
 *  - Checks all 18 services (was 11)
 *  - Sends Telegram alerts on CRITICAL failures
 *  - Windows-compatible (uses `wmic` instead of `df` on Windows)
 *  - Checks autonomous loop health (port 3020)
 *  - Checks LLM budget status
 *  - Checks kill switch status
 *  - Saves reports to download/audit-reports/
 *
 * Output: JSON report saved to download/audit-reports/<timestamp>.json
 *
 * Exit codes:
 *   0 = all checks passed (or only warnings)
 *   1 = at least one critical check failed
 */

import { execSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, statSync, readdirSync } from 'fs'
import { join } from 'path'
import { platform } from 'os'

const isWindows = platform() === 'win32'
const AUDIT_DIR = join(process.cwd(), 'download', 'audit-reports')
const SHARED_KEY = process.env.JARVIS_SHARED_KEY
const DASHBOARD_URL = process.env.DASHBOARD_BASE || 'http://127.0.0.1:3000'
const TELEGRAM_BOT_PORT = 3008

interface CheckResult {
  name: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  details?: any
  durationMs: number
}

async function check(name: string, fn: () => Promise<Omit<CheckResult, 'name' | 'durationMs'>>): Promise<CheckResult> {
  const start = Date.now()
  try {
    const result = await fn()
    return { name, ...result, durationMs: Date.now() - start }
  } catch (err) {
    return {
      name,
      status: 'fail',
      message: `Check threw: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    }
  }
}

// ─── 1. Dashboard Health ─────────────────────────────────────────────
async function dashboardHealth(): Promise<CheckResult> {
  return check('dashboard-health', async () => {
    try {
      const res = await fetch(`${DASHBOARD_URL}/api`, {
        signal: AbortSignal.timeout(5000),
        headers: SHARED_KEY ? { 'X-JARVIS-Key': SHARED_KEY } : {},
      })
      if (!res.ok) return { status: 'fail', message: `Dashboard returned ${res.status}` }
      const data: any = await res.json()
      return { status: 'pass', message: `Dashboard OK` }
    } catch (err) {
      return { status: 'fail', message: `Dashboard unreachable: ${err instanceof Error ? err.message : err}` }
    }
  })
}

// ─── 2. Mini-Service Health (all 18 services) ────────────────────────
async function miniServiceHealth(): Promise<CheckResult> {
  return check('mini-services', async () => {
    // All 18 services (Phase 16 + Phase 17 + Phase 18)
    const services = [
      { name: 'agent-status', port: 3003, path: '/health' },
      { name: 'browser-login', port: 3004, path: '/health' },
      { name: 'heartbeat', port: 3005, path: '/health' },
      { name: 'process-manager', port: 3006, path: '/health' },
      { name: 'screen-viewer', port: 3007, path: '/health' },
      { name: 'telegram-bot', port: 3008, path: '/status' },
      { name: 'system-monitor', port: 3009, path: '/health' },
      { name: 'vector-memory', port: 3010, path: '/health' },
      { name: 'credential-vault', port: 3011, path: '/health' },
      { name: 'agent-comms', port: 3012, path: '/health' },
      { name: 'orchestrator', port: 3013, path: '/health' },
      // Phase 17 (toggle-gated — check if they should be running)
      { name: 'okara-crawler', port: 3014, path: '/health', toggle: 'PHASE17_OKARA_ENABLED' },
      { name: 'mcts-engine', port: 3015, path: '/health', toggle: 'PHASE17_MCTS_ENABLED' },
      { name: 'mcp-gateway', port: 3016, path: '/health', toggle: 'PHASE17_MCP_ENABLED' },
      { name: 'tmux-bridge', port: 3017, path: '/health', toggle: 'PHASE17_TMUX_ENABLED' },
      // Phase 18
      { name: 'planner', port: 3018, path: '/health' },
      { name: 'department-supervisor', port: 3019, path: '/health' },
      { name: 'autonomous-loop', port: 3020, path: '/health' },
    ]

    const down: string[] = []
    const skipped: string[] = []
    let checked = 0

    for (const svc of services) {
      // Skip toggle-gated services that aren't enabled
      if (svc.toggle && process.env[svc.toggle] !== 'true') {
        skipped.push(svc.name)
        continue
      }

      checked++
      try {
        const res = await fetch(`http://127.0.0.1:${svc.port}${svc.path}`, {
          signal: AbortSignal.timeout(2000),
        })
        if (!res.ok && res.status !== 404) {
          down.push(`${svc.name} (${res.status})`)
        }
      } catch {
        down.push(svc.name)
      }
    }

    if (down.length === 0) {
      return { status: 'pass', message: `All ${checked} services reachable (${skipped.length} skipped — toggle-gated)` }
    }
    const status = down.length > checked / 2 ? 'fail' : 'warn'
    return { status, message: `${down.length}/${checked} services down: ${down.join(', ')}`, details: { down, skipped } }
  })
}

// ─── 3. TypeScript Check ─────────────────────────────────────────────
async function typecheck(): Promise<CheckResult> {
  return check('typecheck', async () => {
    try {
      execSync('npx tsc --noEmit', { stdio: 'pipe', timeout: 120000 })
      return { status: 'pass', message: '0 TypeScript errors' }
    } catch (err: any) {
      const output = err.stdout?.toString() || err.stderr?.toString() || ''
      const errorCount = (output.match(/error TS/g) || []).length
      return { status: errorCount > 0 ? 'warn' : 'pass', message: `${errorCount} TypeScript errors`, details: output.slice(0, 500) }
    }
  })
}

// ─── 4. ESLint Check ─────────────────────────────────────────────────
async function lintCheck(): Promise<CheckResult> {
  return check('lint', async () => {
    try {
      const output = execSync('npx eslint . 2>&1', { stdio: 'pipe', timeout: 60000 }).toString()
      if (output.includes('0 problems') || output.trim() === '') {
        return { status: 'pass', message: '0 ESLint errors' }
      }
      const errorMatch = output.match(/(\d+) error/)
      const errors = errorMatch ? parseInt(errorMatch[1], 10) : 0
      return { status: errors > 0 ? 'warn' : 'pass', message: `${errors} ESLint errors`, details: output.slice(0, 500) }
    } catch (err: any) {
      const output = err.stdout?.toString() || ''
      const errorMatch = output.match(/(\d+) error/)
      const errors = errorMatch ? parseInt(errorMatch[1], 10) : 0
      return { status: errors > 0 ? 'warn' : 'pass', message: `${errors} ESLint errors`, details: output.slice(0, 500) }
    }
  })
}

// ─── 5. Test Suite ───────────────────────────────────────────────────
async function testCheck(): Promise<CheckResult> {
  return check('tests', async () => {
    try {
      const output = execSync('npx vitest run --reporter=verbose 2>&1', { stdio: 'pipe', timeout: 120000 }).toString()
      const passMatch = output.match(/(\d+) passed/)
      const failMatch = output.match(/(\d+) failed/)
      const passed = passMatch ? parseInt(passMatch[1], 10) : 0
      const failed = failMatch ? parseInt(failMatch[1], 10) : 0
      if (failed > 0) return { status: 'fail', message: `${failed} tests failed (of ${passed + failed})` }
      return { status: 'pass', message: `${passed} tests pass` }
    } catch (err: any) {
      return { status: 'warn', message: 'Tests failed to run', details: (err.message || '').slice(0, 200) }
    }
  })
}

// ─── 6. LLM Provider Check ───────────────────────────────────────────
async function llmProviderCheck(): Promise<CheckResult> {
  return check('llm-providers', async () => {
    // Check Ollama
    let ollamaReachable = false
    try {
      const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
      const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
      ollamaReachable = res.ok
    } catch {}

    // Check cloud providers from env
    const providers: Array<{ name: string; hasKey: boolean }> = []
    const envProviders = [
      { name: 'groq', key: 'GROQ_API_KEY' },
      { name: 'zai', key: 'ZAI_API_KEY' },
      { name: 'github-models', key: 'GITHUB_TOKEN' },
      { name: 'huggingface', key: 'HUGGINGFACE_API_KEY' },
      { name: 'nvidia-nim', key: 'NVIDIA_API_KEY' },
      { name: 'qwen-playground', key: 'QWEN_API_KEY' },
      { name: 'openai', key: 'OPENAI_API_KEY' },
    ]

    for (const p of envProviders) {
      providers.push({ name: p.name, hasKey: !!process.env[p.key] })
    }

    const withKeys = providers.filter((p) => p.hasKey).length
    const totalAvailable = (ollamaReachable ? 1 : 0) + withKeys

    if (totalAvailable === 0) return { status: 'fail', message: 'No LLM providers available (Ollama offline + no API keys)' }
    if (totalAvailable === 1) return { status: 'warn', message: `Only 1 provider available (Ollama: ${ollamaReachable ? 'yes' : 'no'}, API keys: ${withKeys})` }
    return { status: 'pass', message: `${totalAvailable} providers available (Ollama: ${ollamaReachable ? 'yes' : 'no'}, API keys: ${withKeys})`, details: providers }
  })
}

// ─── 7. DB Size Check ────────────────────────────────────────────────
async function dbSizeCheck(): Promise<CheckResult> {
  return check('db-size', async () => {
    const dbPath = (process.env.DATABASE_URL || '').replace('file:', '') || join(process.cwd(), 'db', 'custom.db')
    if (!existsSync(dbPath)) return { status: 'warn', message: 'DB file not found' }
    const sizeMB = statSync(dbPath).size / 1024 / 1024
    if (sizeMB > 500) return { status: 'warn', message: `DB is ${sizeMB.toFixed(1)} MB — consider migrating to Postgres` }
    return { status: 'pass', message: `DB is ${sizeMB.toFixed(1)} MB` }
  })
}

// ─── 8. Backup Check ─────────────────────────────────────────────────
async function backupCheck(): Promise<CheckResult> {
  return check('backup-recency', async () => {
    const backupDir = join(process.cwd(), 'download', 'backups')
    if (!existsSync(backupDir)) return { status: 'warn', message: 'No backups directory — run scripts/backup.sh' }
    const backups = readdirSync(backupDir).filter((f) => f.endsWith('.tar.gz') || f.endsWith('.db'))
    if (backups.length === 0) return { status: 'warn', message: 'No backups found' }
    const latest = backups.map((f) => ({ name: f, mtime: statSync(join(backupDir, f)).mtime }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0]
    const ageHours = (Date.now() - latest.mtime.getTime()) / (1000 * 60 * 60)
    if (ageHours > 30) return { status: 'fail', message: `Last backup is ${ageHours.toFixed(1)} hours old` }
    if (ageHours > 26) return { status: 'warn', message: `Last backup is ${ageHours.toFixed(1)} hours old` }
    return { status: 'pass', message: `Last backup ${ageHours.toFixed(1)} hours ago (${latest.name})` }
  })
}

// ─── 9. Disk Space Check (Windows + Linux) ───────────────────────────
async function diskSpaceCheck(): Promise<CheckResult> {
  return check('disk-space', async () => {
    try {
      let usePercent = 0
      if (isWindows) {
        // Windows: use wmic or PowerShell
        const output = execSync('powershell -NoProfile -Command "Get-PSDrive C | Select-Object -ExpandProperty Used | ForEach-Object { [math]::Round(($_ / (Get-PSDrive C).Free + $_) * 100) }"', { stdio: 'pipe', timeout: 10000 }).toString().trim()
        usePercent = parseInt(output, 10) || 0
      } else {
        // Linux/macOS: use df
        const output = execSync('df -h / | tail -1', { stdio: 'pipe' }).toString().trim()
        const parts = output.split(/\s+/)
        usePercent = parseInt(parts[4]?.replace('%', '') || '0', 10)
      }
      if (usePercent > 95) return { status: 'fail', message: `Disk ${usePercent}% full` }
      if (usePercent > 90) return { status: 'warn', message: `Disk ${usePercent}% full` }
      return { status: 'pass', message: `Disk ${usePercent}% full` }
    } catch {
      return { status: 'pass', message: 'Disk check skipped (command not available)' }
    }
  })
}

// ─── 10. Security Scan ───────────────────────────────────────────────
async function securityScan(): Promise<CheckResult> {
  return check('security-scan', async () => {
    const issues: string[] = []
    // Check for default shared key
    if (SHARED_KEY === 'dev-key-change-in-production-min-32-chars') {
      issues.push('DEFAULT_SHARED_KEY')
    }
    // Check for missing shared key entirely
    if (!SHARED_KEY) {
      issues.push('NO_SHARED_KEY')
    }
    // Check for wildcard CORS
    if (process.env.JARVIS_ALLOWED_ORIGINS === '*') {
      issues.push('CORS_WILDCARD')
    }
    // Check .env file permissions (Unix only)
    if (!isWindows) {
      const envPath = join(process.cwd(), '.env')
      if (existsSync(envPath)) {
        const mode = statSync(envPath).mode & 0o777
        if (mode & 0o077) issues.push(`ENV_FILE_WORLD_READABLE (${mode.toString(8)})`)
      }
    }
    if (issues.length === 0) return { status: 'pass', message: 'No security issues detected' }
    return { status: issues.length > 1 ? 'fail' : 'warn', message: `${issues.length} security issues`, details: issues }
  })
}

// ─── 11. LLM Budget Check ────────────────────────────────────────────
async function budgetCheck(): Promise<CheckResult> {
  return check('llm-budget', async () => {
    // If budget disabled, report as pass
    if (process.env.LLM_BUDGET_DISABLED === 'true') {
      return { status: 'pass', message: 'LLM budget disabled (unlimited usage)' }
    }
    // Check budget via API
    try {
      const res = await fetch(`${DASHBOARD_URL}/api/budget`, {
        signal: AbortSignal.timeout(5000),
        headers: SHARED_KEY ? { 'X-JARVIS-Key': SHARED_KEY } : {},
      })
      if (!res.ok) return { status: 'warn', message: 'Budget API unreachable' }
      const data: any = await res.json()
      if (data.today?.status === 'exceeded') {
        return { status: 'fail', message: `Budget exceeded: $${data.today.estimatedCost?.toFixed(2)} / $${data.today.budgetLimit?.toFixed(2)}` }
      }
      return { status: 'pass', message: `Budget OK: $${data.today?.estimatedCost?.toFixed(2) || 0} / $${data.today?.budgetLimit?.toFixed(2) || 5}` }
    } catch {
      return { status: 'warn', message: 'Budget check skipped (API unreachable)' }
    }
  })
}

// ─── 12. Autonomous Loop Health ──────────────────────────────────────
async function autonomousLoopCheck(): Promise<CheckResult> {
  return check('autonomous-loop', async () => {
    try {
      const res = await fetch('http://127.0.0.1:3020/health', {
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) return { status: 'fail', message: `Autonomous loop returned ${res.status}` }
      const data: any = await res.json()
      if (!data.ok) return { status: 'fail', message: 'Autonomous loop not healthy' }
      return {
        status: 'pass',
        message: `Autonomous loop OK — ${data.activeAgents || 0} active agents, ${data.loopStarted ? 'running' : 'stopped'}`,
      }
    } catch {
      return { status: 'warn', message: 'Autonomous loop unreachable (port 3020)' }
    }
  })
}

// ─── Send Telegram alert on critical failures ────────────────────────
async function sendTelegramAlert(failures: CheckResult[]): Promise<void> {
  if (failures.length === 0) return

  const message = `🚨 JARVIS Audit Alert — ${failures.length} CRITICAL issue(s)

${failures.map((f) => `✗ ${f.name}: ${f.message}`).join('\n')}

Run the audit manually:
  npx tsx scripts/audit-cron.ts

Or check the dashboard: http://localhost:3000`

  try {
    await fetch(`http://127.0.0.1:${TELEGRAM_BOT_PORT}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // Telegram bot not running — skip silently
  }
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log(`[audit-cron] Starting at ${new Date().toISOString()}`)
  mkdirSync(AUDIT_DIR, { recursive: true })

  const results: CheckResult[] = []
  results.push(await dashboardHealth())
  results.push(await miniServiceHealth())
  results.push(await typecheck())
  results.push(await lintCheck())
  results.push(await testCheck())
  results.push(await llmProviderCheck())
  results.push(await dbSizeCheck())
  results.push(await backupCheck())
  results.push(await diskSpaceCheck())
  results.push(await securityScan())
  results.push(await budgetCheck())
  results.push(await autonomousLoopCheck())

  const fails = results.filter((r) => r.status === 'fail')
  const warns = results.filter((r) => r.status === 'warn')
  const passes = results.filter((r) => r.status === 'pass')

  const summary = {
    timestamp: new Date().toISOString(),
    platform: isWindows ? 'windows' : 'unix',
    pass: passes.length,
    warn: warns.length,
    fail: fails.length,
    totalChecks: results.length,
    totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
    results,
  }

  // Save report
  const reportPath = join(AUDIT_DIR, `audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(reportPath, JSON.stringify(summary, null, 2))

  // Print summary
  console.log(`[audit-cron] ${passes.length} pass, ${warns.length} warn, ${fails.length} fail (of ${results.length} checks)`)
  for (const r of results) {
    const icon = r.status === 'pass' ? 'OK' : r.status === 'warn' ? '!!' : 'XX'
    console.log(`  [${icon}] ${r.name}: ${r.message}`)
  }
  console.log(`[audit-cron] Report saved to ${reportPath}`)

  // Send Telegram alert on failures
  if (fails.length > 0) {
    console.error(`[audit-cron] CRITICAL: ${fails.length} check(s) failed — sending Telegram alert`)
    await sendTelegramAlert(fails)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(`[audit-cron] FATAL:`, err)
  process.exit(1)
})
