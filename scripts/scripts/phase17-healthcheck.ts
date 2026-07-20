// =====================================================================
// phase17-healthcheck.ts — boot-time health validation for all 16 ports.
// =====================================================================
// Phase 17 / boot script helper.
//
// Polls /health on each port until it responds or timeout. Returns
// a consolidated status table.
//
// Ports:
//   3000         dashboard (Next.js)
//   3003-3013    11 existing mini-services
//   3014         okara-crawler (NEW)
//   3015         mcts-engine (NEW)
//   3016         mcp-gateway (NEW)
//   3017         tmux-bridge (NEW)
// =====================================================================

const SERVICES: { name: string; port: number; path: string }[] = [
  { name: 'dashboard',           port: 3000, path: '/api' },
  { name: 'agent-status',        port: 3003, path: '/health' },
  { name: 'browser-login',       port: 3004, path: '/health' },
  { name: 'heartbeat',           port: 3005, path: '/health' },
  { name: 'process-manager',     port: 3006, path: '/health' },
  { name: 'screen-viewer',       port: 3007, path: '/health' },
  { name: 'telegram-bot',        port: 3008, path: '/status' },
  { name: 'system-monitor',      port: 3009, path: '/health' },
  { name: 'vector-memory',       port: 3010, path: '/health' },
  { name: 'credential-vault',    port: 3011, path: '/health' },
  { name: 'agent-comms',         port: 3012, path: '/health' },
  { name: 'orchestrator',        port: 3013, path: '/health' },
  { name: 'okara-crawler (P17)', port: 3014, path: '/health' },
  { name: 'mcts-engine (P17)',   port: 3015, path: '/health' },
  { name: 'mcp-gateway (P17)',   port: 3016, path: '/health' },
  { name: 'tmux-bridge (P17)',   port: 3017, path: '/health' },
]

interface HealthResult {
  name: string
  port: number
  status: 'up' | 'down' | 'disabled'
  detail?: string
  responseMs?: number
}

async function probe(port: number, path: string, timeoutMs = 2000): Promise<{ ok: boolean; detail?: string; ms?: number }> {
  const start = Date.now()
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    const ms = Date.now() - start
    if (r.ok) {
      const body = await r.json().catch(() => ({}))
      return { ok: true, ms, detail: body?.service || body?.ok ? 'ok' : undefined }
    }
    return { ok: false, detail: `HTTP ${r.status}` }
  } catch (err: any) {
    return { ok: false, detail: err.message?.slice(0, 80) || 'unreachable' }
  }
}

async function waitForService(port: number, path: string, maxWaitMs = 30000): Promise<HealthResult> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const r = await probe(port, path, 1500)
    if (r.ok) {
      return { name: '', port, status: 'up', responseMs: r.ms, detail: r.detail }
    }
    await new Promise((res) => setTimeout(res, 1000))
  }
  return { name: '', port, status: 'down', detail: 'timeout' }
}

export async function runHealthcheck(maxWaitMs = 30000): Promise<HealthResult[]> {
  const results: HealthResult[] = []

  // First pass — quick probe (no wait) for already-running services
  const quickResults = await Promise.all(
    SERVICES.map(async (svc) => {
      // Check if this Phase 17 service is disabled
      const isP17 = svc.name.includes('(P17)')
      const toggle = {
        'okara-crawler (P17)': 'PHASE17_OKARA_ENABLED',
        'mcts-engine (P17)': 'PHASE17_MCTS_ENABLED',
        'mcp-gateway (P17)': 'PHASE17_MCP_ENABLED',
        'tmux-bridge (P17)': 'PHASE17_TMUX_ENABLED',
      }[svc.name]
      if (isP17 && toggle && process.env[toggle] !== 'true') {
        return { name: svc.name, port: svc.port, status: 'disabled' as const }
      }
      const r = await probe(svc.port, svc.path, 1500)
      return {
        name: svc.name,
        port: svc.port,
        status: r.ok ? ('up' as const) : ('down' as const),
        responseMs: r.ms,
        detail: r.detail,
      }
    }),
  )
  results.push(...quickResults)

  // Second pass — for any down services, wait up to maxWaitMs
  const down = results.filter((r) => r.status === 'down')
  if (down.length > 0) {
    const waited = await Promise.all(
      down.map(async (r) => {
        const svc = SERVICES.find((s) => s.port === r.port)!
        return waitForService(svc.port, svc.path, maxWaitMs)
      }),
    )
    for (let i = 0; i < waited.length; i++) {
      const originalIdx = results.indexOf(down[i])
      results[originalIdx] = { ...waited[i], name: down[i].name }
    }
  }

  return results
}

function formatTable(results: HealthResult[]): string {
  const rows = results.map((r) => {
    const status = r.status === 'up' ? '✓ UP' : r.status === 'disabled' ? '○ OFF' : '✗ DOWN'
    const ms = r.responseMs ? `${r.responseMs}ms` : '-'
    const detail = r.detail ? r.detail.slice(0, 40) : ''
    return `${status.padEnd(10)} :${String(r.port).padEnd(5)} ${r.name.padEnd(28)} ${ms.padEnd(8)} ${detail}`
  })
  return [
    '================================================================',
    '  JARVIS Phase 17 — Service Health Status',
    '================================================================',
    ...rows,
    '================================================================',
  ].join('\n')
}

// CLI entry
// FIX (H10 / audit 2026-07-10): `require.main === module` is CommonJS-only.
// With tsx (ESM mode), `require` is undefined → ReferenceError. Use the ESM
// equivalent: compare process.argv[1] to the current file's URL.
import { fileURLToPath } from 'url'
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runHealthcheck(parseInt(process.env.HEALTHCHECK_TIMEOUT_MS || '30000', 10))
    .then((results) => {
      console.log(formatTable(results))
      const allUp = results.every((r) => r.status !== 'down')
      process.exit(allUp ? 0 : 1)
    })
    .catch((err) => {
      console.error('healthcheck failed:', err)
      process.exit(1)
    })
}

export { formatTable, SERVICES }