// =====================================================================
// agent-activity-stream.ts — In-process activity stream for agent events.
// =====================================================================
// Broadcasts agent activity events to in-process subscribers via the
// existing event-bus. Any module (or future mini-service relay) can
// subscribe via `onActivity(handler)` to receive a real-time stream of
// { agentId, event, data, ts } payloads.
//
// Replaces the original socket.io-client broadcaster. The original
// connected to an external mini-service via socket.io-client; this
// version uses the in-process event-bus so it works with zero external
// dependencies. A future mini-service can subscribe via `onActivity`
// and forward events to connected dashboards if needed.
//
// Graceful degradation: never throws — agent execution is unaffected
// by subscriber state.
// =====================================================================

import { emitEvent, onEvent } from '@/lib/event-bus'

export interface ActivityPayload {
  agentId: string
  event: string
  data?: unknown
  ts: number
}

const ACTIVITY_EVENT = 'agent:activity'
const ACTIVITY_UPDATE = 'agent:update'

/**
 * Broadcast an agent activity event to all in-process subscribers.
 * Non-blocking, never throws — agent logic is unaffected.
 *
 * @param agentId  The agent the event pertains to.
 * @param event    Free-form event name (e.g. "task_started", "tool_call",
 *                 "thinking", "completed", "error").
 * @param data     Optional event payload (must be JSON-serializable).
 */
export function broadcastActivity(
  agentId: string,
  event: string,
  data?: unknown,
): void {
  try {
    const payload: ActivityPayload = {
      agentId,
      event,
      data,
      ts: Date.now(),
    }
    // Channel 1: dedicated activity event for granular UI consumers.
    emitEvent(ACTIVITY_EVENT, payload)
    // Channel 2: piggyback on the `agent:update` channel so dashboards
    // that listen for state updates pick up the activity too.
    emitEvent(ACTIVITY_UPDATE, { id: agentId, activity: payload })
  } catch (err) {
    console.warn(
      '[agent-activity-stream] broadcast failed:',
      err instanceof Error ? err.message : String(err),
    )
  }
}

/**
 * Subscribe to the activity stream. Returns an unsubscribe function.
 * The handler receives every `ActivityPayload` broadcast in this process.
 */
export function onActivity(handler: (payload: ActivityPayload) => void): () => void {
  return onEvent(ACTIVITY_EVENT, (payload?: unknown) => {
    if (payload && typeof payload === 'object' && 'agentId' in payload) {
      handler(payload as ActivityPayload)
    }
  })
}

/**
 * Subscribe to the broader `agent:update` channel (state + activity).
 * Returns an unsubscribe function.
 */
export function onAgentUpdate(
  handler: (update: { id: string; activity?: ActivityPayload; [k: string]: unknown }) => void,
): () => void {
  return onEvent(ACTIVITY_UPDATE, (payload?: unknown) => {
    if (payload && typeof payload === 'object' && 'id' in payload) {
      handler(payload as { id: string; activity?: ActivityPayload; [k: string]: unknown })
    }
  })
}

/**
 * Connection status for diagnostics / health endpoints. The in-process
 * bus is always "connected" as long as the Node process is running.
 */
export function getActivityStreamStatus(): {
  connected: boolean
  url: string
} {
  return {
    connected: true,
    url: 'in-process://event-bus',
  }
}
