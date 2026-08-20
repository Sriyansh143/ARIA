import { bus } from "@/lib/event-bus";
import { logger } from "@/lib/logger";
import { seedIfEmpty, startEngine } from "@/lib/simulation";
import { NextResponse } from "next/server";
import type { MissionEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/events — Server-Sent Events stream.
 *
 * Subscribes to the in-process event bus and fans validated `MissionEvent`
 * envelopes to the client. Resilient by design:
 *  - Keepalive comment every 15s keeps proxies from closing idle conns.
 *  - Cleanup runs in the stream's `cancel` hook (client disconnect) so
 *    there are never leaked subscribers or zombie timers.
 *  - Boots the engine on first connect (idempotent).
 *  - Bootstrap errors return a structured 500 instead of crashing the
 *    stream open — the client's EventSource will then retry with backoff.
 */
export async function GET(): Promise<Response> {
  try {
    await seedIfEmpty();
    startEngine();
  } catch (err) {
    logger.error("api.events.bootstrap.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to bootstrap event stream" },
      { status: 500 }
    );
  }

  const headers = new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Shared closure so `start` and `cancel` can both reach cleanup.
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      safeEnqueue(`: connected\n\n`);

      const unsub = bus.subscribe((event: MissionEvent) => {
        safeEnqueue(`data: ${JSON.stringify(event)}\n\n`);
      });

      const keepalive = setInterval(() => {
        safeEnqueue(`: keepalive ${Date.now()}\n\n`);
      }, 15_000);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
    },
    cancel() {
      // Client disconnected — tear down subscriber + timer.
      cleanup?.();
      cleanup = null;
    },
  });

  return new Response(stream, { headers });
}
