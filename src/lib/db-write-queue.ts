/**
 * src/lib/db-write-queue.ts — SQLite Write Queue (v58 Phase 3)
 *
 * Prevents SQLITE_BUSY errors when 30+ cron jobs + 69 agents write
 * to the database concurrently. SQLite uses file-level locking —
 * concurrent writes from different processes (or even the same process
 * during a long transaction) can fail with:
 *
 *   "SQLITE_BUSY: database is locked"
 *
 * This module:
 *   1. Buffers high-frequency write operations in an in-memory queue.
 *   2. Flushes them to SQLite every 100ms via a single background worker.
 *   3. Retries each write up to 3 times with exponential backoff on
 *      SQLITE_BUSY errors (rare with the queue, but possible during
 *      disk I/O contention).
 *
 * Usage:
 *   import { safeWrite } from "@/lib/db-write-queue";
 *   await safeWrite(() => db.agentLog.create({ data: { ... } }));
 *
 * For reads, use db directly — reads don't need the queue.
 * For low-frequency writes (orders, settings), use db directly — the
 * queue is only needed for high-frequency writes (logs, telemetry,
 * heartbeats) where contention is real.
 */

import { logger } from "./logger";

type WriteOp = () => Promise<unknown>;

interface QueueItem {
  op: WriteOp;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  retries: number;
  startedAt: number;
  label: string;
}

const FLUSH_INTERVAL_MS = 100; // 10 flushes per second
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 50; // 50ms, 100ms, 200ms
const MAX_QUEUE_DEPTH = 1000; // safety valve — if queue grows too large, drop oldest

let queue: QueueItem[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let isFlushing = false;
let totalProcessed = 0;
let totalErrors = 0;
let lastFlushAt = 0;

/**
 * Enqueue a write operation. Returns a Promise that resolves when the
 * write has been committed to the database.
 *
 * If the queue is full (MAX_QUEUE_DEPTH), the oldest pending write is
 * dropped + an error is logged. This is a last-resort safety valve to
 * prevent OOM in the rare case where the database is unreachable for
 * a long period.
 */
export function safeWrite<T>(op: () => Promise<T>, label = "anonymous-write"): Promise<T> {
  // Start the flush loop if it's not running
  ensureFlushLoop();

  return new Promise<T>((resolve, reject) => {
    // Safety valve: if queue is too deep, drop the oldest item
    if (queue.length >= MAX_QUEUE_DEPTH) {
      const dropped = queue.shift();
      if (dropped) {
        totalErrors++;
        logger.error("db-write-queue.overflow", {
          dropped: dropped.label,
          queueDepth: queue.length,
          hint: "Database may be unreachable — check connection",
        });
        dropped.reject(new Error("DB write queue overflow — item dropped"));
      }
    }

    queue.push({
      op: op as WriteOp,
      resolve: resolve as (value: unknown) => void,
      reject,
      retries: 0,
      startedAt: Date.now(),
      label,
    });
  });
}

/**
 * Batch-enqueue multiple writes. Returns when all are committed.
 * Useful for telemetry flushes that have many small writes.
 */
export async function safeWriteBatch<T>(ops: Array<() => Promise<T>>, label = "batch"): Promise<T[]> {
  const promises = ops.map((op) => safeWrite(op, label));
  return Promise.all(promises);
}

/**
 * Returns current queue depth + statistics.
 * Useful for monitoring + the dashboard.
 */
export function getQueueStats() {
  return {
    queueDepth: queue.length,
    isFlushing,
    totalProcessed,
    totalErrors,
    lastFlushAt: lastFlushAt ? new Date(lastFlushAt).toISOString() : null,
    flushIntervalMs: FLUSH_INTERVAL_MS,
  };
}

// ─── Internal flush loop ────────────────────────────────────────────

function ensureFlushLoop(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flush().catch((err) => {
      logger.error("db-write-queue.flush-failed", { error: String(err) });
    });
  }, FLUSH_INTERVAL_MS);
  // Don't keep the process alive just for the flush loop
  flushTimer.unref?.();
  logger.info("db-write-queue.started", { flushIntervalMs: FLUSH_INTERVAL_MS });
}

async function flush(): Promise<void> {
  if (isFlushing) return; // previous flush still running
  if (queue.length === 0) return;

  isFlushing = true;
  lastFlushAt = Date.now();

  // Take a snapshot of the current queue + process serially
  const batch = queue.slice(0, 50); // process at most 50 per flush
  queue = queue.slice(50);

  for (const item of batch) {
    try {
      const result = await item.op();
      item.resolve(result);
      totalProcessed++;
    } catch (err) {
      const errMsg = String(err);
      // Retry on SQLITE_BUSY (rare with the queue, but possible during disk contention)
      if (errMsg.includes("SQLITE_BUSY") || errMsg.includes("database is locked")) {
        if (item.retries < MAX_RETRIES) {
          item.retries++;
          const delayMs = RETRY_BASE_MS * Math.pow(2, item.retries - 1);
          await sleep(delayMs);
          // Re-enqueue at the front so it's retried first on the next flush
          queue.unshift(item);
        } else {
          totalErrors++;
          logger.error("db-write-queue.max-retries-exceeded", {
            label: item.label,
            retries: item.retries,
            error: errMsg.slice(0, 100),
          });
          item.reject(err);
        }
      } else {
        // Non-retryable error — reject immediately
        totalErrors++;
        item.reject(err);
      }
    }
  }

  isFlushing = false;

  // If the queue is growing, log a warning so the operator can investigate
  if (queue.length > 100) {
    logger.warn("db-write-queue.backpressure", {
      queueDepth: queue.length,
      hint: "High write contention — consider batching or reducing write frequency",
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stop the flush loop (for graceful shutdown).
 */
export function stopWriteQueue(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
    logger.info("db-write-queue.stopped", { totalProcessed, totalErrors });
  }
}
