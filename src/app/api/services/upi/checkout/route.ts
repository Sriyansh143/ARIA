import { NextRequest, NextResponse } from "next/server";
import { createUpiOrder } from "@/lib/upi-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/services/upi/checkout — create a UPI payment order.
 * Body: { serviceId, spec, customerEmail, customerName? }
 * Returns: { ok, orderId, amountInr, vpa, qrImageB64 }
 *
 * Public (customer-facing checkout). Rate-limited per-IP by the proxy.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    if (!body.serviceId || typeof body.serviceId !== "string") {
      return NextResponse.json({ error: "serviceId required" }, { status: 400 });
    }
    if (!body.spec || typeof body.spec !== "string" || body.spec.length < 10 || body.spec.length > 5000) {
      return NextResponse.json({ error: "spec must be 10-5000 chars" }, { status: 400 });
    }
    if (!body.customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.customerEmail)) {
      return NextResponse.json({ error: "valid customerEmail required" }, { status: 400 });
    }

    const result = await createUpiOrder({
      serviceId: body.serviceId,
      spec: body.spec,
      customerEmail: body.customerEmail,
      customerName: typeof body.customerName === "string" ? body.customerName : undefined,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      orderId: result.orderId,
      amountInr: result.amountInr,
      vpa: result.vpa,
      qrImageB64: result.qrImageB64,
    });
  } catch (err) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
