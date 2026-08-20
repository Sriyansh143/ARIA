/**
 * src/lib/multimodal-fallback.ts — v61 Phase 4 (Multimodal Sync)
 *
 * Owner's rule: "If the system is in a voice call or interactive chat and
 * needs to convey lengthy information, code, or complex data (or if the
 * user is in a noisy environment and can't hear well), it must automatically
 * (or upon request) push the detailed text to the owner's Telegram/WhatsApp.
 * The voice/chat continues, but the heavy data is handled via text."
 *
 * Trigger conditions:
 *   - AI response exceeds 300 tokens (approx 1200 chars)
 *   - Contains code blocks (``` or indented)
 *   - Contains structured data (JSON, tables, multi-line lists)
 *   - Explicitly requested by the user ("send me the details")
 *
 * The voice TTS says a short ack ("I've sent the full breakdown to your
 * Telegram. Let me know when you've reviewed it."), the session stays active,
 * and the full content is pushed via Telegram (or WhatsApp if configured).
 */

import "server-only";
import { logger } from "./logger";
import { sendTelegramMessage } from "./telegram-notifier";

export interface MultimodalPushResult {
  pushed: boolean;
  channel: "telegram" | "whatsapp" | "none";
  reason?: string;
  /** The short TTS-friendly summary the voice agent should say. */
  voiceAck?: string;
  /** The full content that was pushed to text. */
  pushedContent?: string;
}

/**
 * Check whether an AI response should trigger a multimodal fallback push.
 * Returns true if any of the trigger conditions are met.
 */
export function shouldPushToText(content: string): boolean {
  if (!content) return false;
  // 1. Exceeds 300 tokens (approx 1200 chars — 1 token ≈ 4 chars).
  if (content.length > 1200) return true;
  // 2. Contains code blocks.
  if (/```[\s\S]*?```/.test(content)) return true;
  // 3. Contains structured data (JSON arrays/objects, tables).
  if (/^\s*[\[{]/m.test(content) && /[\]}]\s*$/m.test(content)) return true;
  if (/\|.*\|.*\|/.test(content) && /---/.test(content)) return true; // markdown table
  // 4. Contains a multi-line list (> 5 bullet points).
  const bulletCount = (content.match(/^\s*[-*]\s+/gm) ?? []).length;
  if (bulletCount > 5) return true;
  return false;
}

/**
 * Push detailed content to the owner's text channel (Telegram or WhatsApp).
 *
 * @param sessionId The voice/chat session ID (for correlation).
 * @param content The full content to push.
 * @param channel Preferred channel ('telegram' | 'whatsapp').
 * @returns MultimodalPushResult with the push status + the voice ack.
 */
export async function pushDetailToText(
  sessionId: string,
  content: string,
  channel: "telegram" | "whatsapp" = "telegram",
): Promise<MultimodalPushResult> {
  // Truncate if extremely long (Telegram limit is 4096 chars).
  const truncated = content.length > 4000
    ? content.slice(0, 4000) + "\n\n...(truncated, see dashboard for full content)"
    : content;

  if (channel === "telegram") {
    try {
      const header = `📋 *Detail Push* (session ${sessionId.slice(-8)})\n\n`;
      const sent = await sendTelegramMessage(header + truncated);
      if (sent) {
        logger.info("multimodal.pushed-telegram", { sessionId, contentLength: content.length });
        return {
          pushed: true,
          channel: "telegram",
          voiceAck: "That's a bit too detailed for voice. I've just sent the full breakdown to your Telegram. Let me know when you've reviewed it.",
          pushedContent: truncated,
        };
      }
      return { pushed: false, channel: "telegram", reason: "telegram send failed" };
    } catch (err) {
      logger.warn("multimodal.telegram-failed", { sessionId, error: String(err) });
      return { pushed: false, channel: "telegram", reason: String(err) };
    }
  }

  // WhatsApp channel (via the WhatsApp Cloud API if configured).
  if (channel === "whatsapp") {
    try {
      const { sendWhatsAppMessage } = await import("./whatsapp/business");
      await sendWhatsAppMessage({
        to: process.env.OWNER_PHONE_NUMBER ?? "",
        text: `📋 Detail Push (session ${sessionId.slice(-8)})\n\n${truncated}`,
      });
      logger.info("multimodal.pushed-whatsapp", { sessionId, contentLength: content.length });
      return {
        pushed: true,
        channel: "whatsapp",
        voiceAck: "I've sent the full breakdown to your WhatsApp. Let me know when you've reviewed it.",
        pushedContent: truncated,
      };
    } catch (err) {
      logger.warn("multimodal.whatsapp-failed", { sessionId, error: String(err) });
      // Fallback to Telegram.
      return pushDetailToText(sessionId, content, "telegram");
    }
  }

  return { pushed: false, channel: "none", reason: "no channel configured" };
}

/**
 * Generate a short voice-friendly summary of a long response.
 * Used as the TTS fallback when the full content is pushed to text.
 */
export function generateVoiceSummary(content: string): string {
  // Take the first sentence or two.
  const firstSentence = content.match(/^([^.!?]*[.!?])/)?.[1] ?? content.slice(0, 150);
  return firstSentence.trim() + " I've sent the full details to your Telegram.";
}
