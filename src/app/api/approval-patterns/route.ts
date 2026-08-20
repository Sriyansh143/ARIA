/**
 * GET /api/approval-patterns — v72 Phase 22 (RULE-71)
 *
 * List all approval patterns (post templates, message templates, call scripts).
 *
 * POST /api/approval-patterns — request a new pattern approval.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrResponse } from "@/lib/auth";
import { listPatterns, requestPatternApproval, requestCallScriptApproval, approvePattern, revokePattern, type ApprovalChannel } from "@/lib/approval-patterns";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuthOrResponse("GET", "/api/approval-patterns");
  if (auth instanceof NextResponse) return auth;

  try {
    const channel = req.nextUrl.searchParams.get("channel") as ApprovalChannel | null;
    const category = req.nextUrl.searchParams.get("category") ?? undefined;
    const status = req.nextUrl.searchParams.get("status") ?? undefined;

    const patterns = await listPatterns({ channel: channel ?? undefined, category, status });
    return NextResponse.json({ ok: true, count: patterns.length, patterns });
  } catch (err) {
    logger.error("api.approval-patterns.list.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthOrResponse("POST", "/api/approval-patterns");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));

    // Call script approval request?
    if (body.type === "call-script") {
      const { scriptName, category, targetAudience, openingHook, pitchBody, objectionHandlers, closingQuestion } = body;
      if (!scriptName || !category || !openingHook || !pitchBody || !closingQuestion) {
        return NextResponse.json({ ok: false, error: "Missing required fields for call-script approval" }, { status: 400 });
      }
      const result = await requestCallScriptApproval(
        scriptName, category, targetAudience ?? "",
        openingHook, pitchBody,
        objectionHandlers ?? [],
        closingQuestion,
      );
      return NextResponse.json({ ok: true, ...result });
    }

    // Regular pattern approval request.
    const { patternName, channel, category, contentTemplate, variablesJson, targetAudienceDescription, expiresInDays } = body;
    if (!patternName || !channel || !category || !contentTemplate) {
      return NextResponse.json({ ok: false, error: "Missing required fields: patternName, channel, category, contentTemplate" }, { status: 400 });
    }
    const result = await requestPatternApproval({
      patternName,
      channel: channel as ApprovalChannel,
      category,
      contentTemplate,
      variablesJson: variablesJson ?? [],
      targetAudienceDescription: targetAudienceDescription ?? "",
      expiresInDays: expiresInDays ?? 30,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error("api.approval-patterns.create.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
  }
}

/**
 * PATCH /api/approval-patterns — approve or revoke a pattern.
 *   Body: { action: "approve" | "revoke", patternId, reason? }
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAuthOrResponse("PATCH", "/api/approval-patterns");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const { action, patternId, reason, expiresInDays, approvedBy } = body;

    if (action === "approve") {
      const result = await approvePattern(patternId, approvedBy ?? "owner", expiresInDays ?? 30);
      return NextResponse.json(result);
    } else if (action === "revoke") {
      const result = await revokePattern(patternId, reason ?? "Owner revocation");
      return NextResponse.json(result);
    }
    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
  }
}
