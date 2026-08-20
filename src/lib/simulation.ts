/**
 * src/lib/simulation.ts — re-export barrel for the simulation modules.
 *
 * Previously a 1337-line monolith, now split into:
 *   - ./simulation/fleet          — 37-agent roster + serializeAgent + LOG_MESSAGES + PROVIDER_MODELS
 *   - ./simulation/seed-templates — data templates (tasks, deals, revenue, etc.) + pick/chance
 *   - ./simulation/seed           — seedIfEmpty() DB hydration
 *   - ./simulation/engine         — tick loop + startEngine/stopEngine
 *
 * This barrel preserves backward compatibility — all existing imports
 * `from "@/lib/simulation"` continue to work unchanged.
 *
 * Re-exported surface (must match the original monolith's exports):
 *   - FLEET, serializeAgent, AGENT_STATUSES            (fleet)
 *   - TASK_TEMPLATES, REVENUE_TEMPLATES, DEAL_TEMPLATES,
 *     MESSAGE_TEMPLATES, MEMORY_TEMPLATES, PERSONNEL_TEMPLATES,
 *     pick                                              (seed-templates)
 *   - seedIfEmpty                                       (seed)
 *   - startEngine, stopEngine                           (engine)
 */
export {
  FLEET,
  serializeAgent,
  AGENT_STATUSES,
} from "./simulation/fleet";

export {
  TASK_TEMPLATES,
  REVENUE_TEMPLATES,
  DEAL_TEMPLATES,
  MESSAGE_TEMPLATES,
  MEMORY_TEMPLATES,
  PERSONNEL_TEMPLATES,
  pick,
} from "./simulation/seed-templates";

export {
  seedIfEmpty,
} from "./simulation/seed";

export {
  startEngine,
  stopEngine,
} from "./simulation/engine";
