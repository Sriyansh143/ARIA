/**
 * src/lib/goals.ts — Goal & OKR tracking (server-only).
 *
 * Goals are stored as a JSON array in the `Setting` table under the key
 * `"goals"`. When the setting is absent (fresh install), `getGoals()`
 * derives a default set from the live system snapshot — revenue, deals,
 * agents, alerts, LLM success rate, completed tasks — so the dashboard
 * always shows something meaningful rather than an empty state.
 *
 * Each goal's `status` is auto-derived from `current / target`:
 *   - completed  (>= 1.0)
 *   - on_track   (>= 0.7)
 *   - at_risk    (>= 0.4)
 *   - behind     (>= 0.1, else behind)
 *
 * The dashboard can call `updateGoalProgress` to patch a single goal's
 * `current` value (and recompute its status), or `saveGoals` to replace
 * the entire array (e.g. when the user adds a new goal via the dialog).
 *
 * Task ID: FEATURES-STREAM-GOALS-COST (Task 2).
 */
import "server-only";

import { db } from "./db";
import { logger } from "./logger";

// ─── Types ───────────────────────────────────────────────────────────

export type GoalCategory =
  | "revenue"
  | "growth"
  | "operations"
  | "security"
  | "innovation";

export type GoalStatus = "on_track" | "at_risk" | "behind" | "completed";

export interface Goal {
  id: string;
  title: string;
  description?: string;
  category: GoalCategory;
  target: number;
  current: number;
  unit: string;
  deadline?: string;
  status: GoalStatus;
  owner: string;
}

// ─── Constants ──────────────────────────────────────────────────────

const SETTING_KEY = "goals";
const SETTING_CATEGORY = "okr";

// ─── Status auto-calculation ────────────────────────────────────────

/**
 * Compute a goal's status from its progress ratio (current / target).
 * Special-case `target === 0` (e.g. "zero critical alerts") — a current
 * value of 0 means "completed", anything above 0 means "behind".
 */
export function deriveStatus(current: number, target: number): GoalStatus {
  if (target <= 0) {
    // Target-zero goals: success means current is also 0.
    if (current <= 0) return "completed";
    if (current <= 1) return "on_track";
    if (current <= 3) return "at_risk";
    return "behind";
  }
  const ratio = current / target;
  if (ratio >= 1.0) return "completed";
  if (ratio >= 0.7) return "on_track";
  if (ratio >= 0.4) return "at_risk";
  if (ratio >= 0.1) return "behind";
  return "behind";
}

// ─── Default goal derivation from live system state ────────────────

interface SystemState {
  revenueTotal: number;
  dealsCount: number;
  activeAgents: number;
  criticalAlerts: number;
  llmTotal: number;
  llmOk: number;
  completedTasks: number;
}

/**
 * Build the default goal list from a snapshot of the live system. Each
 * goal's `current` value is derived from real DB rows; `status` is then
 * auto-calculated via `deriveStatus`.
 */
function buildDefaultGoals(s: SystemState): Goal[] {
  const llmRate =
    s.llmTotal > 0 ? Math.round((s.llmOk / s.llmTotal) * 100) : 0;
  return [
    {
      id: "g-mrr-100k",
      title: "Reach $100K MRR",
      description: "Monthly recurring revenue from autonomous operations",
      category: "revenue",
      target: 100_000,
      current: s.revenueTotal,
      unit: "$",
      status: deriveStatus(s.revenueTotal, 100_000),
      owner: "CFO",
    },
    {
      id: "g-deals-50",
      title: "Close 50 deals",
      description: "Total deals won across the pipeline",
      category: "growth",
      target: 50,
      current: s.dealsCount,
      unit: "deals",
      status: deriveStatus(s.dealsCount, 50),
      owner: "AccountExecutive",
    },
    {
      id: "g-agents-37",
      title: "37 agents operational",
      description: "Active agents across all departments",
      category: "operations",
      target: 37,
      current: s.activeAgents,
      unit: "agents",
      status: deriveStatus(s.activeAgents, 37),
      owner: "Ops",
    },
    {
      id: "g-zero-critical",
      title: "Zero critical alerts",
      description: "No unacked critical system alerts",
      category: "security",
      target: 0,
      current: s.criticalAlerts,
      unit: "alerts",
      status: deriveStatus(s.criticalAlerts, 0),
      owner: "Compliance",
    },
    {
      id: "g-llm-95",
      title: "95% LLM success rate",
      description: "Share of LLM calls completing without error/fallback",
      category: "operations",
      target: 95,
      current: llmRate,
      unit: "%",
      status: deriveStatus(llmRate, 95),
      owner: "CTO",
    },
    {
      id: "g-tasks-100",
      title: "100 tasks completed",
      description: "Total tasks in completed status",
      category: "growth",
      target: 100,
      current: s.completedTasks,
      unit: "tasks",
      status: deriveStatus(s.completedTasks, 100),
      owner: "ProjectManager",
    },
  ];
}

/**
 * Read the live system state from the DB. Used only when no goals are
 * persisted in the Setting table — gives the dashboard meaningful
 * numbers on first run.
 */
async function readSystemState(): Promise<SystemState> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [revenueEvents, deals, agents, alerts, llmCalls, tasks] =
    await Promise.all([
      db.revenueEvent.findMany({ where: { createdAt: { gte: monthStart } } }),
      db.deal.findMany({ where: { stage: "won" } }),
      db.agent.findMany(),
      db.systemAlert.findMany({ where: { ack: false, severity: "critical" } }),
      db.llmCall.findMany({ take: 2000, orderBy: { createdAt: "desc" } }),
      db.task.findMany({ where: { status: "completed" } }),
    ]);

  const revenueTotal = revenueEvents.reduce((s, r) => s + r.amount, 0);
  const activeAgents = agents.filter(
    (a) => a.status !== "offline" && a.status !== "idle",
  ).length;
  const llmOk = llmCalls.filter((c) => c.status === "ok").length;

  return {
    revenueTotal,
    dealsCount: deals.length,
    activeAgents,
    criticalAlerts: alerts.length,
    llmTotal: llmCalls.length,
    llmOk,
    completedTasks: tasks.length,
  };
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Get all goals. If the Setting table has a persisted goal list, parse
 * it (and re-derive statuses so they stay fresh). Otherwise derive the
 * default goals from the live system snapshot.
 *
 * Never throws — on any error, returns the derived default goals.
 */
export async function getGoals(): Promise<Goal[]> {
  try {
    const setting = await db.setting.findUnique({
      where: { key: SETTING_KEY },
    });

    if (setting?.value) {
      try {
        const parsed = JSON.parse(setting.value) as Goal[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Re-derive status from current/target so it stays in sync.
          return parsed.map((g) => ({
            ...g,
            status: deriveStatus(g.current, g.target),
          }));
        }
      } catch {
        // fall through to default derivation
      }
    }

    // No persisted goals — derive defaults from live state.
    const state = await readSystemState();
    return buildDefaultGoals(state);
  } catch (err) {
    logger.error("goals.get.error", { error: String(err) });
    // Last-resort fallback: empty array (UI shows empty state).
    return [];
  }
}

/**
 * Persist an entire goal array (replaces existing).
 * Returns the saved goals (with statuses re-derived).
 */
export async function saveGoals(goals: Goal[]): Promise<Goal[]> {
  const normalized = goals.map((g) => ({
    ...g,
    status: deriveStatus(g.current, g.target),
  }));
  const json = JSON.stringify(normalized);
  await db.setting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: json, category: SETTING_CATEGORY },
    update: { value: json, category: SETTING_CATEGORY },
  });
  return normalized;
}

/**
 * Patch a single goal's `current` value by id.
 * Reads the existing goal list, updates the matching entry, persists
 * the full list back, and returns the updated goal (or null if the id
 * wasn't found).
 */
export async function updateGoalProgress(
  goalId: string,
  current: number,
): Promise<Goal | null> {
  const goals = await getGoals();
  const idx = goals.findIndex((g) => g.id === goalId);
  if (idx === -1) return null;
  const updated: Goal = {
    ...goals[idx],
    current,
    status: deriveStatus(current, goals[idx].target),
  };
  goals[idx] = updated;
  await saveGoals(goals);
  return updated;
}
