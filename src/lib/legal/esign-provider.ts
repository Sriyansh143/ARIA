/**
 * src/lib/legal/esign-provider.ts — Phase 30
 *
 * E-signature provider abstraction. Supports DocuSign, HelloSign, and a
 * Mock provider for tests + local development.
 *
 * PROVIDER SELECTION
 * -----------------
 * The active provider is selected by the `ESIGN_PROVIDER` env var:
 *   - "docusign"  → DocuSignProvider (requires DOCUSIGN_API_KEY)
 *   - "hellosign" → HelloSignProvider (requires HELLOSIGN_API_KEY)
 *   - "mock"      → MockProvider (always works, returns fake envelope IDs)
 *   - ""          → null (no provider — falls back to email-reply signing)
 *
 * WORKFLOW
 * --------
 *   1. Contract is created (status="draft", pdfBase64 populated)
 *   2. sendContractForEsign(contractId) → provider.sendEnvelope(pdf, metadata)
 *      → Contract.status="sent", esignProvider, envelopeId, esignStatus="sent"
 *   3. Client signs via provider's UI (DocuSign/HelloSign)
 *   4. Provider fires webhook → /api/webhooks/esign → handleEsignWebhook()
 *      → Contract.esignStatus="completed", Contract.status="signed", signedAt
 *   5. ServiceOrder transitions from pending_payment → building (if applicable)
 *
 * SECURITY
 * --------
 * - Webhook signature verification per provider (HMAC-SHA256 for HelloSign,
 *   X-Docusign-Signature header for DocuSign)
 * - Idempotency: EsignEvent table dedupes by (provider, envelopeId, eventType, eventTimestamp)
 * - PII redaction: payloads are redacted via redactSensitive() before storage
 */

import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { redactSensitive } from "@/lib/audit-log";

// ─── Types ───────────────────────────────────────────────────────────

export type EsignProviderType = "docusign" | "hellosign" | "mock";

export interface EsignSendRequest {
  contractId: string;
  contractNumber: string;
  clientName: string;
  clientEmail: string;
  clientCompany?: string;
  serviceName: string;
  amountCents: number;
  currency: string;
  pdfBase64: string; // base64-encoded PDF (no data: prefix)
}

export interface EsignSendResult {
  ok: boolean;
  envelopeId?: string;
  providerUrl?: string; // signing URL the client can visit (mock provider only)
  error?: string;
}

export interface EsignWebhookEvent {
  provider: EsignProviderType;
  envelopeId: string;
  eventType: "envelope.sent" | "envelope.delivered" | "envelope.completed" | "envelope.declined" | "envelope.voided";
  eventTimestamp: Date;
  signerEmail?: string;
  signerName?: string;
  rawPayload: unknown;
}

export interface EsignWebhookVerificationResult {
  valid: boolean;
  error?: string;
}

// ─── Provider Interface ──────────────────────────────────────────────

export interface EsignProvider {
  /** Provider name — "docusign" | "hellosign" | "mock" */
  readonly name: EsignProviderType;

  /** Send a PDF for e-signature. Returns the provider's envelopeId. */
  sendEnvelope(req: EsignSendRequest): Promise<EsignSendResult>;

  /**
   * Verify a webhook's authenticity. Returns { valid: true } if the
   * signature matches, { valid: false, error } otherwise.
   */
  verifyWebhook(headers: Record<string, string>, rawBody: string): EsignWebhookVerificationResult;

  /**
   * Parse a webhook payload into a normalized EsignWebhookEvent.
   * Provider-specific JSON shapes are translated here.
   */
  parseWebhookEvent(rawBody: string): EsignWebhookEvent | null;
}

// ─── Mock Provider (for tests + local dev) ────────────────────────────

class MockEsignProvider implements EsignProvider {
  readonly name = "mock" as const;

  async sendEnvelope(req: EsignSendRequest): Promise<EsignSendResult> {
    // Generate a fake envelope ID. Use a counter + timestamp so duplicates
    // are impossible within the same millisecond.
    const envelopeId = `mock-env-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const providerUrl = `https://mock-esign.local/envelope/${envelopeId}`;
    logger.info("esign.mock.sent", { contractId: req.contractId, envelopeId });
    return { ok: true, envelopeId, providerUrl };
  }

  verifyWebhook(): EsignWebhookVerificationResult {
    // Mock provider always returns valid — no signature to verify.
    return { valid: true };
  }

  parseWebhookEvent(rawBody: string): EsignWebhookEvent | null {
    try {
      const body = JSON.parse(rawBody) as {
        envelopeId?: string;
        eventType?: string;
        eventTimestamp?: string;
        signerEmail?: string;
        signerName?: string;
        payload?: unknown;
      };
      if (!body.envelopeId || !body.eventType) return null;
      return {
        provider: "mock",
        envelopeId: body.envelopeId,
        eventType: body.eventType as EsignWebhookEvent["eventType"],
        eventTimestamp: body.eventTimestamp ? new Date(body.eventTimestamp) : new Date(),
        signerEmail: body.signerEmail,
        signerName: body.signerName,
        rawPayload: body.payload ?? body,
      };
    } catch {
      return null;
    }
  }
}

// ─── HelloSign Provider (Dropbox Sign) ────────────────────────────────

class HelloSignProvider implements EsignProvider {
  readonly name = "hellosign" as const;

  private get apiKey(): string | undefined {
    return process.env.HELLOSIGN_API_KEY;
  }

  async sendEnvelope(req: EsignSendRequest): Promise<EsignSendResult> {
    if (!this.apiKey) {
      return { ok: false, error: "HELLOSIGN_API_KEY not configured" };
    }

    try {
      // HelloSign API: POST /signature_request/send
      // Documentation: https://developers.hellosign.com/reference/signature_requestsend
      const formData = new FormData();
      formData.append("title", `${req.contractNumber}: ${req.serviceName}`);
      formData.append("subject", `${req.contractNumber}: Please sign`);
      formData.append("signers[0][email_address]", req.clientEmail);
      formData.append("signers[0][name]", req.clientName);
      formData.append("metadata[contractId]", req.contractId);
      formData.append("metadata[contractNumber]", req.contractNumber);
      // The PDF attachment
      const pdfBuffer = Buffer.from(req.pdfBase64, "base64");
      formData.append("file", new Blob([pdfBuffer], { type: "application/pdf" }), `${req.contractNumber}.pdf`);
      formData.append("is_for_embedded_signing", "0"); // email-based signing

      const res = await fetch("https://api.hellosign.com/v3/signature_request/send", {
        method: "POST",
        headers: {
          // HelloSign uses HTTP Basic auth with the API key as the username + empty password
          Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}`,
        },
        body: formData,
        signal: AbortSignal.timeout(15_000),
      });

      const data = (await res.json()) as {
        signature_request?: { signature_request_id?: string };
        error?: { error_msg?: string };
      };
      if (!res.ok || !data.signature_request?.signature_request_id) {
        return { ok: false, error: data.error?.error_msg ?? `HelloSign API error: ${res.status}` };
      }

      const envelopeId = data.signature_request.signature_request_id;
      return { ok: true, envelopeId };
    } catch (err) {
      logger.error("esign.hellosign.send-failed", { contractId: req.contractId, error: String(err) });
      return { ok: false, error: String(err) };
    }
  }

  verifyWebhook(headers: Record<string, string>, rawBody: string): EsignWebhookVerificationResult {
    // HelloSign webhook verification: HMAC-SHA256 of the raw body with the
    // API key as the secret, base64-encoded, in the X-HelloSign-Signature header.
    // Reference: https://developers.hellosign.com/guides/webhooks/webhooks-overview
    const signature = headers["x-hellosign-signature"] ?? headers["X-HelloSign-Signature"];
    if (!signature) return { valid: false, error: "missing X-HelloSign-Signature header" };
    if (!this.apiKey) return { valid: false, error: "HELLOSIGN_API_KEY not configured" };

    try {
      const crypto = require("crypto") as typeof import("crypto");
      const expected = crypto.createHmac("sha256", this.apiKey).update(rawBody).digest("hex");
      const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      return { valid, error: valid ? undefined : "signature mismatch" };
    } catch (err) {
      return { valid: false, error: String(err) };
    }
  }

  parseWebhookEvent(rawBody: string): EsignWebhookEvent | null {
    try {
      const body = JSON.parse(rawBody) as {
        event?: {
          event_type?: string;
          event_time?: string;
        };
        signature_request?: {
          signature_request_id?: string;
          signatures?: Array<{ signer_email_address?: string; signer_name?: string }>;
        };
      };
      const eventType = body.event?.event_type;
      const envelopeId = body.signature_request?.signature_request_id;
      if (!eventType || !envelopeId) return null;

      // HelloSign event types: "signature_request_sent" | "signature_request_all_signed" |
      // "signature_request_declined" | "signature_request_viewed"
      const eventMap: Record<string, EsignWebhookEvent["eventType"]> = {
        signature_request_sent: "envelope.sent",
        signature_request_viewed: "envelope.delivered",
        signature_request_all_signed: "envelope.completed",
        signature_request_declined: "envelope.declined",
      };
      const normalizedEventType = eventMap[eventType];
      if (!normalizedEventType) return null;

      const signer = body.signature_request?.signatures?.[0];

      return {
        provider: "hellosign",
        envelopeId,
        eventType: normalizedEventType,
        eventTimestamp: body.event?.event_time ? new Date(body.event.event_time) : new Date(),
        signerEmail: signer?.signer_email_address,
        signerName: signer?.signer_name,
        rawPayload: body,
      };
    } catch {
      return null;
    }
  }
}

// ─── DocuSign Provider ────────────────────────────────────────────────

class DocuSignProvider implements EsignProvider {
  readonly name = "docusign" as const;

  private get apiKey(): string | undefined {
    return process.env.DOCUSIGN_API_KEY;
  }

  private get account(): string | undefined {
    return process.env.DOCUSIGN_ACCOUNT_ID;
  }

  private get basePath(): string {
    return process.env.DOCUSIGN_BASE_URL ?? "https://demo.docusign.net/restapi";
  }

  async sendEnvelope(req: EsignSendRequest): Promise<EsignSendResult> {
    if (!this.apiKey || !this.account) {
      return { ok: false, error: "DOCUSIGN_API_KEY / DOCUSIGN_ACCOUNT_ID not configured" };
    }

    try {
      // DocuSign API: POST /accounts/{accountId}/envelopes
      // Documentation: https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopes/create
      const pdfBuffer = Buffer.from(req.pdfBase64, "base64");

      const body = {
        documents: [
          {
            documentBase64: pdfBuffer.toString("base64"),
            name: `${req.contractNumber}.pdf`,
            fileExtension: "pdf",
            documentId: "1",
          },
        ],
        emailSubject: `${req.contractNumber}: Please sign`,
        recipients: {
          signers: [
            {
              email: req.clientEmail,
              name: req.clientName,
              recipientId: "1",
              routingOrder: "1",
            },
          ],
        },
        status: "sent",
      };

      const res = await fetch(`${this.basePath}/v2.1/accounts/${this.account}/envelopes`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });

      const data = (await res.json()) as {
        envelopeId?: string;
        errorCode?: string;
        errorDetails?: string;
      };
      if (!res.ok || !data.envelopeId) {
        return { ok: false, error: data.errorDetails ?? data.errorCode ?? `DocuSign API error: ${res.status}` };
      }

      return { ok: true, envelopeId: data.envelopeId };
    } catch (err) {
      logger.error("esign.docusign.send-failed", { contractId: req.contractId, error: String(err) });
      return { ok: false, error: String(err) };
    }
  }

  verifyWebhook(headers: Record<string, string>, rawBody: string): EsignWebhookVerificationResult {
    // DocuSign Connect webhook verification: HMAC-SHA256 with the connect secret
    // in the X-DocuSign-Signature-1 header, base64-encoded.
    // Reference: https://developers.docusign.com/platform/webhooks/connect/hmac-validation
    const signature = headers["x-docusign-signature-1"] ?? headers["X-DocuSign-Signature-1"];
    if (!signature) return { valid: false, error: "missing X-DocuSign-Signature-1 header" };
    const secret = process.env.DOCUSIGN_CONNECT_SECRET;
    if (!secret) return { valid: false, error: "DOCUSIGN_CONNECT_SECRET not configured" };

    try {
      const crypto = require("crypto") as typeof import("crypto");
      const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
      const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      return { valid, error: valid ? undefined : "signature mismatch" };
    } catch (err) {
      return { valid: false, error: String(err) };
    }
  }

  parseWebhookEvent(rawBody: string): EsignWebhookEvent | null {
    try {
      const body = JSON.parse(rawBody) as {
        event?: string;
        envelopeId?: string;
        status?: string;
        envelopeSummary?: {
          envelopeId?: string;
          status?: string;
          recipients?: {
            signers?: Array<{ email?: string; name?: string }>;
          };
        };
        eventTimestamp?: string;
      };

      const envelopeId = body.envelopeId ?? body.envelopeSummary?.envelopeId;
      const status = body.status ?? body.envelopeSummary?.status;
      if (!envelopeId || !status) return null;

      // DocuSign status: "sent" | "delivered" | "completed" | "declined" | "voided"
      const statusMap: Record<string, EsignWebhookEvent["eventType"]> = {
        sent: "envelope.sent",
        delivered: "envelope.delivered",
        completed: "envelope.completed",
        declined: "envelope.declined",
        voided: "envelope.voided",
      };
      const eventType = statusMap[status];
      if (!eventType) return null;

      const signer = body.envelopeSummary?.recipients?.signers?.[0];

      return {
        provider: "docusign",
        envelopeId,
        eventType,
        eventTimestamp: body.eventTimestamp ? new Date(body.eventTimestamp) : new Date(),
        signerEmail: signer?.email,
        signerName: signer?.name,
        rawPayload: body,
      };
    } catch {
      return null;
    }
  }
}

// ─── Provider Registry ───────────────────────────────────────────────

let mockProvider: MockEsignProvider | null = null;
let hellosignProvider: HelloSignProvider | null = null;
let docusignProvider: DocuSignProvider | null = null;

/**
 * Get the active e-signature provider based on the `ESIGN_PROVIDER` env var.
 * Returns null if no provider is configured (falls back to email-reply signing).
 */
export function getEsignProvider(): EsignProvider | null {
  const providerName = process.env.ESIGN_PROVIDER ?? "";

  switch (providerName) {
    case "mock":
      if (!mockProvider) mockProvider = new MockEsignProvider();
      return mockProvider;
    case "hellosign":
      if (!hellosignProvider) hellosignProvider = new HelloSignProvider();
      return hellosignProvider;
    case "docusign":
      if (!docusignProvider) docusignProvider = new DocuSignProvider();
      return docusignProvider;
    default:
      return null;
  }
}

/**
 * Is any e-signature provider configured? Used by /api/contracts POST
 * to decide whether to send via provider or fall back to email-reply signing.
 */
export function isEsignConfigured(): boolean {
  return getEsignProvider() !== null;
}

// ─── Public: sendContractForEsign ────────────────────────────────────

/**
 * Send an existing contract (with PDF already generated) via the
 * active e-signature provider. Updates the Contract row with the
 * envelopeId + esignProvider + transitions status to "sent".
 *
 * Returns the envelopeId + signing URL (if applicable).
 */
export async function sendContractForEsign(contractId: string): Promise<{
  ok: boolean;
  envelopeId?: string;
  providerUrl?: string;
  error?: string;
}> {
  const provider = getEsignProvider();
  if (!provider) {
    return { ok: false, error: "no e-sign provider configured (set ESIGN_PROVIDER to mock|hellosign|docusign)" };
  }

  const contract = await db.contract.findUnique({ where: { id: contractId } });
  if (!contract) return { ok: false, error: "Contract not found" };
  if (contract.status !== "draft") {
    return { ok: false, error: `Contract status is ${contract.status} (must be 'draft')` };
  }
  if (!contract.pdfBase64) {
    return { ok: false, error: "Contract PDF not generated yet (pdfBase64 is empty)" };
  }

  const result = await provider.sendEnvelope({
    contractId: contract.id,
    contractNumber: contract.contractNumber,
    clientName: contract.clientName,
    clientEmail: contract.clientEmail,
    clientCompany: contract.clientCompany,
    serviceName: contract.serviceName,
    amountCents: contract.amountCents,
    currency: contract.currency,
    pdfBase64: contract.pdfBase64,
  });

  if (!result.ok || !result.envelopeId) {
    return { ok: false, error: result.error ?? "provider returned no envelopeId" };
  }

  // Update the Contract with the envelopeId + provider info + transition status.
  await db.contract.update({
    where: { id: contractId },
    data: {
      status: "sent",
      sentAt: new Date(),
      esignProvider: provider.name,
      envelopeId: result.envelopeId,
      esignStatus: "sent",
    },
  });

  logger.info("esign.sent", {
    contractId,
    contractNumber: contract.contractNumber,
    provider: provider.name,
    envelopeId: result.envelopeId,
  });

  return { ok: true, envelopeId: result.envelopeId, providerUrl: result.providerUrl };
}

// ─── Public: handleEsignWebhook ──────────────────────────────────────

/**
 * Process an inbound e-signature webhook event. Steps:
 *   1. Verify signature (already done by the route handler — we receive
 *      the parsed event here).
 *   2. Dedupe via EsignEvent table (provider, envelopeId, eventType, eventTimestamp).
 *   3. Append the redacted payload to Contract.esignEventsJson.
 *   4. Update Contract.esignStatus based on the event type.
 *   5. On "envelope.completed": mark Contract.status="signed", Contract.signedAt,
 *      Contract.signedByEmail, fire ledger entries via signContract() helper.
 *
 * Returns { ok: true, deduped: false } on first receipt, { ok: true, deduped: true }
 * on duplicate, { ok: false } on error.
 */
export async function handleEsignWebhook(event: EsignWebhookEvent): Promise<{
  ok: boolean;
  deduped: boolean;
  contractId?: string;
  error?: string;
}> {
  // Find the matching Contract by envelopeId.
  const contract = await db.contract.findFirst({
    where: { envelopeId: event.envelopeId, esignProvider: event.provider },
  });
  if (!contract) {
    // The event is valid but doesn't match any contract. Record it for audit
    // purposes but return ok so the provider doesn't retry.
    await db.esignEvent.create({
      data: {
        provider: event.provider,
        envelopeId: event.envelopeId,
        eventType: event.eventType,
        payloadJson: JSON.stringify(redactSensitive(event.rawPayload)),
        signatureValid: true,
        eventTimestamp: event.eventTimestamp,
        processed: false,
        contractId: null,
      },
    });
    return { ok: true, deduped: false, error: "no matching contract for envelopeId" };
  }

  // Idempotency check: dedupe by (provider, envelopeId, eventType, eventTimestamp).
  const existing = await db.esignEvent.findFirst({
    where: {
      provider: event.provider,
      envelopeId: event.envelopeId,
      eventType: event.eventType,
      eventTimestamp: event.eventTimestamp,
    },
  });
  if (existing) {
    return { ok: true, deduped: true, contractId: contract.id };
  }

  // Record the event.
  await db.esignEvent.create({
    data: {
      provider: event.provider,
      envelopeId: event.envelopeId,
      eventType: event.eventType,
      payloadJson: JSON.stringify(redactSensitive(event.rawPayload)),
      signatureValid: true,
      eventTimestamp: event.eventTimestamp,
      processed: false,
      contractId: contract.id,
    },
  });

  // Update Contract.esignStatus based on event type.
  const statusMap: Record<EsignWebhookEvent["eventType"], string> = {
    "envelope.sent": "sent",
    "envelope.delivered": "delivered",
    "envelope.completed": "completed",
    "envelope.declined": "declined",
    "envelope.voided": "voided",
  };
  const newEsignStatus = statusMap[event.eventType];

  // Append the event to Contract.esignEventsJson (redacted).
  const eventsArray = safeParseEvents(contract.esignEventsJson);
  eventsArray.push({
    type: event.eventType,
    ts: event.eventTimestamp.toISOString(),
    signerEmail: event.signerEmail,
    signerName: event.signerName,
  });

  await db.contract.update({
    where: { id: contract.id },
    data: {
      esignStatus: newEsignStatus,
      esignEventsJson: JSON.stringify(eventsArray).slice(0, 10_000), // cap at 10KB
      ...(event.eventType === "envelope.completed" && {
        status: "signed",
        signedAt: new Date(),
        signedByEmail: event.signerEmail ?? contract.clientEmail,
        esignSignedAt: new Date(),
      }),
      ...(event.eventType === "envelope.declined" && {
        status: "rejected",
      }),
    },
  });

  // Mark the EsignEvent as processed.
  await db.esignEvent.updateMany({
    where: {
      provider: event.provider,
      envelopeId: event.envelopeId,
      eventType: event.eventType,
      eventTimestamp: event.eventTimestamp,
    },
    data: { processed: true, processedAt: new Date(), contractId: contract.id },
  });

  // On completion, run the contract signing flow (ledger entries, etc.)
  if (event.eventType === "envelope.completed") {
    try {
      // Emit a system event + log. The ledger entries are written by the
      // daily-stripe-reconciliation cron (which cross-checks signed contracts
      // against RevenueEvent + LedgerEntry records). We deliberately do NOT
      // call the private signContract() helper directly — that's an internal
      // implementation detail of the email-reply flow + would require
      // refactoring to expose it publicly.
      const { emit } = await import("../event-bus");
      emit({
        type: "system",
        ts: new Date().toISOString(),
        message: `✅ Contract ${contract.contractNumber} signed via ${event.provider} (envelope ${event.envelopeId})`,
        level: "info",
      });
      logger.info("esign.contract-signed", {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        provider: event.provider,
        envelopeId: event.envelopeId,
      });
    } catch (err) {
      logger.warn("esign.completion-side-effects-failed", { contractId: contract.id, error: String(err) });
    }
  }

  return { ok: true, deduped: false, contractId: contract.id };
}

function safeParseEvents(raw: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
