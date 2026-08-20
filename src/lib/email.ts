/**
 * src/lib/email.ts — Embedded Email Service
 *
 * PROBLEM: External email services (SendGrid, Mailgun, etc.) require
 * API keys and paid accounts.
 *
 * SOLUTION: Use nodemailer (Node.js native SMTP client) with the user's
 * existing Gmail/SMTP credentials. If SMTP credentials aren't configured,
 * emails are logged to the AgentLog table (audit trail) instead of being
 * sent — the app never crashes, it gracefully degrades.
 *
 * For IMAP (reading emails), we use imapflow (lazy-loaded so it doesn't
 * affect bundle size if not used).
 *
 * Multi-language support: email body can be in any language. The Linguist
 * agent can translate content before sending.
 */

import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";

export interface EmailRequest {
  to: string;
  subject: string;
  body: string;
  from?: string;
  isHtml?: boolean;
  replyTo?: string;
}

export interface EmailResult {
  ok: boolean;
  provider: "smtp" | "log";
  messageId?: string;
  error?: string;
}

/**
 * Check if SMTP is configured (env vars present).
 * Reads dynamically (hot-reloaded by env-loader).
 */
export function isSMTPConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * Send an email via SMTP (nodemailer).
 *
 * If SMTP credentials aren't configured, falls back to logging the email
 * to the AgentLog table (so there's an audit trail) + returns ok=true
 * with provider="log". This ensures the app never crashes when email
 * isn't configured, but the operator can see what WOULD have been sent.
 *
 * Multi-language: the body can be in any language (UTF-8). Subject and
 * body should be in the recipient's language.
 */
export async function sendEmail(req: EmailRequest): Promise<EmailResult> {
  // If SMTP isn't configured, log the email instead
  if (!isSMTPConfigured()) {
    logger.info("email.log-mode", { to: req.to, subject: req.subject });
    try {
      await db.agentLog.create({
        data: {
          agentId: null,
          level: "info",
          message: `[EMAIL] To: ${req.to} | Subject: ${req.subject}`,
          meta: JSON.stringify({ to: req.to, subject: req.subject, body: req.body.slice(0, 1000) }),
        },
      });
    } catch {
      // Even logging failed — nothing more we can do
    }
    return {
      ok: true,
      provider: "log",
      messageId: `log-${Date.now()}`,
    };
  }

  try {
    // Lazy-load nodemailer (only when SMTP is configured + email is sent)
    // This keeps the bundle small when email isn't used.
    const nodemailer = await import("nodemailer").catch(() => null);

    if (!nodemailer) {
      // nodemailer not installed — fall back to log mode
      logger.warn("email.nodemailer-not-installed", { to: req.to });
      return {
        ok: true,
        provider: "log",
        messageId: `log-${Date.now()}`,
      };
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const info = await transporter.sendMail({
      from: req.from || process.env.SMTP_FROM || process.env.SMTP_USER,
      to: req.to,
      subject: req.subject,
      [req.isHtml ? "html" : "text"]: req.body,
      replyTo: req.replyTo,
    });

    logger.info("email.sent", { to: req.to, subject: req.subject, messageId: info.messageId });

    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: `Email sent to ${req.to}: ${req.subject}`,
      level: "success",
    });

    return {
      ok: true,
      provider: "smtp",
      messageId: info.messageId,
    };
  } catch (err) {
    logger.error("email.send.failed", { to: req.to, error: String(err) });
    return {
      ok: false,
      provider: "smtp",
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

/**
 * Get email status (for the API endpoint).
 */
export function getEmailStatus(): {
  smtpConfigured: boolean;
  host: string | null;
  from: string | null;
  secure: boolean;
} {
  return {
    smtpConfigured: isSMTPConfigured(),
    host: process.env.SMTP_HOST || null,
    from: process.env.SMTP_FROM || process.env.SMTP_USER || null,
    secure: process.env.SMTP_SECURE === "true",
  };
}
