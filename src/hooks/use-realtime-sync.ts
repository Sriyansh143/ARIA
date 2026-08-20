"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

/**
 * useRealtimeSync — connects to the ARIA realtime sidecar (socket.io on
 * port 3003) via the Caddy gateway.
 *
 * Connection strategy (per project gateway rules):
 *   - Connect to the same origin (the Next.js app at "/").
 *   - Pass `XTransformPort=3003` as a query param so Caddy routes the
 *     request to the realtime sidecar instead of the Next.js app.
 *   - Use websocket transport first, fall back to polling.
 *
 * The hook subscribes to `aria:event` messages and exposes:
 *   - `connected: boolean` — live connection state
 *   - `lastEvent: unknown | null` — the most recent event payload
 *
 * On each `aria:event`, the payload is also dispatched as a
 * `window.CustomEvent("aria:realtime-event", { detail })` so any other
 * module (e.g., the existing SSE-based store hydration) can opt-in to
 * realtime events without coupling to this hook.
 *
 * Failure mode: if the sidecar is down or socket.io fails to connect,
 * the hook silently degrades. The app already works with SSE — this
 * hook is purely additive infrastructure for future real-time features
 * (cross-tab state sync, instant alert fan-out, etc.).
 *
 * Task ID: FEATURES-LEARN-NOTIFY-RT (Task 3).
 */
export interface RealtimeSyncState {
  connected: boolean;
  lastEvent: unknown | null;
}

export function useRealtimeSync(): RealtimeSyncState {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<unknown | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // SSR guard — socket.io must run in the browser only.
    if (typeof window === "undefined") return;

    let disposed = false;
    let socket: Socket | null = null;

    try {
      socket = io({
        transports: ["websocket", "polling"],
        query: { XTransformPort: "3003" },
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        timeout: 10_000,
      });
      socketRef.current = socket;
    } catch (err) {
      // Socket.io constructor rarely throws, but be defensive.
      console.warn("[useRealtimeSync] socket.io init failed:", err);
      return;
    }

    const onConnect = () => {
      if (disposed) return;
      setConnected(true);
      // Join the global channel so we receive every fan-out event.
      try {
        socket?.emit("subscribe", { channels: ["global"] });
      } catch {
        /* ignore — emit may fail if socket is closing */
      }
    };

    const onDisconnect = () => {
      if (disposed) return;
      setConnected(false);
    };

    const onConnectError = (err: unknown) => {
      if (disposed) return;
      setConnected(false);
      // Silently degrade — the SSE stream is the source of truth.
      // Log at debug to avoid console spam during sidecar downtime.
      if (typeof console !== "undefined" && console.debug) {
        console.debug("[useRealtimeSync] connect error:", err);
      }
    };

    const onAriaEvent = (payload: unknown) => {
      if (disposed) return;
      setLastEvent(payload);
      // Re-broadcast on window so any other module can listen.
      try {
        window.dispatchEvent(
          new CustomEvent("aria:realtime-event", { detail: payload }),
        );
      } catch {
        /* CustomEvent construction can fail in rare environments */
      }
    };

    const onHello = (payload: unknown) => {
      if (disposed) return;
      // The sidecar greets new clients with service metadata. Use it as
      // a connection confirmation signal (in case `connect` fires before
      // the subscription completes).
      if (typeof console !== "undefined" && console.debug) {
        console.debug("[useRealtimeSync] hello from sidecar:", payload);
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("aria:event", onAriaEvent);
    socket.on("hello", onHello);

    return () => {
      disposed = true;
      try {
        socket?.off("connect", onConnect);
        socket?.off("disconnect", onDisconnect);
        socket?.off("connect_error", onConnectError);
        socket?.off("aria:event", onAriaEvent);
        socket?.off("hello", onHello);
        socket?.disconnect();
      } catch {
        /* ignore — socket may already be closed */
      }
      socketRef.current = null;
    };
  }, []);

  return { connected, lastEvent };
}

export default useRealtimeSync;
