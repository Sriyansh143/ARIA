import { NextRequest, NextResponse } from "next/server";
import { analyzeScreen, queryScreen, executeScreenAction } from "@/lib/screen-vision";

export const dynamic = "force-dynamic";

/**
 * POST /api/screen-vision
 * Body: { action: "analyze" | "query" | "execute", base64, question?, agentRole? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, base64, question, agentRole, context } = body;

    if (!base64) {
      return NextResponse.json({ error: "Missing base64 image" }, { status: 400 });
    }

    switch (action) {
      case "analyze":
        const analysis = await analyzeScreen(base64, "image/png", context);
        return NextResponse.json({ analysis });

      case "query":
        if (!question) return NextResponse.json({ error: "Missing question" }, { status: 400 });
        const result = await queryScreen(question, base64, "image/png", agentRole ?? "Conductor");
        return NextResponse.json({ result });

      case "execute":
        if (!question) return NextResponse.json({ error: "Missing action description" }, { status: 400 });
        const execResult = await executeScreenAction(question, base64, agentRole ?? "Conductor");
        return NextResponse.json({ result: execResult });

      default:
        return NextResponse.json({ error: "Invalid action. Use: analyze, query, or execute" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** GET /api/screen-vision — returns capabilities */
export async function GET() {
  return NextResponse.json({
    capabilities: ["analyze", "query", "execute"],
    description: "Screen sharing + vision interaction system. POST with base64 image + action.",
  });
}
