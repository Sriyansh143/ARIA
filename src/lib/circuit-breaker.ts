// Circuit Breaker for LLM Providers — tracks failure rate per provider over
// a rolling 60s window. Opens on 3 consecutive failures OR 30% rate (min 3
// samples). When open, the router bypasses the provider immediately.
//
// Adapted for v10: the original persist/loaded from a `circuitBreakerState`
// Prisma model that doesn't exist in our schema. We keep the in-memory
// state (which is the source of truth for routing decisions) and drop the
// optional DB persistence. The public API is unchanged so callers that
// import `recordSuccess` / `recordFailure` / `isAvailable` /
// `getAllCircuitStates` / `resetCircuit` continue to work.

type CircuitState = 'closed' | 'open' | 'half_open'

interface CircuitRecord {
  provider: string
  state: CircuitState
  failures: number
  successes: number
  recentFailures: number[]
  recentSuccesses: number[]
  consecutiveFailures: number
  lastFailure: number | null
  lastSuccess: number | null
  openedAt: number | null
}

const circuits = new Map<string, CircuitRecord>()
const WINDOW_MS = 60_000
const FAILURE_RATE_THRESHOLD = 0.3
const CONSECUTIVE_FAILURE_THRESHOLD = 3
const OPEN_DURATION_MS = 5 * 60_000

function getOrCreate(provider: string): CircuitRecord {
  let rec = circuits.get(provider)
  if (!rec) {
    rec = {
      provider,
      state: 'closed',
      failures: 0,
      successes: 0,
      recentFailures: [],
      recentSuccesses: [],
      consecutiveFailures: 0,
      lastFailure: null,
      lastSuccess: null,
      openedAt: null,
    }
    circuits.set(provider, rec)
  }
  return rec
}

function pruneWindow(arr: number[], now: number): number[] {
  const cutoff = now - WINDOW_MS
  return arr.filter((t) => t > cutoff)
}

export function recordSuccess(provider: string): void {
  const rec = getOrCreate(provider)
  const now = Date.now()
  rec.recentSuccesses = pruneWindow(rec.recentSuccesses, now)
  rec.recentSuccesses.push(now)
  rec.successes++
  rec.lastSuccess = now
  rec.consecutiveFailures = 0
  if (rec.state === 'half_open') {
    rec.state = 'closed'
    rec.openedAt = null
    console.log(`[circuit-breaker] ${provider}: half_open → closed`)
  }
}

export function recordFailure(provider: string, reason?: string): void {
  const rec = getOrCreate(provider)
  const now = Date.now()
  rec.recentFailures = pruneWindow(rec.recentFailures, now)
  rec.recentFailures.push(now)
  rec.failures++
  rec.consecutiveFailures++
  rec.lastFailure = now
  if (rec.state === 'half_open') {
    rec.state = 'open'
    rec.openedAt = now
    console.log(
      `[circuit-breaker] ${provider}: half_open → open (probe failed: ${reason ?? 'unknown'})`,
    )
  } else if (rec.state === 'closed') {
    const total = rec.recentFailures.length + rec.recentSuccesses.length
    const failureRate = total > 0 ? rec.recentFailures.length / total : 0
    const rateThresholdMet = total >= 3 && failureRate >= FAILURE_RATE_THRESHOLD
    if (rec.consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD || rateThresholdMet) {
      rec.state = 'open'
      rec.openedAt = now
      console.log(
        `[circuit-breaker] ${provider}: closed → open (consecutive=${rec.consecutiveFailures}, rate=${(
          failureRate * 100
        ).toFixed(0)}%, samples=${total}, reason=${reason ?? 'unknown'})`,
      )
    }
  }
}

export function isAvailable(provider: string): boolean {
  const rec = getOrCreate(provider)
  const now = Date.now()
  if (rec.state === 'open') {
    if (rec.openedAt && now - rec.openedAt >= OPEN_DURATION_MS) {
      rec.state = 'half_open'
      console.log(`[circuit-breaker] ${provider}: open → half_open`)
      return true
    }
    return false
  }
  return true
}

export function getAllCircuitStates() {
  const now = Date.now()
  return Array.from(circuits.values()).map((rec) => {
    const rf = pruneWindow(rec.recentFailures, now).length
    const rs = pruneWindow(rec.recentSuccesses, now).length
    const total = rf + rs
    return {
      provider: rec.provider,
      state: rec.state,
      failures: rec.failures,
      successes: rec.successes,
      failureRate: total > 0 ? rf / total : 0,
      consecutiveFailures: rec.consecutiveFailures,
      lastFailureAgoMs: rec.lastFailure ? now - rec.lastFailure : null,
      lastSuccessAgoMs: rec.lastSuccess ? now - rec.lastSuccess : null,
      openedAgoMs: rec.openedAt ? now - rec.openedAt : null,
    }
  })
}

export function resetCircuit(provider: string): void {
  circuits.delete(provider)
}

/** No-op kept for API compatibility — we no longer persist to DB. */
export async function loadCircuitStates(): Promise<void> {
  /* in-memory only */
}
