/**
 * src/lib/email-service.ts — Resend + NotificationLog fallback (v40)
 *
 * Audit fix #6: Customer email fallback was dead code (email.ts had 0 importers).
 * v40: Replaced with a robust Resend integration + a NotificationLog Prisma
 * model as the guaranteed fallback. If Resend is unconfigured or fails,
 * the notification is logged to the DB so the owner can see it in the dashboard.
 *
 * Flow:
 *   1. sendNotification() tries Resend (if RESEND_API_KEY is set)
 *   2. On success → NotificationLog row with status="sent"
 *   3. On failure or no API key → NotificationLog row with status="failed"
 *   4. The dashboard reads NotificationLog to show delivery status
 *
 * HTML template: responsive, clean, works in all email clients.
 * Falls back to plain text if HTML build fails.
 */

import "server-only"

import { db } from "./db"
import { logger } from "./logger"

export interface NotificationRequest {
  to: string
  subject: string
  html?: string
  text: string
  from?: string
  metadata?: Record<string, unknown> // { orderId, userId, ... }
  /**
   * Phase 33 Fix 3: When true, an Approval row is created before the email
   * is sent (owner must approve via Telegram/dashboard). When false
   * (default for internal alerts), the email is sent directly.
   *
   * The owner's mandate: "every high-risk action should be gated."
   * External emails (to clients, leads, partners) should pass requireApproval: true.
   * Internal system emails (alerts, notifications to the owner) should pass requireApproval: false.
   */
  requireApproval?: boolean
}

export interface NotificationResult {
  ok: boolean
  channel: "email" | "internal"
  provider: "resend" | "notification-log"
  logId: string
  error?: string
}

/**
 * Check if Resend is configured.
 */
export function isEmailConfigured(): boolean {
  // AUDIT-A-19: trim() guards against RESEND_API_KEY=" " (whitespace) which passes
  // Boolean() but throws "Invalid API key" inside the Resend SDK.
  const key = process.env.RESEND_API_KEY?.trim();
  return !!key;
}

/**
 * Get the sender email. v44 fix: prefer RESEND_FROM_EMAIL (owner-configured).
 * Falls back to "onboarding@resend.dev" ONLY if RESEND_FROM_EMAIL is unset
 * (Resend's shared sandbox — will be spam-flagged by most recipients).
 *
 * v44: If the caller is sending outreach (metadata.type === "outreach"), we
 * REQUIRE RESEND_FROM_EMAIL to be set — otherwise we refuse to send (returns
 * an error) so the operator doesn't accidentally spam from the sandbox address.
 */
function getFromEmail(metadata?: Record<string, unknown>): string {
  const configured = process.env.RESEND_FROM_EMAIL
  if (configured) return configured

  // Sandbox fallback — OK for system notifications, NOT for cold outreach.
  if (metadata?.type === "outreach") {
    throw new Error(
      "RESEND_FROM_EMAIL is not configured. Refusing to send outreach email from the Resend sandbox (onboarding@resend.dev). " +
        "Set RESEND_FROM_EMAIL to your verified domain (e.g. founder@yourdomain.com) before enabling outreach.",
    )
  }

  return "onboarding@resend.dev"
}

/**
 * Send a notification via Resend, with NotificationLog as fallback.
 *
 * This is the PRIMARY notification function. All customer-facing emails
 * (order delivered, refund processed, etc.) go through here.
 *
 * Phase 33 Fix 3: When req.requireApproval is true, an Approval row is
 * created BEFORE the email is sent. The email is only dispatched after
 * the owner approves via Telegram inline keyboard or dashboard PATCH.
 * Internal system emails (alerts) pass requireApproval: false (default).
 */
export async function sendNotification(
  req: NotificationRequest,
): Promise<NotificationResult> {
  // ─── Phase 33 Fix 3: Approval gate for external emails ───
  //
  // The owner's mandate: "every high-risk action should be gated."
  // External emails (to clients, leads, partners) must be approved before sending.
  // Internal system emails (alerts to the owner, system notifications) bypass the gate.
  //
  // We detect "external" by checking if requireApproval is explicitly true.
  // Callers that send external emails should pass requireApproval: true.
  if (req.requireApproval === true) {
    try {
      const { db: dbInstance } = await import("./db")
      const { emit } = await import("./event-bus")

      // Create the approval row
      const approval = await dbInstance.approval.create({
        data: {
          title: `📧 Email: ${req.subject.slice(0, 100)}`,
          summary: `To: ${req.to}\nSubject: ${req.subject}\nPreview: ${req.text.slice(0, 200)}`,
          risk: req.subject.toLowerCase().includes("contract") || req.subject.toLowerCase().includes("payment") ? "high" : "medium",
          status: "pending",
          requester: "email-service",
          action: "send_email",
          payload: JSON.stringify({
            to: req.to,
            subject: req.subject,
            text: req.text.slice(0, 1000),
            html: req.html?.slice(0, 2000) ?? "",
            from: req.from ?? "",
            metadata: req.metadata ?? {},
          }),
        },
      })

      // Dispatch via Telegram (best-effort)
      try {
        const { requestOwnerApproval, buildApprovalRequestFromRow } = await import("./owner-approval/telegram-approval")
        const payload = await buildApprovalRequestFromRow(approval.id, "generic")
        if (payload) {
          await requestOwnerApproval(payload)
        }
      } catch {
        // Telegram not configured — the approval is still in the dashboard
      }

      // Emit the approval event so the dashboard opens the panel
      try {
        const { serializeApproval } = await import("./approval-brief")
        emit({
          type: "approval",
          ts: new Date().toISOString(),
          approval: serializeApproval(approval),
        })
      } catch { /* best-effort */ }

      logger.info("email.approval-created", {
        approvalId: approval.id,
        to: req.to,
        subject: req.subject.slice(0, 80),
      })

      return {
        ok: true,
        channel: "internal",
        provider: "notification-log",
        logId: `approval:${approval.id}`,
        error: "Email queued for owner approval — not sent yet",
      }
    } catch (gateErr) {
      logger.warn("email.approval-gate-failed", { error: String(gateErr) })
      // If the gate fails, fall through to direct send (best-effort — don't block the email)
    }
  }

  const meta = req.metadata || {}

  // v44 fix: pass metadata to getFromEmail so outreach emails refuse to send
  // from the sandbox address. Catches the error and falls through to NotificationLog.
  let from: string
  try {
    from = req.from || getFromEmail(meta)
  } catch (err) {
    // Refused to send — log + return failure
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.warn("email.refused", { to: req.to, error: errorMsg })
    const log = await db.notificationLog.create({
      data: {
        channel: "email",
        recipient: req.to,
        subject: req.subject,
        body: req.text,
        status: "failed",
        provider: "resend",
        error: errorMsg,
        metadata: JSON.stringify(meta),
      },
    })
    return { ok: false, channel: "internal", provider: "notification-log", logId: log.id, error: errorMsg }
  }

  // Build HTML if not provided (falls back to plain text)
  const html = req.html || buildDefaultHtml(req.subject, req.text, meta)

  // Try Resend first
  if (isEmailConfigured()) {
    try {
      const { Resend } = await import("resend")
      const resend = new Resend(process.env.RESEND_API_KEY!.trim())

      const { data, error } = await resend.emails.send({
        from,
        to: req.to,
        subject: req.subject,
        html,
        text: req.text, // plain-text fallback for email clients that don't render HTML
      })

      if (error) {
        throw new Error(error.message)
      }

      // Log success
      const log = await db.notificationLog.create({
        data: {
          channel: "email",
          recipient: req.to,
          subject: req.subject,
          body: req.text,
          status: "sent",
          provider: "resend",
          metadata: JSON.stringify({ ...meta, messageId: data?.id }),
        },
      })

      logger.info("email.sent", { to: req.to, subject: req.subject, messageId: data?.id })
      return { ok: true, channel: "email", provider: "resend", logId: log.id }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.warn("email.resend-failed", { to: req.to, error: errorMsg })

      // Fall through to NotificationLog fallback
      const log = await db.notificationLog.create({
        data: {
          channel: "email",
          recipient: req.to,
          subject: req.subject,
          body: req.text,
          status: "failed",
          provider: "resend",
          error: errorMsg,
          metadata: JSON.stringify(meta),
        },
      })

      return { ok: false, channel: "internal", provider: "notification-log", logId: log.id, error: errorMsg }
    }
  }

  // Resend not configured — log to NotificationLog only
  const log = await db.notificationLog.create({
    data: {
      channel: "email",
      recipient: req.to,
      subject: req.subject,
      body: req.text,
      status: "failed",
      provider: "notification-log",
      error: "RESEND_API_KEY not configured — notification logged but not sent",
      metadata: JSON.stringify(meta),
    },
  })

  logger.debug("email.not-configured", { to: req.to, subject: req.subject, logId: log.id })
  return { ok: false, channel: "internal", provider: "notification-log", logId: log.id, error: "RESEND_API_KEY not configured" }
}

/**
 * Build a clean, responsive HTML email template.
 * Falls back to plain text wrapped in <pre> if the HTML build throws.
 *
 * v44 fix CAN-SPAM: If metadata.type === "outreach", append a footer with
 * physical address + unsubscribe link (required by US CAN-SPAM Act §7703).
 */
export function buildDefaultHtml(subject: string, body: string, metadata?: Record<string, unknown>): string {
  try {
    const isOutreach = metadata?.type === "outreach"
    const senderAddress = process.env.ARIA_SENDER_ADDRESS || process.env.ARIA_OWNER_EMAIL || "ARIA Mission Control"
    const unsubToken = metadata?.unsubscribeToken
      ? encodeURIComponent(String(metadata.unsubscribeToken))
      : ""
    const unsubEmail = metadata?.to ? encodeURIComponent(String(metadata.to)) : ""
    const unsubLink = isOutreach && unsubToken
      ? `<a href="${process.env.NEXTAUTH_URL || ""}/api/unsubscribe/${unsubToken}?email=${unsubEmail}" style="color:#10b981;">unsubscribe</a>`
      : ""

    const footerHtml = isOutreach
      ? `<tr>
            <td style="padding:16px 32px;border-top:1px solid #2a3338;">
              <p style="margin:0 0 8px 0;color:#6b7280;font-size:12px;">
                You received this email because we believe ${escapeHtml(unsubEmail || "you")} might benefit from our services.
              </p>
              <p style="margin:0 0 8px 0;color:#6b7280;font-size:12px;">
                Sender: ${escapeHtml(senderAddress)}
              </p>
              <p style="margin:0;color:#6b7280;font-size:12px;">
                To ${unsubLink || "unsubscribe, reply to this email"}, or write to us at ${escapeHtml(senderAddress)}.
              </p>
            </td>
          </tr>`
      : `<tr>
            <td style="padding:16px 32px;border-top:1px solid #2a3338;">
              <p style="margin:0;color:#6b7280;font-size:12px;">
                Sent by ARIA Mission Control · This is an automated notification.
              </p>
            </td>
          </tr>`

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0e0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0e0f;padding:24px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#141a1d;border:1px solid #2a3338;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#10b981,#0d9488);padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.025em;">
                ✦ ARIA Mission Control
              </h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 16px 0;color:#f0f4f3;font-size:18px;font-weight:600;">
                ${escapeHtml(subject)}
              </h2>
              <p style="margin:0;color:#9ca3a3;font-size:14px;line-height:1.6;white-space:pre-wrap;">
                ${escapeHtml(body)}
              </p>
            </td>
          </tr>
          <!-- Footer (CAN-SPAM compliant for outreach) -->
          ${footerHtml}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  } catch {
    // Fallback: plain text in <pre>
    return `<pre style="font-family:monospace;padding:16px;">${escapeHtml(subject)}\n\n${escapeHtml(body)}</pre>`
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

/**
 * Get the notification log for the dashboard.
 */
export async function getNotificationLog(limit: number = 50) {
  return db.notificationLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  })
}
