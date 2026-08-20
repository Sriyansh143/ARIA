/**
 * POST /api/webhooks/esign — Inbound e-signature webhook handler (Phase 30)
 *
 * Receives webhook events from DocuSign / HelloSign / mock providers when
 * an envelope is sent, delivered, completed, declined, or voided.
 *
 * AUTHENTICATION
 * ---------------
 * Each provider has its own signature scheme:
 *   - DocuSign: HMAC-SHA256 in `X-DocuSign-Signature-1` header, verified
 *     against DOCUSIGN_CONNECT_SECRET.
 *   - HelloSign: HMAC-SHA256 in `X-HelloSign-Signature` header, verified
 *     against HELLOSIGN_API_KEY.
 *   - Mock: no signature (for tests only).
 *
 * The route reads the raw body (not JSON-parsed) because the HMAC is
 * computed over the raw bytes. We then delegate to the provider's
 * `verifyWebhook()` + `parseWebhookEvent()` + `handleEsignWebhook()`.
 *
 * IDEMPOTENCY
 * -----------
 * Providers retry on 5xx. We dedupe by (provider, envelopeId, eventType,
 * eventTimestamp) in the EsignEvent table. Duplicates are acknowledged
 * with 200 (so the provider stops retrying) but not re-processed.
 *
 * SECURITY
 * --------
 * - The webhook URL itself is unauthenticated (providers can't add auth
 *   headers). We rely on signature verification.
 * - For extra safety, an optional `?token=` query parameter can be set
 *   that must match `ESIGN_WEBHOOK_TOKEN` (if configured).
 */
import { NextRequest, NextResponse } from "next/server";
import { getEsignProvider, handleEsignWebhook, type EsignProvider } from "@/lib/legal/esign-provider";
import { recordAudit } from "@/lib/audit-log";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // Optional: verify the secret token in the query string (extra safety layer).
    const expectedToken = process.env.ESIGN_WEBHOOK_TOKEN;
    if (expectedToken) {
      const providedToken = req.nextUrl.searchParams.get("token");
      if (providedToken !== expectedToken) {
        logger.warn("api.webhooks.esign.unauthorized", { reason: "invalid token" });
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
    }

    // Get the raw body as text — the HMAC must be computed over the raw bytes.
    const rawBody = await req.text();
    if (!rawBody) {
      return NextResponse.json({ error: "empty body" }, { status: 400 });
    }

    // Convert Headers to a plain object for the provider's verifyWebhook().
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // Detect which provider sent this webhook.
    // HelloSign sends `X-HelloSign-Signature`, DocuSign sends `X-DocuSign-Signature-1`.
    // The mock provider has no signature header (used in tests only).
    const providerName =
      headers["x-hellosign-signature"] ? "hellosign" :
      headers["x-docusign-signature-1"] ? "docusign" :
      process.env.ESIGN_PROVIDER ?? "mock";

    // Get the active provider instance.
    const provider: EsignProvider | null = getEsignProvider();
    if (!provider) {
      logger.warn("api.webhooks.esign.no-provider", { providerName });
      return NextResponse.json({ error: "no e-sign provider configured" }, { status: 503 });
    }

    if (provider.name !== providerName && providerName !== "mock") {
      logger.warn("api.webhooks.esign.provider-mismatch", {
        configured: provider.name,
        received: providerName,
      });
      return NextResponse.json({ error: "provider mismatch" }, { status: 400 });
    }

    // 1. Verify the webhook signature.
    const verification = provider.verifyWebhook(headers, rawBody);
    if (!verification.valid) {
      logger.error("api.webhooks.esign.invalid-signature", {
        provider: provider.name,
        error: verification.error,
      });
      // Record the failed verification in the audit log for forensics.
      await recordAudit({
        actor: `esign-webhook:${provider.name}`,
        actorRole: "system",
        action: "verify-failed",
        resource: "EsignEvent",
        after: { provider: provider.name, error: verification.error },
        source: "api",
        context: { ip: req.headers.get("x-forwarded-for") ?? undefined },
      });
      // For the mock provider, we don't enforce signature (tests rely on this).
      if (provider.name !== "mock") {
        return NextResponse.json({ error: "invalid signature" }, { status: 401 });
      }
    }

    // 2. Parse the webhook event into a normalized shape.
    const event = provider.parseWebhookEvent(rawBody);
    if (!event) {
      logger.warn("api.webhooks.esign.unparseable", { provider: provider.name });
      return NextResponse.json({ error: "could not parse webhook payload" }, { status: 400 });
    }

    // 3. Handle the event (dedupes + updates Contract).
    const result = await handleEsignWebhook(event);

    logger.info("api.webhooks.esign.processed", {
      provider: provider.name,
      envelopeId: event.envelopeId,
      eventType: event.eventType,
      contractId: result.contractId,
      deduped: result.deduped,
    });

    // 4. Audit log entry for the webhook receipt.
    await recordAudit({
      actor: `esign-webhook:${provider.name}`,
      actorRole: "system",
      action: "webhook-received",
      resource: "Contract",
      resourceId: result.contractId ?? event.envelopeId,
      after: {
        provider: provider.name,
        envelopeId: event.envelopeId,
        eventType: event.eventType,
        deduped: result.deduped,
      },
      source: "api",
    });

    // Always return 200 so the provider doesn't retry.
    return NextResponse.json({ ok: true, deduped: result.deduped, contractId: result.contractId });
  } catch (err) {
    logger.error("api.webhooks.esign.failed", { error: String(err) });
    // Return 200 on internal errors so providers don't retry forever.
    // We log the error + record it in the audit log for forensics.
    await recordAudit({
      actor: "esign-webhook",
      actorRole: "system",
      action: "error",
      resource: "EsignEvent",
      after: { error: String(err) },
      source: "api",
    }).catch(() => null);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 200 });
  }
}

/**
 * GET /api/webhooks/esign — Returns the webhook status (for debugging).
 */
export async function GET() {
  return NextResponse.json({
    configured: !!process.env.ESIGN_PROVIDER,
    provider: process.env.ESIGN_PROVIDER ?? null,
    tokenRequired: !!process.env.ESIGN_WEBHOOK_TOKEN,
    supportedProviders: ["docusign", "hellosign", "mock"],
    events: ["envelope.sent", "envelope.delivered", "envelope.completed", "envelope.declined", "envelope.voided"],
  });
}
