/**
 * src/lib/lead-hunter/free-offer-engine.ts — v72 Phase 22 (RULE-70)
 *
 * Tracks the "first 100 customers free" launch promotion.
 *
 * Offer rules (RULE-70):
 *   - FREE one-time service build only — NO ongoing maintenance.
 *   - Eligible services: Landing Page, Static Website, 3D Website only.
 *   - Cap: first 100 customers only (sequenceNumber 1-100).
 *   - The offer text MUST mention "ARIA is an AI autonomous company".
 *   - One redemption per customer (deduplicated by email OR phone).
 *
 * Workflow:
 *   1. A lead redeems the offer (via WhatsApp, email, social DM, or web form).
 *   2. The engine checks the cap — if 100 already redeemed, reject.
 *   3. The engine deduplicates — if the email/phone already redeemed, reject.
 *   4. If accepted, allocate a sequenceNumber (1-100) + redemption code.
 *   5. The status goes pending → claimed → delivered (or rejected/expired).
 *
 * The owner can monitor redemptions via /dashboard/free-offers.
 */

import "server-only";
import { db } from "../db";
import { logger } from "../logger";
import { emit } from "../event-bus";

// ─── Constants ─────────────────────────────────────────────────────────

export const FREE_OFFER_CAP = 100;
export const FREE_OFFER_TYPE = "first-100-launch";

// The services eligible for the free offer (per RULE-70: websites only, NOT
// ongoing maintenance, NOT consulting, NOT voice agents).
export const ELIGIBLE_FREE_SERVICES = [
  { serviceName: "Landing Page", serviceCategory: "landing-page" },
  { serviceName: "Static Website", serviceCategory: "web" },
  { serviceName: "3D Website", serviceCategory: "3d" },
];

// ─── Types ────────────────────────────────────────────────────────────

export interface FreeOfferRedemptionRequest {
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerCompany?: string;
  serviceName: string;
  redemptionChannel: string; // "whatsapp" | "email" | "social-dm" | "web-form"
}

export interface FreeOfferRedemptionResult {
  ok: boolean;
  redemptionCode?: string;
  sequenceNumber?: number;
  reason?: string;
  alreadyRedeemed?: boolean;
  capReached?: boolean;
  ineligibleService?: boolean;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Attempt to redeem the free offer for a customer.
 * Enforces the 100-customer cap + dedup by email/phone + eligible services.
 */
export async function redeemFreeOffer(
  req: FreeOfferRedemptionRequest,
): Promise<FreeOfferRedemptionResult> {
  logger.info("free-offer.redeem.attempt", {
    customer: req.customerName,
    service: req.serviceName,
    channel: req.redemptionChannel,
  });

  // Validate the requested service is on the eligible list.
  const eligible = ELIGIBLE_FREE_SERVICES.find((s) => s.serviceName === req.serviceName);
  if (!eligible) {
    return {
      ok: false,
      ineligibleService: true,
      reason: `Service "${req.serviceName}" is not eligible for the free offer. Eligible: ${ELIGIBLE_FREE_SERVICES.map((s) => s.serviceName).join(", ")}. (RULE-70: free offer is websites/landing-pages/3D only, NOT maintenance or consulting.)`,
    };
  }

  // Require at least one contact method.
  if (!req.customerEmail && !req.customerPhone) {
    return {
      ok: false,
      reason: "Cannot redeem free offer without an email or phone — need a way to deliver the service.",
    };
  }

  // Deduplicate by email OR phone.
  const existing = await db.freeOfferRedemption.findFirst({
    where: {
      OR: [
        ...(req.customerEmail ? [{ customerEmail: req.customerEmail }] : []),
        ...(req.customerPhone ? [{ customerPhone: req.customerPhone }] : []),
      ],
      redemptionStatus: { not: "rejected" },
    },
  });
  if (existing) {
    return {
      ok: false,
      alreadyRedeemed: true,
      reason: `This customer already redeemed offer (code ${existing.redemptionCode}, sequence #${existing.sequenceNumber}). One redemption per customer per RULE-70.`,
    };
  }

  // Check the cap.
  const claimedCount = await db.freeOfferRedemption.count({
    where: {
      offerType: FREE_OFFER_TYPE,
      redemptionStatus: { in: ["pending", "claimed", "delivered"] },
    },
  });
  if (claimedCount >= FREE_OFFER_CAP) {
    return {
      ok: false,
      capReached: true,
      reason: `Free offer cap reached (${FREE_OFFER_CAP}/${FREE_OFFER_CAP}). The first-100 promotion is now closed.`,
    };
  }

  // Allocate the next sequence number.
  const sequenceNumber = claimedCount + 1;
  const redemptionCode = generateRedemptionCode(sequenceNumber);

  // Persist the redemption.
  const redemption = await db.freeOfferRedemption.create({
    data: {
      offerType: FREE_OFFER_TYPE,
      serviceName: req.serviceName,
      serviceCategory: eligible.serviceCategory,
      customerName: req.customerName.slice(0, 200),
      customerEmail: req.customerEmail,
      customerPhone: req.customerPhone,
      customerCompany: (req.customerCompany ?? "").slice(0, 200),
      redemptionCode,
      redemptionStatus: "pending",
      sequenceNumber,
    },
  });

  logger.info("free-offer.redeem.success", {
    customer: req.customerName,
    sequence: sequenceNumber,
    code: redemptionCode,
    service: req.serviceName,
  });
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: `🎁 Free offer redeemed: ${req.customerName} → ${req.serviceName} (sequence #${sequenceNumber}/${FREE_OFFER_CAP}, code ${redemptionCode})`,
    level: "success",
  });

  return {
    ok: true,
    redemptionCode,
    sequenceNumber,
  };
}

/**
 * Mark a redemption as claimed (customer confirmed interest) or delivered
 * (the free service has been built + sent to the customer).
 */
export async function updateRedemptionStatus(
  redemptionCode: string,
  status: "claimed" | "delivered" | "rejected" | "expired",
  rejectionReason: string = "",
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const redemption = await db.freeOfferRedemption.findUnique({
      where: { redemptionCode },
    });
    if (!redemption) {
      return { ok: false, reason: `Redemption code ${redemptionCode} not found` };
    }
    await db.freeOfferRedemption.update({
      where: { id: redemption.id },
      data: {
        redemptionStatus: status,
        ...(status === "claimed" ? { claimedAt: new Date() } : {}),
        ...(status === "delivered" ? { deliveredAt: new Date() } : {}),
        ...(status === "rejected" ? { rejectedAt: new Date(), rejectionReason } : {}),
      },
    });
    logger.info("free-offer.status-updated", { redemptionCode, status });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err).slice(0, 100) };
  }
}

/**
 * Get the current offer status: how many claimed, how many delivered, remaining.
 */
export async function getOfferStatus(): Promise<{
  cap: number;
  claimed: number;
  pending: number;
  delivered: number;
  rejected: number;
  remaining: number;
}> {
  const [pending, claimed, delivered, rejected] = await Promise.all([
    db.freeOfferRedemption.count({ where: { offerType: FREE_OFFER_TYPE, redemptionStatus: "pending" } }),
    db.freeOfferRedemption.count({ where: { offerType: FREE_OFFER_TYPE, redemptionStatus: "claimed" } }),
    db.freeOfferRedemption.count({ where: { offerType: FREE_OFFER_TYPE, redemptionStatus: "delivered" } }),
    db.freeOfferRedemption.count({ where: { offerType: FREE_OFFER_TYPE, redemptionStatus: "rejected" } }),
  ]);
  const total = pending + claimed + delivered;
  return {
    cap: FREE_OFFER_CAP,
    claimed: claimed + delivered, // claimed includes delivered (customer said yes)
    pending,
    delivered,
    rejected,
    remaining: Math.max(0, FREE_OFFER_CAP - total),
  };
}

/**
 * Generate the promotional offer text to use in outreach (Instagram posts,
 * WhatsApp blasts, etc.). Always mentions "ARIA is an AI autonomous company".
 */
export function generateOfferText(serviceName: string = "Landing Page"): string {
  return `🎁 FREE ${serviceName} for the first 100 customers!

ARIA is an AI autonomous company — we build websites, landing pages, and 3D websites with zero human intervention. To celebrate our launch, we're giving away 100 FREE one-time builds (no maintenance, no hidden fees, no catch).

✅ What you get: A custom ${serviceName.toLowerCase()} built with your brand colors + logo + content.
✅ What we DON'T do: Ongoing maintenance, paid consulting, or recurring services. This is a one-time launch gift.
✅ Delivery: 24 hours after we collect your brand details.

How to claim:
  📱 Reply to this message with "FREE ${serviceName.toUpperCase()}"
  📧 Or email us at aria@yourcompany.com
  💬 Or DM us on Instagram/Facebook

Spots are limited to 100. Once they're gone, they're gone. Claim yours now — mention code FREE100 when you reach out.

— ARIA, your AI autonomous company 🤖`;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function generateRedemptionCode(sequence: number): string {
  const prefix = "ARIA";
  const padded = String(sequence).padStart(3, "0");
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${padded}-${random}`;
}
