import { NextRequest, NextResponse } from "next/server";
import { getDebugTrace } from "@/lib/workflow-state-graph";

export const dynamic = "force-dynamic";

/**
 * GET /api/workflows/[id]/debug — Get full execution trace with checkpoints
 * 
 * Params: id = workflow state ID
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  if (!id) {
    return NextResponse.json({ error: "workflow state ID is required" }, { status: 400 });
  }

  try {
    const result = await getDebugTrace(id);

    if (!result) {
      return NextResponse.json({ error: "Workflow state not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    return NextResponse.json({ 
      error: err instanceof Error ? err.message : "Failed to get debug trace" 
    }, { status: 500 });
  }
}
