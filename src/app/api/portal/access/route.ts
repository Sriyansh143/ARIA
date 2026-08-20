/**
 * /api/portal/access — v73 Phase 23
 *
 * GET  — validate a portal magic-link token + return the client's project data.
 *        Called by the client portal page on load.
 * POST — generate a new magic-link token for a client (owner-only).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * GET /api/portal/access?token=xxx
 * Returns the client's project data: milestones, deliverables, invoices, contract.
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing 'token' parameter" }, { status: 400 });
    }

    const access = await db.clientPortalAccess.findUnique({ where: { token } });
    if (!access) {
      return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 404 });
    }
    if (access.expiresAt && access.expiresAt < new Date()) {
      return NextResponse.json({ ok: false, error: "Token expired" }, { status: 410 });
    }

    // Update last-accessed + increment count.
    await db.clientPortalAccess.update({
      where: { id: access.id },
      data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
    });

    // Pull the project data (milestones from ServiceOrder, contract, deliverables).
    const serviceOrder = access.serviceOrderId
      ? await db.serviceOrder.findUnique({ where: { id: access.serviceOrderId } })
      : null;
    const contract = access.contractId
      ? await db.contract.findUnique({ where: { id: access.contractId } })
      : null;

    return NextResponse.json({
      ok: true,
      client: {
        name: access.clientName,
        email: access.clientEmail,
        company: access.clientCompany,
      },
      project: serviceOrder ? {
        id: serviceOrder.id,
        status: serviceOrder.status,
        totalCents: serviceOrder.priceCents ?? 0,
        createdAt: serviceOrder.createdAt,
      } : null,
      contract: contract ? {
        contractNumber: contract.contractNumber,
        serviceName: contract.serviceName,
        amountCents: contract.amountCents,
        currency: contract.currency,
        milestonesJson: contract.milestonesJson,
        status: contract.status,
        signedAt: contract.signedAt,
      } : null,
    });
  } catch (err) {
    logger.error("api.portal.access.get.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
  }
}

/**
 * POST /api/portal/access — generate a magic-link token for a client.
 * Body: { clientName, clientEmail, clientCompany?, serviceOrderId?, contractId?, expiresInDays? }
 */
export async function POST(req: NextRequest) {
  // This endpoint is owner-only (requireAuthOrResponse).
  const { requireAuthOrResponse } = await import("@/lib/auth");
  const auth = await requireAuthOrResponse("POST", "/api/portal/access");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const { clientName, clientEmail, clientCompany, serviceOrderId, contractId, expiresInDays } = body;
    if (!clientName || !clientEmail) {
      return NextResponse.json({ ok: false, error: "Missing clientName or clientEmail" }, { status: 400 });
    }
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + (expiresInDays ?? 30) * 24 * 60 * 60 * 1000);
    const access = await db.clientPortalAccess.create({
      data: {
        token,
        clientName, clientEmail,
        clientCompany: clientCompany ?? "",
        serviceOrderId: serviceOrderId ?? null,
        contractId: contractId ?? null,
        expiresAt,
      },
    });
    return NextResponse.json({
      ok: true,
      portalUrl: `/portal/${access.id}?token=${token}`,
      token,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
  }
}
