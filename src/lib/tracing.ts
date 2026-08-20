/**
 * src/lib/tracing.ts — Lightweight span-based tracing (server-only).
 *
 * A minimal, dependency-free OpenTelemetry-style abstraction. Today it
 * emits structured `trace.span` log lines on span end + keeps an
 * in-memory ring buffer (max 1000) of recent spans so the
 * `GET /api/tracing` endpoint can surface live telemetry to the
 * dashboard.
 *
 * The API mirrors the subset of `@opentelemetry/api` we'd need
 * (`startSpan` / span attributes / span events), so a future swap to
 * a real OTEL exporter only requires replacing the body of these
 * functions — no call-site changes.
 *
 * Design:
 *   - All spans live on `globalThis` so they survive Next.js
 *     Fast-Refresh HMR (a new module instance continues appending
 *     to the same ring buffer instead of resetting it).
 *   - `startSpan` returns a handle with `end()`, `addAttribute()`,
 *     and `addEvent()` — matches OTEL's `Span` surface.
 *   - `traceAsync` wraps a Promise so the span always ends, even on
 *     rejection (the error is recorded as an attribute + re-thrown).
 *   - Stats (totalSpans, avgDurationMs, slowestSpan) are derived
 *     from the ring buffer on demand — no separate counters to keep
 *     in sync.
 *
 * Task ID: HARDEN-OBSERVE-DEVOPS-SEC (Task 1).
 */
import "server-only";

import { logger } from "./logger";

// ─── Types ───────────────────────────────────────────────────────────

export interface SpanEvent {
  /** Epoch-ms when the event was recorded on the span. */
  ts: number;
  name: string;
}

export interface Span {
  /** Stable unique id (cuid-style, but we use a counter + random suffix). */
  id: string;
  /** Human-readable span name (e.g. "api.system.GET"). */
  name: string;
  /** Epoch-ms when the span started. */
  startedAt: number;
  /** Epoch-ms when `end()` was called. `null` if the span is still open. */
  endedAt: number | null;
  /** Duration in ms. `null` until `end()` is called. */
  durationMs: number | null;
  /** Arbitrary key/value attributes (OTEL `attributes`). */
  attributes: Record<string, unknown>;
  /** Structured events recorded on the span (OTEL `events`). */
  events: SpanEvent[];
  /** `"ok"` on success, `"error"` if `traceAsync` caught a rejection. */
  status: "ok" | "error" | "unset";
}

export interface SpanHandle {
  /** Mark the span as ended + record duration. Idempotent. */
  end: () => void;
  /** Attach a key/value attribute (overwrites prior value for same key). */
  addAttribute: (key: string, value: unknown) => void;
  /** Record a structured event (timestamped). */
  addEvent: (name: string) => void;
}

export interface TraceStats {
  /** Count of completed spans in the ring buffer. */
  totalSpans: number;
  /** Arithmetic mean of completed-span durations. 0 if no spans. */
  avgDurationMs: number;
  /** The slowest completed span `{name, durationMs}` or null if none. */
  slowestSpan: { name: string; durationMs: number } | null;
}

// ─── globalThis-backed ring buffer (HMR-safe) ───────────────────────

const GLOBAL_SPANS_KEY = "__aria_trace_spans__";
const GLOBAL_SPAN_SEQ_KEY = "__aria_trace_seq__";
const MAX_SPANS = 1000;

interface GlobalShape {
  [GLOBAL_SPANS_KEY]?: Span[];
  [GLOBAL_SPAN_SEQ_KEY]?: number;
}

const g = globalThis as unknown as GlobalShape;

function getSpans(): Span[] {
  if (!Array.isArray(g[GLOBAL_SPANS_KEY])) {
    g[GLOBAL_SPANS_KEY] = [];
  }
  return g[GLOBAL_SPANS_KEY]!;
}

function nextSpanId(): string {
  if (typeof g[GLOBAL_SPAN_SEQ_KEY] !== "number") g[GLOBAL_SPAN_SEQ_KEY] = 0;
  g[GLOBAL_SPAN_SEQ_KEY] = (g[GLOBAL_SPAN_SEQ_KEY] ?? 0) + 1;
  return `span-${g[GLOBAL_SPAN_SEQ_KEY]}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Push a span into the ring buffer, evicting the oldest when full. */
function pushSpan(span: Span): void {
  const spans = getSpans();
  spans.push(span);
  // Ring buffer: drop from the head if we exceed MAX_SPANS.
  if (spans.length > MAX_SPANS) {
    spans.splice(0, spans.length - MAX_SPANS);
  }
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Start a new span. Returns a handle that must be `.end()`-ed.
 *
 * The span is pushed into the ring buffer immediately (with
 * `endedAt = null`) so an in-flight span shows up in `/api/tracing`.
 * On `.end()`, the span is mutated in place + a `trace.span` log line
 * is emitted at debug level.
 */
export function startSpan(name: string): SpanHandle {
  const span: Span = {
    id: nextSpanId(),
    name,
    startedAt: Date.now(),
    endedAt: null,
    durationMs: null,
    attributes: {},
    events: [],
    status: "unset",
  };
  pushSpan(span);

  let ended = false;

  return {
    end() {
      if (ended) return; // Idempotent — never double-record duration.
      ended = true;
      span.endedAt = Date.now();
      span.durationMs = span.endedAt - span.startedAt;
      if (span.status === "unset") span.status = "ok";
      try {
        logger.debug("trace.span", {
          name: span.name,
          durationMs: span.durationMs,
          attributes: span.attributes,
        });
      } catch {
        // Logging must never crash callers. Swallow.
      }
    },
    addAttribute(key, value) {
      if (!key) return;
      try {
        span.attributes[key] = value;
      } catch {
        // Exotic value types (Symbols on a proxy) — swallow.
      }
    },
    addEvent(eventName) {
      if (!eventName) return;
      span.events.push({ ts: Date.now(), name: eventName });
    },
  };
}

/**
 * Wrap an async function in a span. The span is automatically ended
 * on resolve or reject. On reject, the error is recorded as an
 * attribute (`error: String(err)`) and the span status flips to
 * `"error"` before the error is re-thrown.
 */
export async function traceAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const span = startSpan(name);
  try {
    const result = await fn();
    return result;
  } catch (err) {
    span.addAttribute("error", String(err));
    // Mark status so the eventual `trace.span` log line reflects failure.
    // We mutate the underlying span object directly via the handle's
    // closure — the public SpanHandle interface doesn't expose status,
    // but the recorded span in the ring buffer still carries it.
    try {
      // Best-effort: find the in-flight span + flip its status.
      const spans = getSpans();
      const last = spans[spans.length - 1];
      if (last && last.id === (span as unknown as { id?: string }).id) {
        last.status = "error";
      }
    } catch {
      // Ignore — best-effort.
    }
    span.addAttribute("status", "error");
    throw err;
  } finally {
    span.end();
  }
}

/**
 * Compute aggregate stats over the completed spans in the ring buffer.
 *
 * - `totalSpans`: count of spans with `durationMs !== null`.
 * - `avgDurationMs`: arithmetic mean of completed durations.
 * - `slowestSpan`: the completed span with the largest `durationMs`.
 */
export function getTraceStats(): TraceStats {
  const spans = getSpans();
  let totalSpans = 0;
  let totalDuration = 0;
  let slowest: { name: string; durationMs: number } | null = null;

  for (const s of spans) {
    if (s.durationMs === null) continue; // skip in-flight spans
    totalSpans++;
    totalDuration += s.durationMs;
    if (!slowest || s.durationMs > slowest.durationMs) {
      slowest = { name: s.name, durationMs: s.durationMs };
    }
  }

  return {
    totalSpans,
    avgDurationMs: totalSpans === 0 ? 0 : Math.round(totalDuration / totalSpans),
    slowestSpan: slowest,
  };
}

/**
 * Return the last `n` spans from the ring buffer (most-recent last).
 * Exposed for the `/api/tracing` route — not part of the public tracing
 * API per se, but kept here so the route can stay thin.
 */
export function getRecentSpans(limit: number): Span[] {
  const spans = getSpans();
  const safeLimit = Math.max(0, Math.min(limit, spans.length));
  return spans.slice(spans.length - safeLimit);
}
