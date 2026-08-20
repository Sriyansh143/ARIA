/**
 * ARIA Mission Control — Pulse history + state-of-world sentence builder.
 *
 * Ported from FounderOS-DEMO/lib/pulse-history.ts, adapted for ARIA's types.
 * The original read `runs: { startedAt }[]` and `items: { ts }[]`; ARIA's
 * shape is `Event[]` (typed envelopes with `createdAt` + `ts`) and
 * `AgentMessage[]` (`createdAt`). Both adapt cleanly — the bucketing math
 * is the same; only the field accessor changes.
 *
 * The `stateOfWorld` function builds one worst-first English sentence about
 * what the operator needs to see. Ported from FounderOS but adapted for
 * ARIA's `SystemAlert` (severity) + `Agent` (status) — ARIA's vocabulary is
 * different from FounderOS's `PulseFacts` (activeAgents, brainConnected,
 * etc.). The shape is: critical alerts first, then agents in error state,
 * then a "system nominal" anchor.
 *
 * Pure + deterministic: every function takes its inputs as arguments.
 * `nowMs` is injectable so tests are stable across DST boundaries.
 */
import type { SystemAlert, Agent, AgentMessage } from "@/lib/types";

/**
 * Minimal structural shape for an event row. ARIA's `Event` Prisma model has
 * `createdAt` (and `type`, `payload`, `channel`); we only need the timestamp
 * for day-bucketing. Declared locally to avoid coupling this pure module to
 * Prisma — the function accepts any row that has `createdAt: string`.
 */
export type EventRow = { createdAt: string };

const DAY_MS = 86_400_000;

// ─── UTC-day bucketing (lifted verbatim from the FounderOS original) ──
/** UTC date keys (YYYY-MM-DD) for the last `days` days, oldest first. */
function dayKeys(days: number, nowMs: number): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    keys.push(new Date(nowMs - i * DAY_MS).toISOString().slice(0, 10));
  }
  return keys;
}

/** Count ISO timestamps into the last `days` UTC-day buckets (oldest first). */
function countPerDay(
  timestamps: (string | undefined | null)[],
  days: number,
  nowMs: number,
): number[] {
  const keys = dayKeys(days, nowMs);
  const index = new Map(keys.map((k, i) => [k, i]));
  const counts = new Array<number>(days).fill(0);
  for (const ts of timestamps) {
    if (!ts) continue;
    const t = Date.parse(ts);
    if (!Number.isFinite(t)) continue;
    const i = index.get(new Date(t).toISOString().slice(0, 10));
    if (i !== undefined) counts[i] += 1;
  }
  return counts;
}

// ─── Per-day series ──────────────────────────────────────────────────
export type DailyCount = { date: string; count: number };

/**
 * Bucket events by UTC day for the last `days` days, oldest to newest.
 * Days with zero events still appear (count: 0) so the sparkline array is
 * always exactly `days` long — the UI never has to pad.
 */
export function runsPerDay(
  events: EventRow[],
  days: number = 7,
  nowMs: number = Date.now(),
): DailyCount[] {
  const counts = countPerDay(
    events.map((e) => e.createdAt),
    days,
    nowMs,
  );
  return dayKeys(days, nowMs).map((date, i) => ({ date, count: counts[i] }));
}

/**
 * Bucket inter-agent messages by UTC day. Same shape as `runsPerDay` —
 * the "inbound" name is preserved from the FounderOS original (where it
 * counted comms-feed messages). Here it counts `AgentMessage` rows, which
 * is ARIA's equivalent of "things arriving that need a response".
 */
export function inboundPerDay(
  messages: (Pick<AgentMessage, "createdAt">)[],
  days: number = 7,
  nowMs: number = Date.now(),
): DailyCount[] {
  const counts = countPerDay(
    messages.map((m) => m.createdAt),
    days,
    nowMs,
  );
  return dayKeys(days, nowMs).map((date, i) => ({ date, count: counts[i] }));
}

// ─── State-of-world sentence builder ─────────────────────────────────
/**
 * One honest sentence about what needs the operator, worst-first:
 *   1. critical alerts (always first — they're the things that hurt)
 *   2. error/critical-severity agents (the fleet is bleeding)
 *   3. unacked alerts of any severity
 *   4. live agent count (always anchored at the end)
 *
 * Leads with "All nominal" only when nothing is actually wrong. Returns
 * a single string — callers format it however they like (ticker, toast,
 * page header). The sentence is comma-joined for natural reading.
 *
 * Adapted from FounderOS's `stateOfWorld(PulseFacts)` — the original
 * read a synthetic PulseFacts object (activeAgents, brainConnected, etc.).
 * ARIA doesn't have a brain provider or a connectors registry (yet), so
 * this version reads the real `SystemAlert[]` + `Agent[]` directly.
 * Simpler input, same worst-first discipline.
 */
export function stateOfWorld(
  alerts: SystemAlert[],
  agents: Agent[],
): string {
  const segs: string[] = [];

  // 1. Critical alerts, unacked first.
  const unacked = alerts.filter((a) => !a.ack);
  const critical = unacked.filter((a) => a.severity === "critical").length;
  const error = unacked.filter((a) => a.severity === "error").length;
  const warn = unacked.filter((a) => a.severity === "warn").length;

  if (critical > 0) segs.push(`${critical} critical alert${critical === 1 ? "" : "s"}`);
  if (error > 0) segs.push(`${error} error alert${error === 1 ? "" : "s"}`);
  if (warn > 0) segs.push(`${warn} warning${warn === 1 ? "" : "s"}`);

  // 2. Agents in error state.
  const errorAgents = agents.filter((a) => a.status === "error").length;
  if (errorAgents > 0) {
    segs.push(`${errorAgents} agent${errorAgents === 1 ? "" : "s"} in error state`);
  }

  // 3. Offline agents (degraded fleet).
  const offline = agents.filter((a) => a.status === "offline").length;
  if (offline > 0 && agents.length > 0) {
    const pct = Math.round((offline / agents.length) * 100);
    if (pct >= 25) segs.push(`system degraded (${pct}% of fleet offline)`);
  }

  // 4. Always anchor with the live agent count.
  const activeAgents = agents.filter(
    (a) => a.status !== "idle" && a.status !== "offline",
  ).length;
  segs.push(`${activeAgents}/${agents.length} agents live`);

  // If nothing critical, prepend the all-clear (FounderOS pattern).
  if (critical === 0 && error === 0 && errorAgents === 0) {
    segs.unshift("All nominal");
  }

  return segs.join(", ");
}

/**
 * A short severity label for the state — useful for color-coding the pulse
 * row. Returns one of: `"critical" | "error" | "warn" | "ok"`.
 */
export function stateSeverity(
  alerts: SystemAlert[],
  agents: Agent[],
): "critical" | "error" | "warn" | "ok" {
  const unacked = alerts.filter((a) => !a.ack);
  if (unacked.some((a) => a.severity === "critical")) return "critical";
  if (unacked.some((a) => a.severity === "error")) return "error";
  if (agents.some((a) => a.status === "error")) return "error";
  if (unacked.some((a) => a.severity === "warn")) return "warn";
  return "ok";
}
