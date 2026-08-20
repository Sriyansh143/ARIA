/**
 * src/lib/simulation-scenarios/index.ts — v63 Phase 13
 *
 * Exports the SimulationScenario type + all 100 scenarios across 4 suites.
 */

export interface SimulationScenario {
  id: string;
  name: string;
  type: "customer-purchase" | "owner-command" | "edge-case" | "tough-question";
  setup?: () => Promise<void>;
  execute: () => Promise<{
    criteriaMet?: Record<string, boolean>;
    rulesViolated?: string[];
    lessonsLearned?: string[];
    output?: string;
    error?: string;
  }>;
  successCriteria: string[];
}

export interface SimulationResult {
  id: string;
  name: string;
  type: string;
  passed: boolean;
  rulesViolated: string[];
  lessonsLearned: string[];
  executionTimeMs: number;
  error?: string;
  details: Record<string, unknown>;
}

export interface SimulationSuiteResult {
  suiteName: string;
  totalScenarios: number;
  passed: number;
  failed: number;
  passRate: number;
  avgExecutionTimeMs: number;
  commonFailurePatterns: Array<{ pattern: string; count: number }>;
  results: SimulationResult[];
}

import { CUSTOMER_PURCHASE_SCENARIOS } from "./customer-purchase";
import { OWNER_COMMAND_SCENARIOS } from "./owner-commands";
import { EDGE_CASE_SCENARIOS } from "./edge-cases";
import { TOUGH_QUESTION_SCENARIOS } from "./tough-questions";
import { COMM_QUALITY_SCENARIOS } from "./comm-quality";
import { REVENUE_INTERACTION_SCENARIOS } from "./revenue-interaction";

export const SIMULATION_SUITES: Record<string, SimulationScenario[]> = {
  "customer-purchase": CUSTOMER_PURCHASE_SCENARIOS,
  "owner-commands": OWNER_COMMAND_SCENARIOS,
  "edge-cases": EDGE_CASE_SCENARIOS,
  "tough-questions": TOUGH_QUESTION_SCENARIOS,
  "comm-quality": COMM_QUALITY_SCENARIOS,
  "revenue-interaction": REVENUE_INTERACTION_SCENARIOS,
};
