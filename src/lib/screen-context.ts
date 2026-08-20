/**
 * ARIA Mission Control — Screen context for Conductor routing.
 *
 * Ported from FounderOS-DEMO/lib/screen-context.ts, adapted for ARIA's
 * single-page dashboard. The FounderOS original had a multi-route app
 * (`/funnel`, `/agents`, `/integrations`, `/roadmap`) where each route was
 * a separate page; ARIA's dashboard is one page (`/dashboard`) with anchor
 * sections. So `getScreenContext` reads both the route AND the hash.
 *
 * The output is a short, honest sentence about what the operator is looking
 * at, handed to the agent so it can talk about the screen (Notion-agent
 * style). The Conductor asks better questions when it knows you're staring
 * at the Approval Queue vs. the Agent Network Graph.
 *
 * Pure + synchronous: no DB, no async, no IO. The Conductor calls this on
 * every message with `window.location.pathname + window.location.hash`.
 *
 * Tabs (the top-level grouping ARIA uses):
 *   Mission Control · Agents · Operate · Finance · Telemetry · System
 *
 * Sections are the specific anchor on the dashboard (e.g. "Agent Roster",
 * "Task Pipeline", "System Alerts"). Unknown hashes degrade gracefully —
 * the tab is still right, the section just becomes the hash itself.
 */

export type ScreenTab =
  | "Mission Control"
  | "Agents"
  | "Operate"
  | "Finance"
  | "Telemetry"
  | "System"
  | "Conductor"
  | "Auth";

export type ScreenContext = {
  tab: ScreenTab;
  /** Human-readable section name, or null when only the tab is known. */
  section: string | null;
};

// ─── Pathname → tab mapping ──────────────────────────────────────────
const PATH_TO_TAB: Record<string, ScreenTab> = {
  "/": "Mission Control",
  "/dashboard": "Mission Control",
  "/login": "Auth",
  "/signup": "Auth",
};

// ─── Hash → { tab, section } mapping ─────────────────────────────────
/**
 * Canonical hash → context map. Covers both ARIA's actual dashboard anchors
 * (id="agent-fleet", id="task-pipeline", etc.) AND the operator-friendly
 * aliases the task spec mentions (#roster, #network, #tasks). An alias and
 * its canonical anchor map to the same context — operators can type either.
 */
export const SCREEN_MAP: Record<string, ScreenContext> = {
  // ── Mission Control (overview) ──────────────────────────────────────
  "#workflows": { tab: "Mission Control", section: "Workflows" },
  "#mission-timeline": { tab: "Mission Control", section: "Mission Timeline" },

  // ── Agents tab ──────────────────────────────────────────────────────
  "#agent-fleet": { tab: "Agents", section: "Agent Roster" },
  "#roster": { tab: "Agents", section: "Agent Roster" },
  "#agent-fleet-network": { tab: "Agents", section: "Agent Fleet Network" },
  "#capability-matrix": { tab: "Agents", section: "Capability Matrix" },
  "#agent-comm": { tab: "Agents", section: "Agent Communication" },
  "#agent-network": { tab: "Agents", section: "Agent Network Graph" },
  "#network": { tab: "Agents", section: "Agent Network Graph" },
  "#department-network": { tab: "Agents", section: "Department Network" },
  "#dept-network": { tab: "Agents", section: "Department Network" },
  "#memory-network": { tab: "Agents", section: "Memory Network" },

  // ── Operate tab ─────────────────────────────────────────────────────
  "#tasks": { tab: "Operate", section: "Task Pipeline" },
  "#task-pipeline": { tab: "Operate", section: "Task Pipeline" },
  "#task-dag": { tab: "Operate", section: "Task Dependency Graph" },
  "#approval-queue": { tab: "Operate", section: "Approval Queue" },
  "#approvals": { tab: "Operate", section: "Approval Queue" },
  "#task-velocity": { tab: "Operate", section: "Task Velocity" },
  "#task-optimizer": { tab: "Operate", section: "Task Optimizer" },

  // ── Finance tab ─────────────────────────────────────────────────────
  "#financial": { tab: "Finance", section: "Financial Operations" },
  "#revenue-forecast": { tab: "Finance", section: "Revenue Forecast" },
  "#cost-profit": { tab: "Finance", section: "Cost / Profit Analysis" },

  // ── Telemetry tab ───────────────────────────────────────────────────
  "#system-health": { tab: "Telemetry", section: "System Health" },
  "#telemetry": { tab: "Telemetry", section: "Telemetry" },
  "#metrics": { tab: "Telemetry", section: "Telemetry" },
  "#activity-heatmap": { tab: "Telemetry", section: "Activity Heatmap" },
  "#live-log-stream": { tab: "Telemetry", section: "Live Log Stream" },
  "#logs": { tab: "Telemetry", section: "Live Log Stream" },
  "#leaderboard": { tab: "Telemetry", section: "Agent Leaderboard" },

  // ── System tab ──────────────────────────────────────────────────────
  "#system-alerts": { tab: "System", section: "System Alerts" },
  "#alerts": { tab: "System", section: "System Alerts" },
  "#cron-registry": { tab: "System", section: "Cron Registry" },
  "#skills-registry": { tab: "System", section: "Skills Registry" },
  "#collaboration-graph": { tab: "System", section: "Collaboration Graph" },
  "#notification-prefs": { tab: "System", section: "Notification Preferences" },
  "#export": { tab: "System", section: "Export Panel" },

  // ── Conductor ───────────────────────────────────────────────────────
  "#conductor": { tab: "Conductor", section: "Conductor" },
};

/**
 * Resolve a URL (pathname + optional hash) to a screen context.
 *
 * Hash wins when present (the operator is looking at a specific section).
 * Falls back to the pathname's tab when there's no hash or the hash is
 * unknown. Returns `{ tab: "Mission Control", section: null }` for unknown
 * paths — never throws, never returns null.
 *
 * Accepts the full URL ("http://host/dashboard#roster"), a pathname
 * ("/dashboard"), a hash ("#roster"), or a pathname+hash combo
 * ("/dashboard#roster"). Strips query strings.
 */
export function getScreenContext(input: string): ScreenContext {
  if (!input || typeof input !== "string") {
    return { tab: "Mission Control", section: null };
  }

  // Strip query string, then split pathname from hash.
  const qIdx = input.indexOf("?");
  const noQuery = qIdx >= 0 ? input.slice(0, qIdx) : input;
  const hashIdx = noQuery.indexOf("#");
  const pathname = hashIdx >= 0 ? noQuery.slice(0, hashIdx) : noQuery;
  const hash = hashIdx >= 0 ? noQuery.slice(hashIdx).toLowerCase() : "";

  // Hash first — most specific.
  if (hash && SCREEN_MAP[hash]) {
    return SCREEN_MAP[hash];
  }

  // Pathname → tab.
  const tab = PATH_TO_TAB[pathname || "/"] ?? "Mission Control";

  // Unknown hash → keep the tab, surface the hash as a fallback section
  // name so the Conductor at least knows the operator is somewhere on
  // this tab (and the operator can see we tried).
  if (hash) {
    return { tab, section: hash.slice(1) };
  }

  return { tab, section: null };
}

/**
 * Format a screen context as a single English sentence for LLM prompts.
 *
 *   { tab: "Agents", section: "Agent Roster" }
 *   → "Operator is viewing the Agents tab, Agent Roster section."
 *
 *   { tab: "Mission Control", section: null }
 *   → "Operator is viewing the Mission Control tab."
 *
 * The sentence is intentionally short — it's one line of context in a
 * longer system prompt, not a paragraph. The Conductor reads this and
 * knows whether to talk about the funnel, the fleet, or the alert queue.
 */
export function formatScreenContext(ctx: ScreenContext): string {
  if (ctx.section) {
    return `Operator is viewing the ${ctx.tab} tab, ${ctx.section} section.`;
  }
  return `Operator is viewing the ${ctx.tab} tab.`;
}

/**
 * Convenience: resolve + format in one call. The Conductor's chat route
 * uses this; everything else uses the two-step form so it can read the
 * structured `ScreenContext` for routing decisions.
 */
export function screenContextString(input: string): string {
  return formatScreenContext(getScreenContext(input));
}
