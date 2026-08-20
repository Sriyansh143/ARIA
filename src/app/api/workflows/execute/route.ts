import { NextRequest, NextResponse } from "next/server";
import { executeWorkflowGraph, type WorkflowGraph } from "@/lib/workflow-state-graph";
import { emit } from "@/lib/event-bus";
import { toIso, LOG_LEVELS } from "@/lib/types";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/workflows/execute — Start workflow graph execution
 * 
 * Body:
 * {
 *   graph: WorkflowGraph,
 *   initialState?: Record<string, unknown>
 * }
 */
export async function POST(req: NextRequest) {
  let body: { graph?: WorkflowGraph; initialState?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { graph, initialState } = body;
  
  if (!graph) {
    return NextResponse.json({ error: "graph is required" }, { status: 400 });
  }

  // Validate graph structure
  if (!graph.id || !graph.name || !graph.nodes || !graph.edges || !graph.startNodeId) {
    return NextResponse.json({ 
      error: "Invalid graph structure. Required: id, name, nodes, edges, startNodeId" 
    }, { status: 400 });
  }

  try {
    // Execute the workflow graph
    const result = await executeWorkflowGraph(graph, initialState ?? {});

    // Emit system log about workflow execution
    emit({
      type: "system",
      ts: toIso(new Date())!,
      message: `Workflow graph "${graph.name}" executed - status: ${result.status}`,
      level: "info" as (typeof LOG_LEVELS)[number],
    });

    return NextResponse.json({
      ok: true,
      state: result,
    });
  } catch (err) {
    logger.error("workflow-api.execute-error", {
      graphId: graph.id,
      error: String(err),
    });

    return NextResponse.json({ 
      error: err instanceof Error ? err.message : "Execution failed" 
    }, { status: 500 });
  }
}
