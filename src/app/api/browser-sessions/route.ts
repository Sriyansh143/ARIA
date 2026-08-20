/**
 * /api/browser-sessions — v73 Phase 23 (extension of RULE-70)
 *
 * GET  — list connected browser sessions (Instagram/LinkedIn/Gmail/etc.).
 * POST — connect a new platform account (store creds in Credential Vault).
 *       Owner provides creds via Telegram DM; this endpoint is the programmatic
 *       counterpart for the Telegram bot.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrResponse } from "@/lib/auth";
import { connectPlatformAccount, type Platform, type PlatformCredentials } from "@/lib/computer-use-accounts";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuthOrResponse("GET", "/api/browser-sessions");
  if (auth instanceof NextResponse) return auth;
  try {
    const sessions = await db.browserSession.findMany({ orderBy: { platform: "asc" } });
    return NextResponse.json({ ok: true, sessions });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthOrResponse("POST", "/api/browser-sessions");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const { platform, credentials } = body as { platform: Platform; credentials: PlatformCredentials };
    if (!platform || !credentials?.email || !credentials?.password) {
      return NextResponse.json({ ok: false, error: "Missing platform or credentials (email + password required)" }, { status: 400 });
    }
    const result = await connectPlatformAccount(platform, credentials);
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.browser-sessions.connect.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
  }
}
