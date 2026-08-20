/**
 * POST /api/gdpr/request — submit a GDPR Data Subject Request.
 * GET  /api/gdpr/request — list all DSRs (owner dashboard).
 *
 * Body: { type: "access"|"erasure"|"portability"|"rectification", subject: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { submitDsr, type DsrType } from "@/lib/gdpr";
import { recordAudit } from "@/lib/audit-log";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_TYPES = new Set(["access", "erasure", "portability", "rectification"]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const type = (body.type ?? "").toString() as DsrType;
    const subject = (body.subject ?? "").toString().trim();
    if (!VALID_TYPES.has(type)) {
      return NextResponse.json({ error: "Invalid type. Must be access|erasure|portability|rectification" }, { status: 400 });
    }
    if (!subject) {
      return NextResponse.json({ error: "subject is required (email, telegram handle, or phone)" }, { status: 400 });
    }

    const result = await submitDsr({ type, subject, requestedBy: "owner" });

    await recordAudit({
      actor: "owner",
      actorRole: "owner",
      action: "create",
      resource: "DataSubjectRequest",
      resourceId: result.id,
      after: { type, subject: "[REDACTED]", status: result.status },
      source: "api",
      context: { ip: req.headers.get("x-forwarded-for") ?? undefined, userAgent: req.headers.get("user-agent") ?? undefined },
    });

    logger.info("api.gdpr.submit", { id: result.id, type, status: result.status });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    logger.error("api.gdpr.submit-failed", { error: String(err) });
    return NextResponse.json({ error: "internal_error", detail: String(err) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const { db } = await import("@/lib/db");
    const rows = await db.dataSubjectRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ requests: rows });
  } catch (err) {
    logger.error("api.gdpr.list-failed", { error: String(err) });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
