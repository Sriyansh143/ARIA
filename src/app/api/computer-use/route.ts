import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { captureScreen, analyzeScreen, executeAction } from "@/lib/computer-use";

export const dynamic = "force-dynamic";

/**
 * POST /api/computer-use
 * Body:
 *   { action: "capture" }
 *   { action: "analyze", base64, question }
 *   { action: "execute", type: "click"|"type"|"key", x?, y?, text? }
 *
 * All actions gracefully degrade — missing optional deps return
 * { status: "unsupported" } rather than throwing.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body?.action ?? "");

    if (action === "capture") {
      const result = await captureScreen();
      return NextResponse.json(result);
    }

    if (action === "analyze") {
      if (!body?.base64 || !body?.question) {
        return NextResponse.json(
          { error: "base64 + question required" },
          { status: 400 }
        );
      }
      const result = await analyzeScreen(
        String(body.base64),
        String(body.question)
      );
      return NextResponse.json(result);
    }

    if (action === "execute") {
      const result = await executeAction({
        type: String(body?.type ?? "click") as "click" | "type" | "key",
        x: body.x !== undefined ? Number(body.x) : undefined,
        y: body.y !== undefined ? Number(body.y) : undefined,
        text: body.text ? String(body.text) : undefined,
      });
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: "action must be capture, analyze, or execute" },
      { status: 400 }
    );
  } catch (err) {
    logger.error("api.computer-use.failed", { error: String(err) });
    return NextResponse.json(
      { error: "computer-use action failed" },
      { status: 500 }
    );
  }
}
