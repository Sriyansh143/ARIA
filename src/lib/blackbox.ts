/**
 * src/lib/blackbox.ts — In-memory flight recorder.
 *
 * Captures decisions, token spend, outbound actions, errors, and
 * autonomous actions. 1000-entry ring buffer, flushed to DB every 30s.
 *
 * Ported from v25.9.7-final legacy codebase. Adapted to use the
 * current app's db + logger + event-bus modules.
 *
 * Used by:
 *   - /api/blackbox (GET recent entries + stats)
 *   - simulation.ts (records agent decisions)
 *   - approval-decision.ts (records approval votes)
 *   - llm-client.ts (records token spend)
 *   - ErrorBoundary (correlates UI errors with backend decisions)
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export type BlackboxEntryType =
  | "decision"
  | "token-spend"
  | "outbound"
  | "error"
  | "autonomous-action"
  | "approval"
  | "system"
  | "security";

export interface BlackboxEntry {
  id: string;
  type: BlackboxEntryType;
  source: string; // module/agent that created the entry
  message: string;
  data: Record<string, unknown>;
  severity: "info" | "warn" | "error" | "critical";
  timestamp: number;
}

const MAX_ENTRIES = 1000;
const FLUSH_INTERVAL_MS = 30_000;

const buffer: BlackboxEntry[] = [];
let seq = 0;
let flushTimer: NodeJS.Timeout | null = null;
let started = false;

function genId(): string {
  seq = (seq + 1) % 1_000_000;
  return `bb-${Date.now()}-${seq}`;
}

/**
 * Record an entry to the blackbox.
 */
export function record(opts: {
  type: BlackboxEntryType;
  source: string;
  message: string;
  data?: Record<string, unknown>;
  severity?: "info" | "warn" | "error" | "critical";
}): string {
  const entry: BlackboxEntry = {
    id: genId(),
    type: opts.type,
    source: opts.source,
    message: opts.message,
    data: opts.data ?? {},
    severity: opts.severity ?? "info",
    timestamp: Date.now(),
  };
  buffer.push(entry);
  // Trim to MAX_ENTRIES (ring buffer behavior)
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
  // Log to console for critical/error
  if (entry.severity === "critical" || entry.severity === "error") {
    logger.error(`blackbox.${entry.type}`, {
      source: entry.source,
      message: entry.message,
      data: entry.data,
    });
  } else if (entry.severity === "warn") {
    logger.warn(`blackbox.${entry.type}`, { source: entry.source, message: entry.message });
  }
  return entry.id;
}

/**
 * Get recent entries (from in-memory buffer).
 */
export function getRecent(opts: {
  type?: BlackboxEntryType;
  severity?: string;
  limit?: number;
  since?: number;
} = {}): BlackboxEntry[] {
  let entries = [...buffer];
  if (opts.type) entries = entries.filter((e) => e.type === opts.type);
  if (opts.severity) entries = entries.filter((e) => e.severity === opts.severity);
  if (opts.since !== undefined) {
    const since = opts.since;
    entries = entries.filter((e) => e.timestamp >= since);
  }
  entries.sort((a, b) => b.timestamp - a.timestamp);
  return entries.slice(0, opts.limit ?? 100);
}

/**
 * Get a specific entry by ID.
 */
export function getById(id: string): BlackboxEntry | null {
  return buffer.find((e) => e.id === id) ?? null;
}

/**
 * Get stats.
 */
export function getStats(): {
  bufferSize: number;
  capacity: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
} {
  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const e of buffer) {
    byType[e.type] = (byType[e.type] ?? 0) + 1;
    bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
  }
  return { bufferSize: buffer.length, capacity: MAX_ENTRIES, byType, bySeverity };
}

/**
 * Flush buffer to DB (persist to AgentLog table).
 */
async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const snapshot = [...buffer];
  try {
    // Batch create (limit to last 100 to avoid huge writes)
    const toPersist = snapshot.slice(-100);
    for (const entry of toPersist) {
      try {
        await db.agentLog.create({
          data: {
            agentId: null,
            level: entry.severity === "critical" || entry.severity === "error" ? "error" : entry.severity === "warn" ? "warn" : "info",
            message: `[blackbox:${entry.type}] ${entry.source}: ${entry.message}`.slice(0, 1000),
            meta: JSON.stringify({ id: entry.id, data: entry.data, timestamp: entry.timestamp }).slice(0, 8000),
          },
        });
      } catch {
        // Individual entry persistence failure — skip
      }
    }
    logger.debug("blackbox.flush", { persisted: toPersist.length, bufferSize: buffer.length });
  } catch (err) {
    logger.warn("blackbox.flush-failed", { error: String(err) });
  }
}

/**
 * Start the blackbox flush daemon.
 */
export function startBlackbox(): void {
  if (started) return;
  started = true;
  flushTimer = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);
  logger.info("blackbox.started", { flushIntervalMs: FLUSH_INTERVAL_MS, capacity: MAX_ENTRIES });
}

/**
 * Stop the blackbox (graceful shutdown).
 */
export function stopBlackbox(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  void flush();
  started = false;
}

/**
 * Clear the buffer (for testing).
 */
export function clear(): void {
  buffer.length = 0;
}

/**
 * Inject feedback into a recorded decision (reinforcement learning signal).
 * This allows operators to mark a decision as "good" or "bad", which
 * future agent training loops can use to adjust behavior.
 */
export function injectFeedback(entryId: string, feedback: "positive" | "negative", note?: string): { ok: boolean; error?: string } {
  const entry = buffer.find((e) => e.id === entryId);
  if (!entry) {
    return { ok: false, error: "entry not found" };
  }
  entry.data = {
    ...entry.data,
    feedback,
    feedbackNote: note,
    feedbackAt: Date.now(),
  };
  record({
    type: "system",
    source: "operator-feedback",
    message: `Feedback injected for ${entry.source}: ${feedback}`,
    data: { entryId, feedback, note },
    severity: "info",
  });
  return { ok: true };
}
