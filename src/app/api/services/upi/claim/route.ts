import { NextRequest, NextResponse } from "next/server";
import { claimUpiPayment } from "@/lib/upi-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/services/upi/claim — customer clicked "I've Paid"
 * Body: { orderId, utr }
 *
 * Public (customer-facing). Records the UTR + notifies owner.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    if (!body.orderId || typeof body.orderId !== "string") {
      return NextResponse.json({ error: "orderId required" }, { status: 400 });
    }
    if (!body.utr || typeof body.utr !== "string") {
      return NextResponse.json({ error: "utr required" }, { status: 400 });
    }

    const result = await claimUpiPayment(body.orderId, body.utr);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
