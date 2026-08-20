import { NextRequest, NextResponse } from "next/server";
import { generateInsights } from "@/lib/ai-insights";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/insights
 *
 * Returns AI-generated insights + recommendations for the current
 * system state. Falls back to rule-based insights if all LLM
 * providers are unreachable.
 *
 * Response shape:
 *   { insights: Insight[], generatedAt: string, source: "llm"|"fallback" }
 */
export async function GET(_req: NextRequest) {
  try {
    const result = await generateInsights();
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.insights.get.error", { error: String(err) });
    return NextResponse.json(
      {
        insights: [],
        generatedAt: new Date().toISOString(),
        source: "fallback" as const,
        error: "failed to generate insights",
        detail: String(err),
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/insights
 *
 * Force regeneration. Accepts an empty body `{}` (or no body at all).
 * Returns the same shape as GET.
 *
 * The route reuses `generateInsights()` — every call hits the live
 * snapshot, so this is effectively a "refresh" trigger.
 */
export async function POST(req: NextRequest) {
  try {
    // Drain the request body if present (we ignore the contents).
    try {
      await req.text();
    } catch {
      /* no body — fine */
    }
    const result = await generateInsights();
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.insights.post.error", { error: String(err) });
    return NextResponse.json(
      {
        insights: [],
        generatedAt: new Date().toISOString(),
        source: "fallback" as const,
        error: "failed to regenerate insights",
        detail: String(err),
      },
      { status: 500 },
    );
  }
}
