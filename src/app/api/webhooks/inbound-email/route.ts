/**
 * POST /api/webhooks/inbound-email — v73 Phase 23 (RULE-73)
 *
 * Receives inbound email replies (from Resend's inbound webhook, or from
 * the IMAP poller). Parses the reply to detect the signature phrase
 * "I AGREE TO THE TERMS" + matches it to a Contract record.
 *
 * Body: { fromEmail, subject, body, receivedAt }
 *
 * If the signature phrase is present + the contract is found + the email
 * matches → Contract.status = SIGNED → fulfillment workflow triggered.
 *
 * This endpoint is NOT behind requireAuthOrResponse — it's called by
 * the email provider's webhook (authenticated via signature verification
 * at the email-service level, not here).
 */
import { NextRequest, NextResponse } from "next/server";
import { processInboundSignatureEmail } from "@/lib/legal/contract-generator";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { fromEmail, subject, body: emailBody, receivedAt } = body;

    if (!fromEmail || !subject || !emailBody) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields: fromEmail, subject, body" },
        { status: 400 },
      );
    }

    logger.info("api.webhooks.inbound-email.received", { fromEmail, subject: subject.slice(0, 80) });

    const result = await processInboundSignatureEmail({
      fromEmail,
      subject,
      body: emailBody,
      receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
    });

    if (result.ok) {
      return NextResponse.json({
        ok: true,
        contractId: result.contractId,
        message: "Contract signed — fulfillment triggered.",
      });
    } else {
      return NextResponse.json({ ok: false, reason: result.reason }, { status: 400 });
    }
  } catch (err) {
    logger.error("api.webhooks.inbound-email.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
  }
}
