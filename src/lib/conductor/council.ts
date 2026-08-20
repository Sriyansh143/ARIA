/**
 * src/lib/conductor/council.ts — v61 Phase 4 (The Council Pattern)
 *
 * Owner's rule: "Before planning, researching, or implementing ANY complex
 * task or owner query, the Conductor MUST consult a 'Council' of 3-4 relevant
 * agents to get their perspectives, identify risks, and gather context. No
 * solo decision-making on complex tasks."
 *
 * This mirrors how a real MNC executive team operates: the CEO doesn't make
 * complex decisions alone — they convene the C-suite (CTO, CFO, COO, CMO)
 * for perspectives, then decide.
 *
 * Flow:
 *   1. conveneCouncil(taskContext) selects 3-4 agents based on the task domain.
 *   2. Parallel lightweight LLM calls ask each agent for their perspective:
 *      risks, required resources, recommended approach.
 *   3. The Conductor aggregates these into a unified "Council Brief".
 *   4. The brief is attached to the task before execution proceeds.
 */

import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { emit } from "@/lib/event-bus";

export interface TaskContext {
  /** The task description / owner query. */
  description: string;
  /** The domain: marketing | code | finance | sales | research | operations | general. */
  domain: string;
  /** The complexity: low | medium | high. */
  complexity: "low" | "medium" | "high";
  /** The requester (owner or agent name). */
  requester?: string;
  /** The task ID (for tracing). */
  taskId?: string;
}

export interface CouncilMember {
  /** Agent name from the fleet (e.g. "Aria-CTO"). */
  name: string;
  /** Agent role (e.g. "CTO"). */
  role: string;
  /** Agent department (e.g. "Engineering"). */
  department: string;
  /** The agent's perspective on the task. */
  perspective: string;
  /** Risks identified by this agent. */
  risks: string[];
  /** Resources this agent says are required. */
  requiredResources: string[];
  /** This agent's recommended approach. */
  recommendedApproach: string;
}

export interface CouncilBrief {
  /** The original task context. */
  task: TaskContext;
  /** The council members consulted. */
  members: CouncilMember[];
  /** Aggregated risks across all members. */
  aggregatedRisks: string[];
  /** Aggregated required resources. */
  aggregatedResources: string[];
  /** The Conductor's synthesized recommendation. */
  conductorSynthesis: string;
  /** Timestamp. */
  convenedAt: string;
}

/**
 * Domain → agent role mapping. For each domain, we select 3-4 agents
 * whose perspectives are most relevant. This mirrors how a real CEO
 * convenes different subsets of the C-suite per topic.
 */
const DOMAIN_COUNCIL: Record<string, string[]> = {
  marketing: ["Aria-CTO", "Vector-SalesLead", "Quill-Content", "Nova-ResearchLead"],
  code: ["Aria-CTO", "Forge-SrEng", "Apex-Architect", "Shield-QALead"],
  finance: ["Ledger-CFO", "Ledger-FinLead", "Balance-SrAccountant", "Swift-Payments"],
  sales: ["Vector-SalesLead", "Closer-SrAE", "Hunter-SDRLead", "Nexus-CRM"],
  research: ["Nova-ResearchLead", "Prism-SrDataAnalyst", "Quant-DataScientist", "Nova-Research"],
  operations: ["Sage-COO", "Pulse-OpsLead", "Atlas-SrPM", "Guard-Compliance"],
  general: ["Aria-CEO", "Sage-COO", "Aria-CTO", "Ledger-CFO"],
};

/**
 * Convene a council of 3-4 relevant agents for a complex task.
 *
 * Makes parallel lightweight LLM calls to each agent asking for their
 * perspective, then aggregates into a Council Brief.
 *
 * @param task The task context (description, domain, complexity).
 * @returns A Council Brief with all member perspectives + the Conductor's synthesis.
 */
export async function conveneCouncil(task: TaskContext): Promise<CouncilBrief> {
  // Select the council members based on the domain.
  const memberNames = DOMAIN_COUNCIL[task.domain] ?? DOMAIN_COUNCIL.general;
  // Take only 3-4 (the owner's rule says 3-4, not more).
  const selectedNames = memberNames.slice(0, 4);

  logger.info("council.convening", {
    domain: task.domain,
    members: selectedNames,
    taskId: task.taskId,
  });

  // Fetch the agent records from the DB (for role + department).
  const agents = await db.agent.findMany({
    where: { name: { in: selectedNames } },
  });

  // Make parallel LLM calls to each council member.
  const { callLLM } = await import("@/lib/llm-client");
  const memberPromises = selectedNames.map(async (name) => {
    const agent = agents.find((a) => a.name === name);
    const role = agent?.role ?? "Agent";
    const department = agent?.department ?? "General";

    const prompt = `You are ${name}, the ${role} in ARIA's ${department} department. A complex task has been raised and the Conductor is convening a council for your perspective.

TASK: ${task.description}
DOMAIN: ${task.domain}
COMPLEXITY: ${task.complexity}

From your department's perspective, provide:
1. RISKS: What could go wrong? (list 2-3 specific risks)
2. RESOURCES: What resources does your department need to contribute? (list 2-3)
3. APPROACH: What is your recommended approach? (2-3 sentences)

Respond in EXACTLY this format (no markdown):
RISKS: [risk 1] | [risk 2] | [risk 3]
RESOURCES: [resource 1] | [resource 2]
APPROACH: [your recommended approach]`;

    try {
      const result = await callLLM(name, role, prompt, { maxRetries: 1 });
      if (!result.success || !result.completion) {
        return {
          name,
          role,
          department,
          perspective: "(unavailable)",
          risks: [],
          requiredResources: [],
          recommendedApproach: "(unavailable)",
        } as CouncilMember;
      }
      return parseCouncilMemberResponse(name, role, department, result.completion);
    } catch (err) {
      logger.warn("council.member-call-failed", { name, error: String(err) });
      return {
        name,
        role,
        department,
        perspective: `(error: ${String(err).slice(0, 80)})`,
        risks: [],
        requiredResources: [],
        recommendedApproach: "(unavailable)",
      } as CouncilMember;
    }
  });

  const members = await Promise.all(memberPromises);

  // Aggregate risks + resources.
  const aggregatedRisks = Array.from(new Set(members.flatMap((m) => m.risks)));
  const aggregatedResources = Array.from(new Set(members.flatMap((m) => m.requiredResources)));

  // The Conductor synthesizes the council's input.
  const conductorSynthesis = await synthesizeCouncil(task, members);

  const brief: CouncilBrief = {
    task,
    members,
    aggregatedRisks,
    aggregatedResources,
    conductorSynthesis,
    convenedAt: new Date().toISOString(),
  };

  // Emit a system event so the dashboard sees the council convened.
  emit({
    type: "system",
    ts: brief.convenedAt,
    message: `🏛️ Council convened for "${task.description.slice(0, 60)}" — ${members.length} members: ${members.map((m) => m.name).join(", ")}`,
    level: "info",
  });

  // Log the brief to the AgentLog for the rules-auditor + audit trail.
  try {
    await db.agentLog.create({
      data: {
        level: "info",
        message: `Council Brief: ${task.description.slice(0, 120)}`,
        meta: JSON.stringify({
          type: "council-brief",
          taskId: task.taskId,
          domain: task.domain,
          members: members.map((m) => ({ name: m.name, role: m.role, department: m.department })),
          aggregatedRisks,
          aggregatedResources,
          conductorSynthesis: conductorSynthesis.slice(0, 500),
          convenedAt: brief.convenedAt,
        }),
      },
    });
  } catch { /* best-effort */ }

  return brief;
}

/**
 * Parse a council member's LLM response into a structured CouncilMember.
 */
function parseCouncilMemberResponse(
  name: string,
  role: string,
  department: string,
  completion: string,
): CouncilMember {
  const risksMatch = completion.match(/RISKS:\s*(.+)/i);
  const resourcesMatch = completion.match(/RESOURCES:\s*(.+)/i);
  const approachMatch = completion.match(/APPROACH:\s*(.+)/i);

  const risks = risksMatch?.[1]
    ? risksMatch[1].split("|").map((r) => r.trim()).filter(Boolean)
    : [];
  const resources = resourcesMatch?.[1]
    ? resourcesMatch[1].split("|").map((r) => r.trim()).filter(Boolean)
    : [];
  const approach = approachMatch?.[1]?.trim() ?? "(no approach provided)";

  return {
    name,
    role,
    department,
    perspective: `${approach}`,
    risks,
    requiredResources: resources,
    recommendedApproach: approach,
  };
}

/**
 * The Conductor synthesizes the council's perspectives into a unified brief.
 */
async function synthesizeCouncil(task: TaskContext, members: CouncilMember[]): Promise<string> {
  const memberSummaries = members
    .map((m) => `- ${m.name} (${m.role}, ${m.department}): ${m.recommendedApproach}`)
    .join("\n");
  const allRisks = members.flatMap((m) => m.risks).filter(Boolean);
  const allResources = members.flatMap((m) => m.requiredResources).filter(Boolean);

  const prompt = `You are the Conductor (Orion) of ARIA Mission Control. You convened a council of ${members.length} agents for this task:

TASK: ${task.description}
DOMAIN: ${task.domain}

Council member perspectives:
${memberSummaries}

Aggregated risks: ${allRisks.join("; ") || "none identified"}
Aggregated resources: ${allResources.join("; ") || "none required"}

Synthesize these into a UNIFIED recommendation (3-5 sentences):
- What is the agreed approach?
- What are the top 2 risks to watch?
- What resources are needed?
- What is the next step?`;

  try {
    const { callLLM } = await import("@/lib/llm-client");
    const result = await callLLM("Maestro-Conductor", "Conductor", prompt, { maxRetries: 1 });
    return result.success && result.completion
      ? result.completion.slice(0, 1000)
      : `Council of ${members.length} consulted. Key risks: ${allRisks.slice(0, 3).join(", ")}. Next step: proceed with execution.`;
  } catch {
    return `Council of ${members.length} consulted. Key risks: ${allRisks.slice(0, 3).join(", ")}. Next step: proceed with execution.`;
  }
}

/**
 * Check whether a task is complex enough to warrant a council.
 * The owner's rule: "If task complexity > 'medium', route through conveneCouncil() first."
 */
export function shouldConveneCouncil(complexity: "low" | "medium" | "high"): boolean {
  return complexity === "high";
}
