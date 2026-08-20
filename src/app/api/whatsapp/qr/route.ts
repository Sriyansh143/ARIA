/**
 * GET /api/whatsapp/qr — v69 Phase 19 (BLOCKER 7)
 *
 * Returns the current WhatsApp QR code string (or null if no QR has been
 * generated yet). The dashboard polls this endpoint and renders the QR
 * as either a data-URL image (via the `qrcode` npm package on the client)
 * or a raw ASCII-art block.
 *
 * Response shape:
 *   - When a QR is available: { ok: true, qr: "<string>", generatedAt: "..." }
 *   - When no QR is available: { ok: true, qr: null, hint: "..." }
 *
 * Security: this endpoint is owner-only (requireAuthOrResponse). The QR
 * string grants full WhatsApp session access — it MUST NOT be exposed to
 * unauthenticated callers.
 */
import { NextResponse } from "next/server";
import { requireAuthOrResponse } from "@/lib/auth";
import { lastQRString } from "@/lib/whatsapp/business";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuthOrResponse("GET", "/api/whatsapp/qr");
  if (auth instanceof NextResponse) return auth;

  try {
    if (!lastQRString) {
      return NextResponse.json({
        ok: true,
        qr: null,
        hint: "No QR available. Trigger a new Baileys connection by attempting to send a message or restarting the server.",
      });
    }
    return NextResponse.json({
      ok: true,
      qr: lastQRString,
      generatedAt: new Date().toISOString(),
      scanInstructions: "WhatsApp → Settings → Linked Devices → Link a Device → scan this QR",
    });
  } catch (err) {
    logger.error("api.whatsapp.qr.failed", { error: String(err) });
    return NextResponse.json(
      { ok: false, error: "Failed to fetch QR" },
      { status: 500 },
    );
  }
}
