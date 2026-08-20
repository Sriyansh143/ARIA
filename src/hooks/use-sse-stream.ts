/**
 * src/hooks/use-sse-stream.ts — v77 Phase 27
 *
 * SSE (Server-Sent Events) hook with deduplication to prevent infinite
 * re-render loops. Only triggers a state update when the data actually
 * changes (deep JSON comparison).
 *
 * Usage:
 *   const lastEvent = useSSEStream("/api/events/stream", (data) => {
 *     console.log("New event:", data);
 *   });
 */

"use client";

import { useState, useEffect, useRef } from "react";

export function useSSEStream(url: string, onEvent?: (event: any) => void) {
  const [lastEvent, setLastEvent] = useState<any>(null);
  const lastEventRef = useRef<any>(null);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // v77 Fix: Only update if data actually changed (prevent infinite loop).
        const newJson = JSON.stringify(data);
        if (JSON.stringify(lastEventRef.current) !== newJson) {
          lastEventRef.current = data;
          setLastEvent(data);
          onEventRef.current?.(data);
        }
      } catch (error) {
        console.error("[sse] Parse error:", error);
      }
    };

    eventSource.onerror = () => {
      console.warn("[sse] Connection error — will auto-reconnect");
      // The browser auto-reconnects EventSource after a brief delay.
      // We just close it to prevent duplicate connections on unmount.
      setTimeout(() => eventSource.close(), 5000);
    };

    return () => {
      eventSource.close();
    };
  }, [url]);

  return lastEvent;
}
