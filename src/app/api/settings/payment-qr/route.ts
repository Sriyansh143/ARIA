import { NextRequest, NextResponse } from "next/server";
import { getUpiSettings } from "@/lib/upi-payments";
import { requireAuthOrResponse } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/settings/payment-qr — owner-only. Returns the QR image as binary
 * (used by the settings panel to preview the uploaded QR).
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthOrResponse("GET", "/api/settings/payment-qr");
    if (auth) return auth;

    const settings = await getUpiSettings();
    if (!settings.qrImageB64) {
      return NextResponse.json({ error: "no_qr_uploaded" }, { status: 404 });
    }

    const mime = settings.qrMimeType || "image/png";
    const buffer = Buffer.from(settings.qrImageB64, "base64");

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
