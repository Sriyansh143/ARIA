/**
 * /api/contracts — v73 Phase 23 (RULE-73) + Phase 30 (e-sign + audit log)
 *
 * GET  — list contracts (filter by status / clientEmail).
 * POST — create + send a contract for a high-ticket service order.
 *
 * Phase 30 additions:
 *   - POST endpoint now accepts an optional `esignProvider` field. If
 *     set to "mock" / "hellosign" / "docusign", the contract is sent via
 *     the e-signature provider (with inline keyboard / DocuSign envelope).
 *     If not set, the legacy email-reply signing flow is used.
 *   - Every POST records an audit log entry (action="create", resource="Contract").
 *   - Optional `customerCountry` / `customerState` / `customerZip` fields
 *     trigger tax calculation via the tax-calculator module.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrResponse } from "@/lib/auth";
import { db } from "@/lib/db";
import { createContractForServiceOrder, sendContractForSignature, CONTRACT_THRESHOLD_CENTS } from "@/lib/legal/contract-generator";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuthOrResponse("GET", "/api/contracts");
  if (auth instanceof NextResponse) return auth;
  try {
    const status = req.nextUrl.searchParams.get("status") ?? undefined;
    const contracts = await db.contract.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, contractNumber: true, contractType: true,
        clientName: true, clientEmail: true, clientCompany: true,
        serviceName: true, amountCents: true, currency: true,
        status: true, sentAt: true, signedAt: true, signedByEmail: true,
        expiresAt: true, createdAt: true, serviceOrderId: true,
        // Phase 30: include the new esign + tax fields
        esignProvider: true, envelopeId: true, esignStatus: true,
        subtotalCents: true, taxAmountCents: true, taxRate: true, taxJurisdiction: true,
      },
    });
    return NextResponse.json({ ok: true, count: contracts.length, contracts });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthOrResponse("POST", "/api/contracts");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    const { serviceOrderId, clientName, clientEmail, clientCompany, serviceName, serviceDescription, amountCents, currency, milestones, sendNow, esignProvider, customerCountry, customerState, customerZip } = body;

    if (!serviceOrderId || !clientName || !clientEmail || !serviceName || !amountCents) {
      return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
    }
    if (amountCents < CONTRACT_THRESHOLD_CENTS) {
      return NextResponse.json({ ok: false, error: `Contract threshold not met: $${(amountCents / 100).toFixed(2)} < $${(CONTRACT_THRESHOLD_CENTS / 100).toFixed(2)} (per RULE-73)` }, { status: 400 });
    }

    const result = await createContractForServiceOrder(serviceOrderId, {
      clientName, clientEmail,
      clientCompany: clientCompany ?? "",
      serviceName,
      serviceDescription: serviceDescription ?? "",
      amountCents,
      currency: currency ?? "USD",
      milestones: milestones ?? [],
    });

    // ─── Phase 30 — Tax calculation ───────────────────────────────────
    // If customer location is provided, calculate tax + update the contract.
    let taxAmountCents = 0;
    if (customerCountry) {
      try {
        const { calculateTax } = await import("@/lib/finance/tax-calculator");
        const taxResult = await calculateTax({
          subtotalCents: amountCents,
          currency: currency ?? "USD",
          customerCountry,
          customerState,
          customerZip,
          contractId: result.contractId,
          serviceOrderId,
        });
        if (taxResult.ok) {
          taxAmountCents = taxResult.taxAmountCents;
          await db.contract.update({
            where: { id: result.contractId },
            data: {
              subtotalCents: amountCents,
              taxAmountCents: taxResult.taxAmountCents,
              taxRate: taxResult.taxRate,
              taxJurisdiction: taxResult.taxJurisdiction,
              amountCents: amountCents + taxResult.taxAmountCents,
            },
          });
        }
      } catch (taxErr) {
        logger.warn("api.contracts.tax-calc-failed", { contractId: result.contractId, error: String(taxErr) });
      }
    }

    // ─── Phase 30 — E-signature provider routing ───────────────────────
    // If esignProvider is specified, override the env var so the provider
    // is used for sending. If not specified, fall back to the env config.
    const savedEsignProvider = process.env.ESIGN_PROVIDER;
    if (esignProvider) {
      process.env.ESIGN_PROVIDER = esignProvider;
    }

    if (sendNow) {
      // Try the e-sign provider first (if configured). Fall back to email-reply.
      try {
        const { sendContractForEsign, isEsignConfigured } = await import("@/lib/legal/esign-provider");
        if (isEsignConfigured()) {
          const esignResult = await sendContractForEsign(result.contractId);
          if (!esignResult.ok) {
            // Fall back to email-reply signing.
            logger.warn("api.contracts.esign-failed-falling-back-to-email", { contractId: result.contractId, error: esignResult.error });
            await sendContractForSignature(result.contractId);
          }
        } else {
          // No e-sign provider configured — use legacy email-reply signing.
          await sendContractForSignature(result.contractId);
        }
      } catch (esignErr) {
        logger.warn("api.contracts.esign-threw-falling-back", { contractId: result.contractId, error: String(esignErr) });
        await sendContractForSignature(result.contractId);
      }
    }

    // Restore the env var.
    if (savedEsignProvider === undefined) {
      delete process.env.ESIGN_PROVIDER;
    } else {
      process.env.ESIGN_PROVIDER = savedEsignProvider;
    }

    // ─── Phase 30 — Audit log entry ────────────────────────────────────
    try {
      await recordAudit({
        actor: "owner",
        actorRole: "owner",
        action: "create",
        resource: "Contract",
        resourceId: result.contractId,
        after: {
          contractNumber: result.contractNumber,
          clientEmail,
          amountCents,
          currency: currency ?? "USD",
          taxAmountCents,
          esignProvider: esignProvider ?? savedEsignProvider ?? "",
          serviceOrderId,
        },
        source: "api",
        context: {
          ip: req.headers.get("x-forwarded-for") ?? undefined,
          userAgent: req.headers.get("user-agent") ?? undefined,
        },
      });
    } catch (auditErr) {
      logger.warn("api.contracts.audit-failed", { contractId: result.contractId, error: String(auditErr) });
    }

    return NextResponse.json({ ok: true, ...result, taxAmountCents });
  } catch (err) {
    logger.error("api.contracts.create.failed", { error: String(err) });
    return NextResponse.json({ ok: false, error: String(err).slice(0, 100) }, { status: 500 });
  }
}
