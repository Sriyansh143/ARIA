import { NextRequest, NextResponse } from "next/server";
import { getUpiSettings, saveUpiSettings } from "@/lib/upi-payments";
import { requireAuthOrResponse } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/settings/upi — public (used by checkout page to show UPI option if configured)
 * Returns only whether UPI is configured + VPA + display name. Never returns QR image to anonymous callers.
 */
export async function GET(req: NextRequest) {
  try {
    const settings = await getUpiSettings();
    // Public response — no QR image (only the checkout flow returns QR after order creation)
    return NextResponse.json({
      configured: settings.isConfigured,
      vpa: settings.vpa,
      displayName: settings.displayName,
    });
  } catch (err) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/**
 * POST /api/settings/upi — owner-only. Updates VPA / displayName / QR.
 * Body: { vpa?, displayName?, qrImageB64? }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthOrResponse("POST", "/api/settings/upi");
    if (auth) return auth;

    const body = await req.json().catch(() => ({}));
    const result = await saveUpiSettings({
      vpa: body.vpa,
      displayName: body.displayName,
      qrImageB64: body.qrImageB64,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
