/**
 * JARVIS Mission Control — Real-time WebSocket client hooks.
 * ----------------------------------------------------------
 * Task ID: 2 (PARALLEL-A) | Agent: parallel-A WebSocket
 *
 * Lightweight React hooks that subscribe to the realtime mini-service
 * (mini-services/realtime-service, port 3003) over Socket.io. The gateway
 * (Caddyfile) routes `?XTransformPort=3003` to port 3003, so the client
 * connects with `io("/?XTransformPort=3003")` — NEVER a direct port URL.
 *
 * Each hook returns `null` while disconnected, so callers can fall back to
 * their existing HTTP polling (TanStack Query) without flicker.
 *
 *   - useRealtimeFleet()         → FleetUpdate | null
 *   - useRealtimeMetrics()       → MetricsUpdate | null
 *   - useRealtimeNotifications() → NotificationsUpdate | null
 *   - useRealtimeActivity()      → ActivityUpdate | null
 *   - useRealtimeConnected()     → boolean (true when socket is live)
 *   - requestRealtimeSnapshot()  → manually request a fresh state:snapshot
 *
 * A single shared Socket.io client is used across all hooks (singleton),
 * so there's exactly one WebSocket per browser tab regardless of how many
 * components subscribe.
 */

'use client';

import { useEffect, useState, useCallback, useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';

// ─────────────────────────────────────────────────────────────────────────────
// Payload types — mirror the server's `index.ts` shapes (JSON-safe).
// ─────────────────────────────────────────────────────────────────────────────

export interface FleetUpdate {
  total: number;
  active: number;
  byStatus: Record<string, number>;
  avgLoad: number;
  agents: Array<{ codename: string; status: string; load: number; role: string; successRate: number }>;
  ts: string;
}

export interface MetricsUpdate {
  current: {
    cpu: number;
    mem: number;
    disk: number;
    net: number;
    latency: number;
    tokens: number;
  };
  series: Array<{ time: string; cpu: number; mem: number; disk: number; latency: number; tokens: number }>;
  ts: string;
}

export interface NotificationsUpdate {
  unread: number;
  total: number;
  latest: Array<{ id: string; type: string; title: string; message: string; createdAt: string; read: boolean }>;
  ts: string;
}

export interface ActivityEvent {
  id: string;
  type: string;
  level: string;
  agent?: string;
  title: string;
  detail?: string;
  ts: number;
}

export interface ActivityUpdate {
  events: ActivityEvent[];
  ts: string;
}

export interface StateSnapshot {
  fleet: FleetUpdate | null;
  metrics: MetricsUpdate | null;
  notifications: NotificationsUpdate | null;
  activity: ActivityUpdate | null;
  ts: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared singleton socket — one connection per browser tab.
// ─────────────────────────────────────────────────────────────────────────────

// NEVER use a direct port URL — the Caddy gateway routes via XTransformPort.
const REALTIME_URL = '/?XTransformPort=3003';

let socketRef: Socket | null = null;
let refCount = 0;

type ConnectionListener = (connected: boolean) => void;
const connectionListeners = new Set<ConnectionListener>();

function getSocket(): Socket {
  if (socketRef && socketRef.connected) return socketRef;
  if (!socketRef) {
    const sock = io(REALTIME_URL, {
      transports: ['websocket', 'polling'],
      forceNew: false,
      reconnection: true,
      reconnectionAttempts: Infinity, // keep trying — components fall back to polling meanwhile
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 8000,
    });

    sock.on('connect', () => {
      console.debug('[realtime] socket connected:', sock.id);
      connectionListeners.forEach((fn) => fn(true));
    });
    sock.on('disconnect', (reason) => {
      console.debug('[realtime] socket disconnected:', reason);
      connectionListeners.forEach((fn) => fn(false));
    });
    sock.on('connect_error', (err) => {
      // Don't log loudly — this fires on every reconnect attempt and the
      // caller is expected to fall back to HTTP polling when null is returned.
      console.debug('[realtime] connect_error:', err.message);
    });

    socketRef = sock;
  }
  return socketRef;
}

function retainSocket(): Socket {
  const sock = getSocket();
  refCount += 1;
  if (!sock.connected) sock.connect();
  return sock;
}

function releaseSocket() {
  refCount = Math.max(0, refCount - 1);
  // Keep the socket alive even when refCount hits 0 — reconnects are cheap,
  // but tearing down on every unmount causes flicker. The browser will close
  // the WebSocket when the tab unloads.
}

/**
 * Manually request a fresh `state:snapshot` from the server. Useful when a
 * component wants to hydrate immediately on mount without waiting up to 5s
 * for the next broadcast tick.
 */
export function requestRealtimeSnapshot() {
  const sock = socketRef;
  if (sock && sock.connected) sock.emit('request:snapshot');
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Subscribes to a single socket event with proper cleanup.
 * Returns the latest payload or `null` while disconnected / before first msg.
 */
function useRealtimeEvent<T>(eventName: string, initialValue: T | null = null): T | null {
  const [data, setData] = useState<T | null>(initialValue);
  const stableEventName = eventName; // events are static strings

  useEffect(() => {
    const sock = retainSocket();

    const handler = (payload: T) => {
      if (payload) setData(payload);
    };

    sock.on(stableEventName, handler as Parameters<Socket['on']>[1]);

    return () => {
      sock.off(stableEventName, handler as Parameters<Socket['off']>[1]);
      releaseSocket();
    };
    // stableEventName is a constant — safe to ignore in deps.
  }, [stableEventName]);

  return data;
}

/**
 * Live fleet stats — agent count, status distribution, avg load.
 * Updates every 5s via socket. Returns null until first message arrives
 * (caller should fall back to the dashboard HTTP endpoint meanwhile).
 */
export function useRealtimeFleet(): FleetUpdate | null {
  return useRealtimeEvent<FleetUpdate>('fleet:update');
}

/**
 * Live system metrics — CPU / memory / latency / tokens + recent series.
 * Updates every 5s via socket. Returns null until first message arrives.
 */
export function useRealtimeMetrics(): MetricsUpdate | null {
  return useRealtimeEvent<MetricsUpdate>('metrics:update');
}

/**
 * Live unread notification count.
 * Updates every 5s via socket. Returns null until first message arrives.
 */
export function useRealtimeNotifications(): NotificationsUpdate | null {
  return useRealtimeEvent<NotificationsUpdate>('notifications:new');
}

/**
 * Latest 5 activity events (logs / tasks / payments / memory / notifications).
 * Updates every 5s via socket. Returns null until first message arrives.
 */
export function useRealtimeActivity(): ActivityUpdate | null {
  return useRealtimeEvent<ActivityUpdate>('activity:new');
}

/**
 * True when the socket is connected and receiving realtime updates.
 * Components can use this to switch their UI between "live" and "polling"
 * indicators without polling themselves.
 *
 * Implemented with `useSyncExternalStore` — the React-blessed way to subscribe
 * to an external (non-React) source. Avoids the "setState in effect" lint rule
 * entirely and gives us tear-free reads during concurrent rendering.
 */
export function useRealtimeConnected(): boolean {
  return useSyncExternalStore(
    (onChange: () => void) => {
      const listener: ConnectionListener = (c) => {
        // Map to a no-arg callback for useSyncExternalStore's API.
        void c;
        onChange();
      };
      connectionListeners.add(listener);
      // Touch the socket to ensure it's trying to connect.
      retainSocket();
      return () => {
        connectionListeners.delete(listener);
        releaseSocket();
      };
    },
    // Client snapshot — read live from the singleton socket.
    () => Boolean(socketRef && socketRef.connected),
    // Server snapshot — assume disconnected during SSR.
    () => false,
  );
}

/**
 * Hydrates from the initial `state:snapshot` burst on connect, then keeps
 * all four channels in sync. Useful for components that want everything at
 * once (e.g. the Overview tab). Returns null until the snapshot arrives.
 */
export function useRealtimeSnapshot(): StateSnapshot | null {
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);

  useEffect(() => {
    const sock = retainSocket();

    const onSnapshot = (payload: StateSnapshot) => {
      if (payload) setSnapshot(payload);
    };
    const onFleet = (f: FleetUpdate) => setSnapshot((prev) => (prev ? { ...prev, fleet: f } : prev));
    const onMetrics = (m: MetricsUpdate) => setSnapshot((prev) => (prev ? { ...prev, metrics: m } : prev));
    const onNotifs = (n: NotificationsUpdate) => setSnapshot((prev) => (prev ? { ...prev, notifications: n } : prev));
    const onActivity = (a: ActivityUpdate) => setSnapshot((prev) => (prev ? { ...prev, activity: a } : prev));

    sock.on('state:snapshot', onSnapshot);
    sock.on('fleet:update', onFleet);
    sock.on('metrics:update', onMetrics);
    sock.on('notifications:new', onNotifs);
    sock.on('activity:new', onActivity);

    return () => {
      sock.off('state:snapshot', onSnapshot);
      sock.off('fleet:update', onFleet);
      sock.off('metrics:update', onMetrics);
      sock.off('notifications:new', onNotifs);
      sock.off('activity:new', onActivity);
      releaseSocket();
    };
  }, []);

  return snapshot;
}

// Re-export the snapshot request helper as a hook for parity.
export function useRequestRealtimeSnapshot() {
  return useCallback(() => requestRealtimeSnapshot(), []);
}
