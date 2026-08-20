import { NextRequest, NextResponse } from "next/server";
import { getPendingUpiVerifications } from "@/lib/upi-payments";
import { requireAuthOrResponse } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/services/upi/pending — owner-only. List UPI orders pending verification.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthOrResponse("GET", "/api/services/upi/pending");
    if (auth) return auth;

    const orders = await getPendingUpiVerifications(50);
    return NextResponse.json({ orders, count: orders.length });
  } catch (err) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
