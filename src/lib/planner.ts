/**
 * ARIA Mission Control — Claude-Level Planning with Questioning.
 *
 * Task 24 — Part B.
 *
 * Before any agent executes a complex task, the planner:
 *   1. Analyzes the task (complexity / required resources / issues).
 *   2. Generates clarifying questions that should be answered first
 *      (Claude's "ask before you act" pattern — surfaces ambiguity
 *      instead of barreling ahead with a half-baked plan).
 *   3. Generates a step-by-step plan with risks + approval gating.
 *
 * The questions are the key feature: most LLM planners jump straight
 * to a plan, but a Claude-level planner identifies the missing
 * information that would CHANGE the plan if answered. The frontend
 * surfaces these questions to the operator, the answers are fed back
 * into generatePlan(), and the resulting plan is tighter + safer.
 *
 * Mock mode (ARIA_LLM_DISABLED=1) emits deterministic questions +
 * plans so the simulator + tests can run end-to-end without an LLM.
 */
import { callLLM } from "./llm-client";
import { logger } from "./logger";

// ─── Types ───────────────────────────────────────────────────────────
export type Complexity = "low" | "medium" | "high";

export interface TaskAnalysis {
  complexity: Complexity;
  questions: string[];
  potentialIssues: string[];
  requiredResources: string[];
  estimatedSteps: number;
}

export interface ExecutionStep {
  step: number;
  action: string;
  description: string;
  expectedOutput: string;
  /** If true, the operator must approve before this step runs. */
  approvalRequired: boolean;
}

export interface ExecutionPlan {
  steps: ExecutionStep[];
  risks: string[];
  approvalRequired: boolean;
}

export interface PlannerResponse {
  analysis: TaskAnalysis;
  plan: ExecutionPlan;
  questions: string[];
}

// ─── Heuristic complexity classifier (no LLM needed) ────────────────
function classifyComplexity(task: string): {
  complexity: Complexity;
  estimatedSteps: number;
  requiredResources: string[];
} {
  const t = task.toLowerCase();
  let score = 0;
  const resources = new Set<string>();

  // Indicators of higher complexity.
  if (/deploy|production|prod|release|launch/.test(t)) { score += 2; resources.add("devops"); }
  if (/contract|legal|sign|agree/.test(t)) { score += 2; resources.add("legal"); }
  if (/\$\d|budget|spend|cost|pay/.test(t)) { score += 1; resources.add("finance"); }
  if (/customer|client|user|customer/.test(t)) { score += 1; resources.add("support"); }
  if (/marketing|campaign|content|ad|social/.test(t)) { score += 1; resources.add("marketing"); }
  if (/research|investigat|analyz|study/.test(t)) { score += 1; resources.add("research"); }
  if (/code|engineer|build|implement|develop/.test(t)) { score += 1; resources.add("engineering"); }
  if (/investor|board|stakeholder/.test(t)) { score += 1; resources.add("executive"); }
  if (/security|compliance|gdpr|soc2|pci/.test(t)) { score += 2; resources.add("compliance"); }
  if (/urgent|critical|asap|immediately/.test(t)) { score += 1; }

  // Word count — long tasks tend to be more complex.
  const wordCount = task.trim().split(/\s+/).length;
  if (wordCount > 50) score += 2;
  else if (wordCount > 20) score += 1;

  // Multiple steps indicators (and, then, after, finally).
  const stepIndicators = (t.match(/\b(and|then|after|finally|next|subsequently)\b/g) || []).length;
  score += Math.min(stepIndicators, 3);

  let complexity: Complexity = "low";
  if (score >= 5) complexity = "high";
  else if (score >= 2) complexity = "medium";

  const estimatedSteps = Math.max(
    2,
    Math.min(10, Math.ceil(score / 1.5) + stepIndicators),
  );

  if (resources.size === 0) resources.add("general");

  return {
    complexity,
    estimatedSteps,
    requiredResources: Array.from(resources),
  };
}

// ─── Mock content (used when ARIA_LLM_DISABLED=1) ───────────────────
const MOCK_QUESTIONS = [
  "What is the desired outcome / definition of done?",
  "What is the deadline, and is it hard or soft?",
  "Who is the approver if this requires sign-off?",
  "Are there existing assets / prior work I should reuse?",
];

const MOCK_ISSUES = [
  "Scope ambiguity — task could be interpreted multiple ways.",
  "Resource contention — multiple agents may need the same data.",
  "Time pressure may force shortcuts that compromise quality.",
];

function mockPlan(task: string, est: number): ExecutionPlan {
  const steps: ExecutionStep[] = Array.from({ length: Math.max(3, Math.min(est, 6)) }, (_, i) => ({
    step: i + 1,
    action: `Step ${i + 1}: ${i === 0 ? "Gather context" : i === 1 ? "Draft approach" : i === 2 ? "Execute" : i === 3 ? "Validate" : i === 4 ? "Iterate" : "Report"}`,
    description: `For task "${task.slice(0, 80)}" — perform the ${i === 0 ? "research" : i === 1 ? "planning" : i === 2 ? "implementation" : i === 3 ? "QA / review" : i === 4 ? "refinement" : "handoff"} step. (mock content)`,
    expectedOutput: `A concrete deliverable from step ${i + 1}.`,
    approvalRequired: i === 2 && /deploy|spend|contract|sign|production/.test(task.toLowerCase()),
  }));
  return {
    steps,
    risks: MOCK_ISSUES.slice(0, 2),
    approvalRequired: steps.some((s) => s.approvalRequired),
  };
}

// ─── analyzeTask ────────────────────────────────────────────────────
/**
 * Analyze a task and return complexity + clarifying questions +
 * potential issues + required resources + estimated step count.
 *
 * Uses the LLM if available; falls back to heuristics + mock content
 * otherwise. Never throws.
 */
export async function analyzeTask(
  task: string,
  agentRole: string,
): Promise<TaskAnalysis> {
  if (!task || task.trim().length < 3) {
    return {
      complexity: "low",
      questions: [],
      potentialIssues: ["Task is empty or too short to analyze."],
      requiredResources: [],
      estimatedSteps: 1,
    };
  }

  const heuristic = classifyComplexity(task);

  if (process.env.ARIA_LLM_DISABLED === "1") {
    return {
      complexity: heuristic.complexity,
      questions: MOCK_QUESTIONS.slice(0, heuristic.complexity === "high" ? 4 : heuristic.complexity === "medium" ? 3 : 2),
      potentialIssues: MOCK_ISSUES,
      requiredResources: heuristic.requiredResources,
      estimatedSteps: heuristic.estimatedSteps,
    };
  }

  const prompt = `You are the ARIA planner. Analyze the following task and return your analysis as JSON only (no markdown).

Task: "${task.slice(0, 600)}"
Agent role that will execute: ${agentRole}

Return EXACTLY this shape:
{
  "complexity": "low" | "medium" | "high",
  "questions": ["..."],   // 2-5 clarifying questions whose answers would change the plan
  "potentialIssues": ["..."],  // 1-3 risks
  "requiredResources": ["..."],  // e.g. ["engineering", "finance", "legal"]
  "estimatedSteps": <number 2-10>
}

Heuristic hint: complexity=${heuristic.complexity}, estSteps=${heuristic.estimatedSteps}, resources=${JSON.stringify(heuristic.requiredResources)}.
Trust the heuristic unless the task clearly suggests otherwise.`;

  try {
    const result = await callLLM("Planner-Analyzer", "Conductor", prompt, {
      maxRetries: 1,
    });
    if (!result.success || !result.completion) {
      return {
        complexity: heuristic.complexity,
        questions: MOCK_QUESTIONS.slice(0, 3),
        potentialIssues: MOCK_ISSUES,
        requiredResources: heuristic.requiredResources,
        estimatedSteps: heuristic.estimatedSteps,
      };
    }

    const cleaned = result.completion
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned) as Partial<TaskAnalysis>;

    const complexity: Complexity =
      parsed.complexity === "low" || parsed.complexity === "medium" || parsed.complexity === "high"
        ? parsed.complexity
        : heuristic.complexity;

    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.filter((q): q is string => typeof q === "string" && q.length > 0).slice(0, 6)
      : MOCK_QUESTIONS.slice(0, 3);

    const potentialIssues = Array.isArray(parsed.potentialIssues)
      ? parsed.potentialIssues.filter((i): i is string => typeof i === "string" && i.length > 0).slice(0, 5)
      : MOCK_ISSUES;

    const requiredResources = Array.isArray(parsed.requiredResources)
      ? parsed.requiredResources.filter((r): r is string => typeof r === "string" && r.length > 0)
      : heuristic.requiredResources;

    const estimatedSteps =
      typeof parsed.estimatedSteps === "number" && parsed.estimatedSteps >= 1 && parsed.estimatedSteps <= 20
        ? Math.floor(parsed.estimatedSteps)
        : heuristic.estimatedSteps;

    return {
      complexity,
      questions,
      potentialIssues,
      requiredResources,
      estimatedSteps,
    };
  } catch (err) {
    logger.warn("planner.analyze.error", { error: String(err) });
    return {
      complexity: heuristic.complexity,
      questions: MOCK_QUESTIONS.slice(0, 3),
      potentialIssues: MOCK_ISSUES,
      requiredResources: heuristic.requiredResources,
      estimatedSteps: heuristic.estimatedSteps,
    };
  }
}

// ─── generatePlan ────────────────────────────────────────────────────
/**
 * Generate an execution plan from the analysis + optional answers to
 * the clarifying questions. If answers are provided, the LLM prompt
 * is enriched so the plan reflects them (tighter + more specific).
 *
 * @param task     The task description.
 * @param analysis The analysis returned by analyzeTask().
 * @param answers  Optional map of question → answer (the operator's
 *                 clarifications). Used to refine the plan.
 */
export async function generatePlan(
  task: string,
  analysis: TaskAnalysis,
  answers?: Record<string, string>,
): Promise<ExecutionPlan> {
  if (process.env.ARIA_LLM_DISABLED === "1") {
    return mockPlan(task, analysis.estimatedSteps);
  }

  const answersText = answers && Object.keys(answers).length > 0
    ? Object.entries(answers)
        .map(([q, a]) => `Q: ${q}\nA: ${a}`)
        .join("\n\n")
    : "(no clarifications provided — proceed with reasonable defaults.)";

  const prompt = `You are the ARIA planner. Generate an execution plan as JSON only (no markdown).

Task: "${task.slice(0, 600)}"
Complexity: ${analysis.complexity}
Required resources: ${JSON.stringify(analysis.requiredResources)}
Estimated steps: ${analysis.estimatedSteps}
Potential issues: ${JSON.stringify(analysis.potentialIssues)}

Operator's clarifications:
${answersText}

Return EXACTLY this shape:
{
  "steps": [
    {
      "step": 1,
      "action": "short verb-led title",
      "description": "what specifically happens in this step",
      "expectedOutput": "the concrete deliverable",
      "approvalRequired": false
    }
  ],
  "risks": ["..."],
  "approvalRequired": <true if any step requires approval>
}

Rules:
- steps[0].step === 1, sequentially numbered.
- approvalRequired=true for any step that deploys, spends money, signs contracts, or sends external comms.
- 3-7 steps — never more than 10.
- Be specific to THIS task — no generic placeholders.`;

  try {
    const result = await callLLM("Planner-Generator", "Conductor", prompt, {
      maxRetries: 1,
    });
    if (!result.success || !result.completion) {
      return mockPlan(task, analysis.estimatedSteps);
    }

    const cleaned = result.completion
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned) as Partial<ExecutionPlan>;

    const steps = Array.isArray(parsed.steps) && parsed.steps.length > 0
      ? parsed.steps
          .filter((s) => s && typeof s.action === "string")
          .map((s, i) => ({
            step: i + 1,
            action: String(s.action).slice(0, 200),
            description: String(s.description ?? "").slice(0, 500),
            expectedOutput: String(s.expectedOutput ?? "").slice(0, 200),
            approvalRequired: Boolean(s.approvalRequired),
          }))
          .slice(0, 10)
      : mockPlan(task, analysis.estimatedSteps).steps;

    const risks = Array.isArray(parsed.risks)
      ? parsed.risks.filter((r): r is string => typeof r === "string").slice(0, 5)
      : analysis.potentialIssues.slice(0, 3);

    return {
      steps,
      risks,
      approvalRequired: steps.some((s) => s.approvalRequired),
    };
  } catch (err) {
    logger.warn("planner.generate.error", { error: String(err) });
    return mockPlan(task, analysis.estimatedSteps);
  }
}

// ─── questionBeforeExecution (main entry point) ─────────────────────
/**
 * The main planner entry point — called BEFORE any complex task is
 * dispatched to an executor agent.
 *
 * Returns:
 *   - analysis: complexity / required resources / potential issues
 *   - questions: clarifying questions the operator should answer
 *   - plan: a preliminary execution plan (refined later if answers
 *           are provided via generatePlan with `answers`)
 *
 * The frontend can render this as: "ARIA thinks this is a ${complexity}
 * task. Before I proceed, can you clarify: ${questions.join(' / ')}.
 * Here's my preliminary plan: ${plan}."
 */
export async function questionBeforeExecution(
  task: string,
  agentRole: string,
): Promise<PlannerResponse> {
  const analysis = await analyzeTask(task, agentRole);
  const plan = await generatePlan(task, analysis);
  return {
    analysis,
    plan,
    questions: analysis.questions,
  };
}
