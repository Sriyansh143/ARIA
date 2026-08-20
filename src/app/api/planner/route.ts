import { NextRequest, NextResponse } from "next/server";
import {
  analyzeTask,
  generatePlan,
  questionBeforeExecution,
  type TaskAnalysis,
} from "@/lib/planner";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/planner
 *
 * Analyzes a task and returns the analysis + clarifying questions +
 * preliminary plan.
 *
 * Body:
 *   {
 *     task:       string,        // required — the task to plan
 *     agentRole:  string,        // required — which agent role will execute
 *     answers?:   Record<string, string>,  // optional — operator clarifications
 *                                          //   if provided, the plan is refined
 *   }
 *
 * Response:
 *   {
 *     analysis: { complexity, questions, potentialIssues, requiredResources, estimatedSteps },
 *     plan:     { steps, risks, approvalRequired },
 *     questions: string[]
 *   }
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    task?: string;
    agentRole?: string;
    answers?: Record<string, string>;
  };

  if (!body.task || typeof body.task !== "string" || body.task.trim().length < 3) {
    return NextResponse.json(
      { error: "task is required (min 3 chars)" },
      { status: 400 },
    );
  }

  const task = body.task.trim();
  const agentRole = (body.agentRole ?? "Conductor").trim();

  // If answers are provided, refine the plan with them.
  if (body.answers && typeof body.answers === "object" && Object.keys(body.answers).length > 0) {
    try {
      const analysis: TaskAnalysis = await analyzeTask(task, agentRole);
      const plan = await generatePlan(task, analysis, body.answers);
      logger.info("api.planner.refined", {
        taskLen: task.length,
        agentRole,
        answers: Object.keys(body.answers).length,
      });
      return NextResponse.json({
        analysis,
        plan,
        questions: analysis.questions,
        refined: true,
      });
    } catch (err) {
      logger.error("api.planner.refined.fail", { error: String(err) });
      return NextResponse.json(
        { error: "refinement failed", detail: String(err) },
        { status: 500 },
      );
    }
  }

  // Standard questionBeforeExecution path.
  try {
    const result = await questionBeforeExecution(task, agentRole);
    logger.info("api.planner.analyzed", {
      taskLen: task.length,
      agentRole,
      complexity: result.analysis.complexity,
      questions: result.questions.length,
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.planner.fail", { error: String(err) });
    return NextResponse.json(
      { error: "planning failed", detail: String(err) },
      { status: 500 },
    );
  }
}

/**
 * GET /api/planner
 *
 * Returns metadata about the planner (which agent roles can use it,
 * supported complexity levels) so the frontend can render a planner
 * widget without making a POST first.
 */
export async function GET() {
  return NextResponse.json({
    description: "Claude-level planner — analyzes a task, asks clarifying questions, then generates a step-by-step plan with risks + approval gating.",
    complexityLevels: ["low", "medium", "high"],
    steps: [
      "1. POST { task, agentRole } → receive analysis + questions + preliminary plan.",
      "2. (optional) POST { task, agentRole, answers } → receive refined plan.",
      "3. Dispatch the plan to the executor agent — steps with approvalRequired=true block on /api/approvals.",
    ],
    defaults: {
      maxSteps: 10,
      maxQuestions: 5,
      maxRisks: 5,
    },
  });
}
