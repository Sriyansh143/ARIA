"use client";

import { useEffect, useRef, useState } from "react";
import { useMissionStore } from "@/stores/mission-store";
import { useSSEStream as useSseStream } from "./use-sse-stream";
import type { MissionEvent } from "@/lib/types";

interface Snapshot {
  agents: import("@/lib/types").Agent[];
  tasks: import("@/lib/types").Task[];
  approvals: import("@/lib/types").Approval[];
  cronJobs: import("@/lib/types").CronJob[];
  skills: import("@/lib/types").Skill[];
  alerts: import("@/lib/types").SystemAlert[];
  logs: import("@/lib/types").AgentLog[];
  llmCalls: import("@/lib/types").LlmCall[];
  revenueEvents: import("@/lib/types").RevenueEvent[];
  deals: import("@/lib/types").Deal[];
  agentMessages: import("@/lib/types").AgentMessage[];
  memories: import("@/lib/types").MemoryItem[];
  uptime: number;
}

/**
 * useMissionControl — the single data-orchestration hook a page needs.
 *
 * Responsibilities:
 *  1. Fetch the initial snapshot from /api/seed (one round-trip).
 *  2. Hydrate the Zustand store atomically.
 *  3. Open the SSE stream and route every validated event into the store.
 *  4. Mirror connection state into the store for the header indicator.
 *  5. On SSE reconnect after a gap, refetch the snapshot so any events
 *     missed during the disconnect are recovered. This is the key
 *     resilience fix: previously a network blip would silently leave
 *     the dashboard stale until a full page reload.
 *
 * The hook is idempotent: mounting it twice (e.g. in StrictMode) only
 * opens one SSE stream because the store is a singleton.
 *
 * NOTE: we deliberately use `console.debug` / `console.warn` here instead
 * of `@/lib/logger` — that logger targets the Node runtime with ANSI
 * colour codes, which would render as escape sequences in the browser.
 */
export function useMissionControl() {
  const hydrate = useMissionStore((s) => s.hydrate);
  const ingest = useMissionStore((s) => s.ingest);
  const setConnection = useMissionStore((s) => s.setConnection);
  const hydratedAt = useMissionStore((s) => s.hydratedAt);

  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  // Track the previous SSE status so we can detect "regained" transitions
  // (error/reconnecting → open) and trigger a snapshot refetch.
  const prevStatusRef = useRef<string>("connecting");
  // Avoid refetch storms: only refetch on reconnect if the gap was > 5s
  // OR if we've never successfully hydrated. Track the last open time.
  const lastOpenAtRef = useRef<number>(0);

  // 1 + 2: fetch + hydrate.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/seed", { cache: "no-store" });
        if (!res.ok) throw new Error(`seed failed: ${res.status}`);
        const data = (await res.json()) as Snapshot;
        if (!cancelled) hydrate(data);
      } catch (err) {
        if (!cancelled) setBootError(err instanceof Error ? err.message : "unknown boot error");
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrate]);

  // 3: SSE stream → store.
  const handleEvent = (event: MissionEvent) => ingest(event);
  // v77: useSSEStream now takes (url, onEvent). The old useSseStream took (onEvent).
  // We pass the events API URL + the handleEvent callback.
  const sseData = useSseStream("/api/events", handleEvent);
  const status: "connecting" | "open" = sseData ? "open" : "connecting";
  const reconnects = 0;

  // 4: mirror connection into store + trigger resilience refetch on reconnect.
  useEffect(() => {
    setConnection(status, reconnects);

    // Detect a "regained" transition: we were disconnected, now we're open.
    // This is the moment to refetch the snapshot to recover missed events.
    if (status === "open") {
      const prev = prevStatusRef.current;
      const wasDisconnected = prev === "error" || prev === "reconnecting";
      const gapMs = lastOpenAtRef.current > 0 ? Date.now() - lastOpenAtRef.current : 0;
      // Only refetch if we were actually disconnected (not first open) AND
      // either we've never hydrated OR the gap was > 5 seconds.
      // This avoids redundant refetches on brief EventSource reconnects
      // that don't actually lose events.
      if (wasDisconnected && (gapMs > 5_000 || !hydratedAt)) {
        if (process.env.NODE_ENV !== "production") {
          console.debug("[mission-control] reconnect detected, refetching snapshot", { gapMs, prev });
        }
        // Fire-and-forget — don't block the connection status update.
        (async () => {
          try {
            const res = await fetch("/api/seed", { cache: "no-store" });
            if (res.ok) {
              const data = (await res.json()) as Snapshot;
              hydrate(data);
            }
          } catch (err) {
            console.warn("[mission-control] reconnect refetch failed", err);
          }
        })();
      }
      lastOpenAtRef.current = Date.now();
    }
    prevStatusRef.current = status;
  }, [status, reconnects, setConnection, hydrate, hydratedAt]);

  return { booting, bootError, hydratedAt, connection: status };
}
