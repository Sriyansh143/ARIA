/**
 * POST /api/telegram/webhook — Inbound Telegram update handler (v58 Phase 2)
 *
 * Telegram sends POST requests to this URL whenever someone messages the bot.
 * We parse the update + dispatch to the appropriate command handler.
 *
 * URL verification: when registering the webhook via Telegram's setWebhook
 * API, you can pass a secret token in the URL. We verify it against
 * TELEGRAM_VERIFY_TOKEN (if set) for extra security.
 *
 * Registration (run once after deployment):
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-domain.com/api/telegram/webhook?token=<VERIFY_TOKEN>"
 */
import { NextRequest, NextResponse } from "next/server";
import { handleTelegramUpdate, type TelegramUpdate } from "@/lib/telegram-bot";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // Optional: verify the secret token in the query string
    const verifyToken = process.env.TELEGRAM_VERIFY_TOKEN;
    if (verifyToken) {
      const providedToken = req.nextUrl.searchParams.get("token");
      if (providedToken !== verifyToken) {
        logger.warn("api.telegram.webhook.unauthorized", { reason: "invalid token" });
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
    }

    const update = (await req.json()) as TelegramUpdate;
    await handleTelegramUpdate(update);

    // Always return 200 so Telegram doesn't retry
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("api.telegram.webhook.failed", { error: String(err) });
    // Still return 200 — Telegram retries on 5xx, which can flood the bot
    return NextResponse.json({ ok: true, error: "internal_error" });
  }
}

/**
 * GET /api/telegram/webhook — Returns the webhook status (for debugging).
 */
export async function GET() {
  return NextResponse.json({
    configured: !!process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID || null,
    verifyTokenRequired: !!process.env.TELEGRAM_VERIFY_TOKEN,
    commands: ["/status", "/pause", "/resume", "/health", "/help"],
  });
}
