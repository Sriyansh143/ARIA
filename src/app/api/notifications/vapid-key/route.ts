import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/notifications/vapid-key — returns the VAPID public key for the browser
 * to use when subscribing to push notifications.
 *
 * Auth required (the owner is the only one who should subscribe to push).
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    if (!publicKey) {
      return NextResponse.json(
        { configured: false, error: "VAPID_PUBLIC_KEY not set. Generate with: npx web-push generate-vapid-keys" },
        { status: 200 },
      );
    }
    return NextResponse.json({ configured: true, publicKey });
  } catch (err) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
