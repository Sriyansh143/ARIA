"use client";

import { create } from "zustand";
import type {
  Agent,
  AgentLog,
  AgentMessage,
  Approval,
  CronJob,
  Deal,
  LlmCall,
  MemoryItem,
  MetricPoint,
  MissionEvent,
  RevenueEvent,
  Skill,
  SystemAlert,
  Task,
} from "@/lib/types";

/**
 * MissionStore — the single client-side source of truth.
 *
 * "ponytail" pattern: a pure reducer over `MissionEvent` discriminated
 * unions. The SSE hook is the ONLY writer; UI components are read-only
 * selectors. This guarantees:
 *  - No race conditions: events are applied synchronously in arrival order.
 *  - Bounded memory: every growing collection is capped (logs, metrics,
 *    llmCalls, alerts) so a long-running session never leaks.
 *  - Self-healing: snapshot hydration replaces state atomically; a bad
 *    event never partially corrupts the store.
 */

const LOG_CAP = 200;
const METRIC_CAP = 240;
const LLM_CAP = 80;
const ALERT_CAP = 60;
const REVENUE_CAP = 120;
const DEAL_CAP = 60;
const MESSAGE_CAP = 100;

export interface Heartbeat {
  ts: string;
  uptime: number;
  connectedAgents: number;
  activeTasks: number;
}

export interface MissionState {
  // Snapshot collections
  agents: Record<string, Agent>;
  tasks: Record<string, Task>;
  approvals: Record<string, Approval>;
  cronJobs: Record<string, CronJob>;
  skills: Skill[];
  alerts: SystemAlert[];
  logs: AgentLog[];
  metrics: MetricPoint[];
  llmCalls: LlmCall[];
  revenueEvents: RevenueEvent[];
  deals: Record<string, Deal>;
  agentMessages: AgentMessage[];
  memories: Record<string, MemoryItem>;

  // Derived/live
  heartbeat: Heartbeat | null;
  hydratedAt: string | null;

  // Connection telemetry (set by the SSE hook host)
  connection: "connecting" | "open" | "reconnecting" | "error";
  reconnects: number;

  // ─── Actions ──────────────────────────────────────────────────────
  hydrate: (snapshot: {
    agents: Agent[];
    tasks: Task[];
    approvals: Approval[];
    cronJobs: CronJob[];
    skills: Skill[];
    alerts: SystemAlert[];
    logs: AgentLog[];
    llmCalls: LlmCall[];
    revenueEvents: RevenueEvent[];
    deals: Deal[];
    agentMessages: AgentMessage[];
    memories: MemoryItem[];
    uptime: number;
  }) => void;
  ingest: (event: MissionEvent) => void;
  setConnection: (c: MissionState["connection"], reconnects?: number) => void;

  // NOTE: Selector methods were removed — see implementation below for rationale.
  // Components should use useMemo to derive lists from the underlying Records.
}

function upsert<T extends { id: string }>(map: Record<string, T>, item: T): Record<string, T> {
  return { ...map, [item.id]: item };
}

function prependCapped<T>(arr: T[], item: T, cap: number): T[] {
  return [item, ...arr].slice(0, cap);
}

export const useMissionStore = create<MissionState>((set, get) => ({
  agents: {},
  tasks: {},
  approvals: {},
  cronJobs: {},
  skills: [],
  alerts: [],
  logs: [],
  metrics: [],
  llmCalls: [],
  revenueEvents: [],
  deals: {},
  memories: {},
  agentMessages: [],
  heartbeat: null,
  hydratedAt: null,
  connection: "connecting",
  reconnects: 0,

  hydrate: (snapshot) =>
    set({
      agents: Object.fromEntries(snapshot.agents.map((a) => [a.id, a])),
      tasks: Object.fromEntries(snapshot.tasks.map((t) => [t.id, t])),
      approvals: Object.fromEntries(snapshot.approvals.map((a) => [a.id, a])),
      cronJobs: Object.fromEntries(snapshot.cronJobs.map((c) => [c.id, c])),
      skills: snapshot.skills,
      alerts: snapshot.alerts,
      logs: snapshot.logs,
      llmCalls: snapshot.llmCalls,
      revenueEvents: snapshot.revenueEvents ?? [],
      deals: Object.fromEntries((snapshot.deals ?? []).map((d) => [d.id, d])),
      agentMessages: snapshot.agentMessages ?? [],
      memories: Object.fromEntries((snapshot.memories ?? []).map((m) => [m.id, m])),
      metrics: [],
      heartbeat: snapshot.uptime
        ? {
            ts: new Date().toISOString(),
            uptime: snapshot.uptime,
            connectedAgents: snapshot.agents.filter((a) => a.status !== "offline").length,
            activeTasks: snapshot.tasks.filter((t) => t.status === "running").length,
          }
        : null,
      hydratedAt: new Date().toISOString(),
    }),

  ingest: (event) => {
    switch (event.type) {
      case "agent.status": {
        set((s) => ({ agents: upsert(s.agents, event.agent) }));
        break;
      }
      case "task.update": {
        set((s) => ({ tasks: upsert(s.tasks, event.task) }));
        break;
      }
      case "log": {
        set((s) => ({ logs: prependCapped(s.logs, event.log, LOG_CAP) }));
        break;
      }
      case "metric": {
        set((s) => ({ metrics: prependCapped(s.metrics, event.metric, METRIC_CAP) }));
        break;
      }
      case "approval": {
        set((s) => ({ approvals: upsert(s.approvals, event.approval) }));
        break;
      }
      case "llm": {
        set((s) => ({ llmCalls: prependCapped(s.llmCalls, event.call, LLM_CAP) }));
        break;
      }
      case "alert": {
        set((s) => {
          const idx = s.alerts.findIndex((a) => a.id === event.alert.id);
          if (idx === -1) {
            return { alerts: prependCapped(s.alerts, event.alert, ALERT_CAP) };
          }
          const next = s.alerts.slice();
          next[idx] = event.alert;
          return { alerts: next };
        });
        break;
      }
      case "cron.update": {
        set((s) => ({ cronJobs: upsert(s.cronJobs, event.job) }));
        break;
      }
      case "revenue": {
        set((s) => ({ revenueEvents: prependCapped(s.revenueEvents, event.event, REVENUE_CAP) }));
        break;
      }
      case "deal.update": {
        set((s) => {
          const deals = upsert(s.deals, event.deal);
          // Enforce cap by dropping oldest if over limit.
          const ids = Object.keys(deals);
          if (ids.length > DEAL_CAP) {
            const sorted = ids
              .map((id) => deals[id])
              .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
            const kept = sorted.slice(0, DEAL_CAP);
            return { deals: Object.fromEntries(kept.map((d) => [d.id, d])) };
          }
          return { deals };
        });
        break;
      }
      case "agent.message": {
        set((s) => ({ agentMessages: prependCapped(s.agentMessages, event.message, MESSAGE_CAP) }));
        break;
      }
      case "memory.update": {
        set((s) => ({ memories: upsert(s.memories, event.memory) }));
        break;
      }
      case "system": {
        // System messages are surfaced as transient toasts by the host;
        // no store mutation needed.
        break;
      }
      case "heartbeat": {
        set({ heartbeat: { ts: event.ts, uptime: event.uptime, connectedAgents: event.connectedAgents, activeTasks: event.activeTasks } });
        break;
      }
      default: {
        // Exhaustiveness guard — a new event type must be handled here.
        const _exhaustive: never = event;
        void _exhaustive;
      }
    }
  },

  setConnection: (c, reconnects) =>
    set((s) => ({ connection: c, reconnects: reconnects ?? s.reconnects })),

  // NOTE: Selector methods (agentList, taskList, pendingApprovals, unackedAlerts)
  // were REMOVED because they returned new array references on every call,
  // causing infinite re-renders in components that used them.
  //
  // Components should select the underlying Record/Array directly and
  // derive lists inside useMemo:
  //   const agents = useMissionStore((s) => s.agents);
  //   const agentList = useMemo(() => Object.values(agents).sort(...), [agents]);
}));
