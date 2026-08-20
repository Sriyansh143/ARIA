/**
 * GET /api/free-offers — v72 Phase 22 (RULE-70)
 *
 * Returns the status of the "first 100 customers free" offer.
 * Also returns the offer text to use in outreach + the list of recent redemptions.
 *
 * POST /api/free-offers — redeem a free offer (called by WhatsApp/email auto-responder
 * when a customer replies "FREE LANDING PAGE" or similar).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrResponse } from "@/lib/auth";
import { getOfferStatus, redeemFreeOffer, generateOfferText, ELIGIBLE_FREE_SERVICES, FREE_OFFER_CAP } from "@/lib/lead-hunter/free-offer-engine";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuthOrResponse("GET", "/api/free-offers");
  if (auth instanceof NextResponse) return auth;

  try {
    const status = await getOfferStatus();
    const { db } = await import("@/lib/db");
    const recent = await db.freeOfferRedemption.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return NextResponse.json({
      ok: true,
      status,
      eligibleServices: ELIGIBLE_FREE_SERVICES,
      cap: FREE_OFFER_CAP,
      offerText: generateOfferText(),
      recentRedemptions: recent,
    });
  } catch (err) {
    logger.error("api.free-offers.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Note: this endpoint is intentionally NOT behind requireAuthOrResponse —
  // customers redeem via WhatsApp/email auto-responder, so they're not authenticated
  // as the owner. The endpoint is rate-limited via the existing rate-limiter middleware.
  try {
    const body = await req.json().catch(() => ({}));
    const { customerName, customerEmail, customerPhone, customerCompany, serviceName, redemptionChannel } = body;

    if (!customerName || !serviceName) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields: customerName, serviceName" },
        { status: 400 },
      );
    }

    const result = await redeemFreeOffer({
      customerName,
      customerEmail: customerEmail ?? null,
      customerPhone: customerPhone ?? null,
      customerCompany: customerCompany ?? "",
      serviceName,
      redemptionChannel: redemptionChannel ?? "web-form",
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    logger.error("api.free-offers.redeem.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
  }
}
