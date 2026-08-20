/**
 * GET /api/swarm/stream — Phase 32
 *
 * Server-Sent Events (SSE) endpoint that pushes new swarm messages to the
 * Swarm Topology Visualizer in real-time. Whenever an agent sends a
 * message via the swarm bus, this endpoint emits a `message` event to
 * all connected clients.
 *
 * EVENT SHAPE
 * -----------
 *   data: {"type":"message","message":{"id":"...","from":"marketer","to":"coder","subject":"..."}}\n\n
 *   data: {"type":"heartbeat","ts":"2026-..."}\n\n
 *
 * HOW IT WORKS
 * ------------
 *   1. Client opens EventSource('/api/swarm/stream')
 *   2. Server subscribes to the event-bus's `system` events (which the
 *      swarm bus emits on every sendAgentMessage call — see agent-bus.ts)
 *   3. When a system event with message "📨 X → Y: subject" is received,
 *      we parse it + emit a `message` SSE event with the full message payload
 *   4. Heartbeat every 15s keeps the connection alive
 *
 * WHY SSE (not WebSocket)
 * -----------------------
 * The visualizer only needs to RECEIVE updates (one-way). SSE is simpler
 * than WebSocket + works through proxies + auto-reconnects in the browser.
 */
import { NextRequest } from "next/server";
import { bus } from "@/lib/event-bus";
import type { MissionEvent } from "@/lib/types";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send an initial connection-acknowledged event.
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "connected", ts: new Date().toISOString() })}\n\n`),
      );

      // Subscribe to system events from the event bus.
      const unsubscribe = bus.subscribe((event: MissionEvent) => {
        if (event.type !== "system") return;
        if (typeof event.message !== "string") return;

        // The swarm bus emits system events like:
        //   "📨 marketer-agent → coder-agent: Need landing page copy"
        // We parse this + emit a `message` SSE event.
        const swarmMatch = event.message.match(/^📨 (\S+) → (\S+): (.+)$/);
        if (swarmMatch) {
          const payload = {
            type: "message",
            message: {
              from: swarmMatch[1],
              to: swarmMatch[2],
              subject: swarmMatch[3],
              ts: event.ts,
            },
          };
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          } catch {
            // Controller may be closed — unsubscribe.
            unsubscribe();
          }
        }
      });

      // Heartbeat every 15s to keep the connection alive through proxies.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "heartbeat", ts: new Date().toISOString() })}\n\n`),
          );
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 15_000);

      // Cleanup on abort (client disconnects).
      const abortHandler = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      };
      _req.signal.addEventListener("abort", abortHandler);

      logger.info("api.swarm.stream.client-connected", {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
