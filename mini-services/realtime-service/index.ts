/**
 * JARVIS Mission Control — Real-time WebSocket Mini-Service
 * --------------------------------------------------------
 * Task ID: 2 (PARALLEL-A) | Agent: parallel-A WebSocket
 *
 * Socket.io server on port 3003 that queries the JARVIS Prisma database
 * every 5 seconds and pushes real-time updates to connected clients:
 *
 *   - `state:snapshot`     — initial burst on connect, full current state.
 *   - `fleet:update`       — agent count, status distribution, avg load.
 *   - `metrics:update`     — current CPU / mem / latency / tokens + recent series.
 *   - `notifications:new`  — unread notification count.
 *   - `activity:new`       — latest 5 unified activity events.
 *
 * Frontend connects with `io("/?XTransformPort=3003")` — the Caddy gateway
 * reads `XTransformPort` from the query string and reverse-proxies to this port.
 *
 * This process uses its own `PrismaClient` instance (NOT the Next.js app's
 * `db.ts` singleton) because it runs as an independent bun project.
 */

import { createServer } from 'http';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';

// Hardcoded port (per task rules — NEVER use env for the port).
const PORT = 3003;

// Own PrismaClient instance (separate process from the Next.js app).
const prisma = new PrismaClient({ log: ['warn', 'error'] });

// ─────────────────────────────────────────────────────────────────────────────
// Type definitions for outbound payloads (kept loose + JSON-safe).
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
// Data loaders — each reads from the database using Prisma.
// All loaders are wrapped in try/catch so a single failing query doesn't
// crash the whole broadcast loop; on failure they return null.
// ─────────────────────────────────────────────────────────────────────────────

async function loadFleet(): Promise<FleetUpdate | null> {
  try {
    const agents = await prisma.agent.findMany({
      select: { codename: true, status: true, load: true, role: true, successRate: true },
      orderBy: { codename: 'asc' },
    });
    const total = agents.length;
    const byStatus: Record<string, number> = {};
    let loadSum = 0;
    for (const a of agents) {
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
      loadSum += a.load ?? 0;
    }
    const active = (byStatus['working'] ?? 0) + (byStatus['thinking'] ?? 0);
    const avgLoad = total > 0 ? Math.round((loadSum / total) * 10) / 10 : 0;
    return {
      total,
      active,
      byStatus,
      avgLoad,
      agents: agents.map((a) => ({
        codename: a.codename,
        status: a.status,
        load: a.load,
        role: a.role,
        successRate: a.successRate,
      })),
      ts: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[realtime] loadFleet failed:', err);
    return null;
  }
}

async function loadMetrics(): Promise<MetricsUpdate | null> {
  try {
    const recent = await prisma.telemetry.findMany({ orderBy: { createdAt: 'desc' }, take: 30 });
    const series = recent.reverse().map((t) => ({
      time: t.createdAt.toISOString(),
      cpu: Math.round(t.cpu * 10) / 10,
      mem: Math.round(t.mem * 10) / 10,
      disk: Math.round(t.disk * 10) / 10,
      latency: t.latency,
      tokens: t.tokens,
    }));
    const current = series[series.length - 1];
    // Provider tokens as a fallback if telemetry is empty.
    let providerTokens = 0;
    let providerLatency = 0;
    try {
      const provider = await prisma.provider.findUnique({ where: { key: 'zai' } });
      providerTokens = provider?.tokens ?? 0;
      providerLatency = provider?.latency ?? 0;
    } catch {
      // ignore provider lookup errors
    }
    return {
      current: {
        cpu: current?.cpu ?? 0,
        mem: current?.mem ?? 0,
        disk: current?.disk ?? 0,
        net: current?.net ?? 0,
        latency: current?.latency ?? providerLatency,
        tokens: current?.tokens ?? providerTokens,
      },
      series,
      ts: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[realtime] loadMetrics failed:', err);
    return null;
  }
}

async function loadNotifications(): Promise<NotificationsUpdate | null> {
  try {
    const [unread, total, latest] = await Promise.all([
      prisma.notification.count({ where: { read: false } }),
      prisma.notification.count(),
      prisma.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
    ]);
    return {
      unread,
      total,
      latest: latest.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        createdAt: n.createdAt.toISOString(),
        read: n.read,
      })),
      ts: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[realtime] loadNotifications failed:', err);
    return null;
  }
}

async function loadActivity(): Promise<ActivityUpdate | null> {
  try {
    const [logs, tasks, payments, memory, notifications] = await Promise.all([
      prisma.agentLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { agent: { select: { codename: true } } },
      }),
      prisma.task.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { assignee: { select: { codename: true } } },
      }),
      prisma.payment.findMany({ orderBy: { createdAt: 'desc' }, take: 3 }),
      prisma.memoryItem.findMany({ orderBy: { updatedAt: 'desc' }, take: 3 }),
      prisma.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 3 }),
    ]);

    const events: ActivityEvent[] = [];
    for (const l of logs) {
      events.push({
        id: `log-${l.id}`,
        type: 'log',
        level: l.level,
        agent: l.agent?.codename,
        title: l.message,
        ts: l.createdAt.getTime(),
      });
    }
    for (const t of tasks) {
      events.push({
        id: `task-${t.id}`,
        type: 'task',
        level: t.status === 'completed' ? 'success' : t.status === 'failed' ? 'error' : 'info',
        agent: t.assignee?.codename,
        title: `Task ${t.status}: ${t.title}`,
        detail: t.priority,
        ts: t.createdAt.getTime(),
      });
    }
    for (const p of payments) {
      events.push({
        id: `pay-${p.id}`,
        type: 'payment',
        level: p.status === 'confirmed' ? 'success' : p.status === 'failed' ? 'error' : 'warn',
        title: `Payment ${p.status}: ₹${p.amount} (${p.method})`,
        detail: p.payer ?? '',
        ts: p.createdAt.getTime(),
      });
    }
    for (const m of memory) {
      events.push({
        id: `mem-${m.id}`,
        type: 'memory',
        level: 'info',
        title: `Memory updated: ${m.key}`,
        detail: m.scope,
        ts: m.updatedAt.getTime(),
      });
    }
    for (const n of notifications) {
      events.push({
        id: `notif-${n.id}`,
        type: 'notification',
        level: n.type,
        title: n.title,
        detail: n.message,
        ts: n.createdAt.getTime(),
      });
    }

    events.sort((a, b) => b.ts - a.ts);
    return { events: events.slice(0, 5), ts: new Date().toISOString() };
  } catch (err) {
    console.error('[realtime] loadActivity failed:', err);
    return null;
  }
}

async function loadSnapshot(): Promise<StateSnapshot> {
  const [fleet, metrics, notifications, activity] = await Promise.all([
    loadFleet(),
    loadMetrics(),
    loadNotifications(),
    loadActivity(),
  ]);
  return { fleet, metrics, notifications, activity, ts: new Date().toISOString() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Socket.io server — path `/` (Caddy uses this to route, do NOT change).
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: socket.io is configured with `path: '/'`, which means engine.io
// intercepts ALL GET requests on `/` (the Caddy gateway requires this). As a
// result, a custom HTTP `/health` endpoint would never fire — so we use a bare
// `createServer()` and let socket.io own the request pipeline. Liveness is
// verified via the engine.io handshake: `GET /?EIO=4&transport=polling` should
// return `0{"sid":"..."}`.
const httpServer = createServer();

const io = new Server(httpServer, {
  // DO NOT change the path — Caddy uses it to forward to the correct port.
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const clientCount = () => io.engine.clientsCount;

io.on('connection', async (socket) => {
  console.log(`[realtime] client connected: ${socket.id} (total: ${clientCount()})`);

  // Send an initial snapshot of all current data on connect — the client can
  // hydrate immediately without waiting for the next 5s tick.
  try {
    const snapshot = await loadSnapshot();
    socket.emit('state:snapshot', snapshot);
  } catch (err) {
    console.error('[realtime] snapshot burst failed:', err);
  }

  // Allow clients to request a fresh snapshot on demand (e.g. after refetching
  // a tab to feel snappier than waiting for the next tick).
  socket.on('request:snapshot', async () => {
    try {
      const snapshot = await loadSnapshot();
      socket.emit('state:snapshot', snapshot);
    } catch (err) {
      console.error('[realtime] on-demand snapshot failed:', err);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[realtime] client disconnected: ${socket.id} (${reason}) (total: ${clientCount()})`);
  });

  socket.on('error', (err) => {
    console.error(`[realtime] socket error (${socket.id}):`, err);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Broadcast loop — every 5 seconds, query the DB and push updates to all
// connected clients. Each channel emits independently; clients subscribe to
// only what they need.
// ─────────────────────────────────────────────────────────────────────────────

const TICK_MS = 5000;
let tickCount = 0;

async function broadcastTick() {
  tickCount += 1;
  // Skip the broadcast entirely if no one is listening — saves DB load.
  if (clientCount() === 0) return;

  const [fleet, metrics, notifications, activity] = await Promise.all([
    loadFleet(),
    loadMetrics(),
    loadNotifications(),
    loadActivity(),
  ]);

  if (fleet) io.emit('fleet:update', fleet);
  if (metrics) io.emit('metrics:update', metrics);
  if (notifications) io.emit('notifications:new', notifications);
  if (activity) io.emit('activity:new', activity);

  if (tickCount % 12 === 0) {
    // Log a heartbeat once a minute so the dev log stays informative.
    console.log(
      `[realtime] tick #${tickCount} — clients=${clientCount()} fleet=${fleet?.total ?? '?'} unread=${notifications?.unread ?? '?'}`,
    );
  }
}

const interval = setInterval(broadcastTick, TICK_MS);

// ─────────────────────────────────────────────────────────────────────────────
// Boot + graceful shutdown.
// ─────────────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[realtime] JARVIS realtime service listening on port ${PORT}`);
  console.log(`[realtime] socket.io path: /`);
  console.log(`[realtime] tick interval: ${TICK_MS}ms`);
  console.log(`[realtime] DATABASE_URL=${process.env.DATABASE_URL ?? 'file:/home/z/my-project/db/custom.db (default)'}`);
});

async function shutdown(signal: string) {
  console.log(`[realtime] received ${signal}, shutting down...`);
  clearInterval(interval);
  io.close();
  httpServer.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Defensive: never silently die on an unhandled rejection / exception.
// Log loudly so the dev log shows the cause instead of a silent exit.
process.on('unhandledRejection', (reason) => {
  console.error('[realtime] UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[realtime] UNCAUGHT EXCEPTION:', err);
});
