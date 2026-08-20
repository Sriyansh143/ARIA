/**
 * ARIA Mission Control — Telegram Notification Service.
 *
 * Sends real Telegram messages to the configured chat when critical
 * events occur (alerts, approvals, revenue milestones). Uses the
 * TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from .env.
 *
 * Verified working: bot "Jarvisliafon_bot" (ID: 8864894634).
 *
 * NOTE: env vars are read dynamically (not cached at module load) so
 * the env-loader hot-reload (every 5s) picks up key changes immediately.
 */
import { logger } from "./logger";

/**
 * Read the Telegram bot token from env (hot-reloaded by env-loader).
 */
function getBotToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN;
}

/**
 * Read the Telegram chat ID from env (hot-reloaded by env-loader).
 */
function getChatId(): string | undefined {
  return process.env.TELEGRAM_CHAT_ID;
}

/**
 * Get the base URL for the Telegram Bot API.
 */
function getBaseUrl(): string {
  return `https://api.telegram.org/bot${getBotToken()}`;
}

export function isTelegramConfigured(): boolean {
  return !!getBotToken() && !!getChatId();
}

/**
 * Send a text message to the configured Telegram chat.
 * Returns true on success, false on failure.
 */
export async function sendTelegramMessage(text: string): Promise<boolean> {
  if (!isTelegramConfigured()) return false;

  const chatId = getChatId()!;
  try {
    // v77 Phase 27 Fix 5: Try Markdown first, fall back to plain text on parse error.
    // The user's logs showed "can't parse entities at byte offset 2127" — Telegram's
    // Markdown parser is strict + fails on nested/unmatched formatting characters.
    const res = await fetch(`${getBaseUrl()}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const data = await res.json();
    if (!data.ok) {
      // v77 Fix 5: If Markdown parsing fails, retry as plain text (no parse_mode).
      if (data.description?.includes("parse") || data.description?.includes("entities")) {
        logger.warn("telegram.markdown-failed-trying-plain", { error: data.description });
        const plainRes = await fetch(`${getBaseUrl()}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: text.replace(/\*/g, "").replace(/_/g, "").replace(/`/g, "").replace(/\[/g, "").replace(/\]/g, ""),
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        const plainData = await plainRes.json();
        if (!plainData.ok) {
          logger.error("telegram.send-failed-plain", { error: plainData.description });
          return false;
        }
        return true;
      }
      logger.error("telegram.send-failed", { error: data.description });
      return false;
    }
    return true;
  } catch (err) {
    logger.error("telegram.network-error", { error: String(err) });
    return false;
  }
}

/**
 * Send an alert notification to Telegram.
 * Used by the alert notification hook when critical/error alerts fire.
 */
export async function sendAlertNotification(
  severity: string,
  source: string,
  message: string
): Promise<boolean> {
  const icon = severity === "critical" ? "🔴" : severity === "error" ? "🟠" : severity === "warn" ? "🟡" : "🔵";
  const text = `${icon} *ARIA Alert: ${severity.toUpperCase()}*\n\n*Source:* ${source}\n*Message:* ${message}\n\n_Time: ${new Date().toISOString()}_`;
  return sendTelegramMessage(text);
}

/**
 * Send an approval notification to Telegram.
 * Used when a new approval is created.
 */
export async function sendApprovalNotification(
  title: string,
  risk: string,
  amount: number | null
): Promise<boolean> {
  const amountStr = amount ? `\n*Amount:* $${amount.toLocaleString()}` : "";
  const text = `⏳ *ARIA Approval Required*\n\n*Title:* ${title}\n*Risk:* ${risk.toUpperCase()}${amountStr}\n\n_Respond in the dashboard to approve or deny._`;
  return sendTelegramMessage(text);
}

/**
 * Send a revenue milestone notification to Telegram.
 * Used when a deal is won or a significant revenue event occurs.
 */
export async function sendRevenueNotification(
  amount: number,
  source: string,
  description: string
): Promise<boolean> {
  const text = `💰 *ARIA Revenue Event*\n\n*Amount:* $${amount.toLocaleString()}\n*Source:* ${source}\n*Description:* ${description}\n\n_Total revenue updated in dashboard._`;
  return sendTelegramMessage(text);
}

/**
 * v69 Phase 19 BLOCKER 7: Send a photo (base64-encoded) to Telegram.
 * Used to push the WhatsApp QR code PNG to the owner's chat so they can
 * scan it from their phone directly, without SSH'ing to the server.
 *
 * @param base64Photo Base64-encoded image bytes (no data: prefix).
 * @param caption Optional caption to send with the photo.
 * @returns true on success, false on failure.
 */
export async function sendTelegramPhoto(
  base64Photo: string,
  caption: string = "",
): Promise<boolean> {
  if (!isTelegramConfigured()) return false;

  const chatId = getChatId()!;
  try {
    // Telegram's sendPhoto endpoint expects multipart/form-data.
    const buffer = Buffer.from(base64Photo, "base64");
    const formData = new FormData();
    formData.append("chat_id", chatId);
    formData.append("photo", new Blob([buffer], { type: "image/png" }), "qr-code.png");
    if (caption) formData.append("caption", caption);

    const res = await fetch(`${getBaseUrl()}/sendPhoto`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json();
    if (!data.ok) {
      logger.error("telegram.send-photo-failed", { error: data.description });
      return false;
    }
    return true;
  } catch (err) {
    logger.error("telegram.send-photo-network-error", { error: String(err) });
    return false;
  }
}
