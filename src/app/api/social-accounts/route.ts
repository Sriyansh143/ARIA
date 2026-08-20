/**
 * /api/social-accounts — v72 Phase 22 (RULE-70)
 *
 * GET  — list connected ARIA social media accounts.
 * POST — connect a new account (stores OAuth creds in Credential Vault).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrResponse } from "@/lib/auth";
import { connectSocialAccount, listConnectedAccounts } from "@/lib/social-media-manager";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuthOrResponse("GET", "/api/social-accounts");
  if (auth instanceof NextResponse) return auth;
  try {
    const accounts = await listConnectedAccounts();
    return NextResponse.json({ ok: true, accounts });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthOrResponse("POST", "/api/social-accounts");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const { platform, handle, accessToken, bio } = body;
    if (!platform || !handle || !accessToken) {
      return NextResponse.json({ ok: false, error: "Missing platform, handle, or accessToken" }, { status: 400 });
    }
    const result = await connectSocialAccount(platform, handle, accessToken, bio);
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.social-accounts.connect.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
  }
}
