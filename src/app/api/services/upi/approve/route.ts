import { NextRequest, NextResponse } from "next/server";
import { approveUpiOrder, rejectUpiOrder } from "@/lib/upi-payments";
import { requireAuthOrResponse } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/services/upi/approve — owner-only.
 * Body: { orderId } | { orderId, action: "reject", reason: "..." }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthOrResponse("POST", "/api/services/upi/approve");
    if (auth) return auth;

    const body = await req.json().catch(() => ({}));
    if (!body.orderId || typeof body.orderId !== "string") {
      return NextResponse.json({ error: "orderId required" }, { status: 400 });
    }

    if (body.action === "reject") {
      const reason = typeof body.reason === "string" ? body.reason : "Owner did not provide a reason";
      const result = await rejectUpiOrder(body.orderId, reason);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true, action: "rejected" });
    }

    const result = await approveUpiOrder(body.orderId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, action: "approved" });
  } catch (err) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
