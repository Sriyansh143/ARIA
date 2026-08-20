/**
 * src/lib/services/crypto-checkout.ts — Crypto Payment Gateway.
 *
 * v32: $0-budget crypto payment flow. No KYC, no fees.
 *
 * Flow:
 *   1. Customer clicks "Buy" → createOrder() creates a ServiceOrder with
 *      status="pending_payment", generates a QR code for the wallet address.
 *   2. Customer sends crypto to the wallet address from their wallet app.
 *   3. Owner manually checks their crypto wallet, sees the payment.
 *   4. Owner clicks "Approve & Build" in the ARIA dashboard.
 *   5. approveOrder() sets ownerApproved=true + status="building".
 *   6. buildService() is triggered — but ONLY runs if ownerApproved===true.
 *   7. Builder generates code, zips, marks order "delivered".
 *   8. Web Push notification sent to owner + customer.
 *
 * The wallet address + network are configured via .env:
 *   CRYPTO_WALLET_ADDRESS=bc1q...
 *   CRYPTO_NETWORK=BTC   (BTC | ETH | SOL | USDT | USDC)
 */
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getService } from "./catalog";

export interface CryptoOrderResult {
  orderId: string;
  serviceName: string;
  priceCents: number;
  priceUsd: string;
  cryptoNetwork: string;
  walletAddress: string;
  qrCodeUrl: string;
  status: string;
}

/**
 * Create a new crypto payment order.
 * The customer is shown a QR code for the wallet address + the USD amount.
 */
export async function createCryptoOrder(params: {
  serviceId: string;
  spec: string;
  customerEmail?: string;
  customerName?: string;
  cryptoTxHash?: string;
}): Promise<{ ok: boolean; order?: CryptoOrderResult; error?: string }> {
  const { serviceId, spec, customerEmail, customerName, cryptoTxHash } = params;

  const service = getService(serviceId);
  if (!service) {
    return { ok: false, error: `unknown service: ${serviceId}` };
  }
  if (!spec || spec.length < 10) {
    return { ok: false, error: "spec must be at least 10 characters" };
  }
  if (spec.length > 5000) {
    return { ok: false, error: "spec must be under 5000 characters" };
  }

  const walletAddress = process.env.CRYPTO_WALLET_ADDRESS || "";
  const cryptoNetwork = process.env.CRYPTO_NETWORK || "BTC";

  if (!walletAddress) {
    return {
      ok: false,
      error: "CRYPTO_WALLET_ADDRESS not configured. Set it in .env to enable crypto payments.",
    };
  }

  // Create the order record.
  const order = await db.serviceOrder.create({
    data: {
      serviceId: service.id,
      serviceName: service.name,
      spec,
      priceCents: service.priceCents,
      currency: "usd",
      status: "pending_payment",
      cryptoNetwork,
      walletAddress,
      cryptoTxHash: cryptoTxHash || null,
      customerEmail,
      customerName,
      ownerApproved: false,
    },
  });

  // Generate QR code URL (using a public QR API — no backend cost).
  // The QR encodes the wallet address for easy scanning by mobile wallets.
  const qrData = cryptoNetwork === "BTC"
    ? `bitcoin:${walletAddress}?amount=${(service.priceCents / 100).toFixed(8)}`
    : cryptoNetwork === "ETH"
    ? `ethereum:${walletAddress}?value=${(service.priceCents / 100 / 3000).toFixed(6)}`
    : walletAddress;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`;

  logger.info("crypto-checkout.order-created", {
    orderId: order.id,
    serviceId,
    amount: service.priceCents,
    network: cryptoNetwork,
  });

  return {
    ok: true,
    order: {
      orderId: order.id,
      serviceName: service.name,
      priceCents: service.priceCents,
      priceUsd: `$${(service.priceCents / 100).toFixed(2)}`,
      cryptoNetwork,
      walletAddress,
      qrCodeUrl,
      status: "pending_payment",
    },
  };
}

/**
 * Owner approves a pending payment + triggers the build.
 * Called from the dashboard "Pending Crypto Payments" widget.
 *
 * v45 fix (phantom-revenue bug): Strict state machine.
 *   - Accepts status === "pending_payment" (manual owner approval)
 *     OR status === "paid_verified" (auto-verified by crypto-verifier cron)
 *   - Before delivering, RE-FETCHES the order and verifies:
 *       ownerApproved === true  OR  status === "paid_verified"
 *     If neither, marks the order `failed` with reason "delivery blocked".
 *   - On successful delivery, CREATES a RevenueEvent row (single source of truth
 *     for revenue). The autonomous-business-engine now reads from RevenueEvent
 *     instead of reporting phantom invoice amounts.
 */
export async function approveOrder(orderId: string): Promise<{
  ok: boolean;
  order?: any;
  error?: string;
}> {
  const order = await db.serviceOrder.findUnique({ where: { id: orderId } });
  if (!order) {
    return { ok: false, error: "order not found" };
  }
  if (order.ownerApproved) {
    return { ok: false, error: "order already approved" };
  }
  // v45: accept both pending_payment (manual) and paid_verified (auto)
  if (order.status !== "pending_payment" && order.status !== "paid_verified") {
    return { ok: false, error: `order is not pending_payment or paid_verified (status: ${order.status})` };
  }

  // ─── Phase 30 — Contract-signing gate ───────────────────────────────
  // If a Contract is linked to this ServiceOrder (via Contract.serviceOrderId),
  // the contract MUST be in status="signed" before the build can start.
  // This enforces the business rule: "no work begins until the contract is signed".
  // The gate is enforced here (before the atomic claim) so the order is NOT
  // flipped to "building" if the contract is unsigned.
  try {
    const { checkContractGate } = await import("./project-lifecycle");
    const gate = await checkContractGate(orderId);
    if (!gate.ok) {
      logger.warn("crypto-checkout.contract-gate-blocked", {
        orderId,
        contractId: gate.contractId,
        contractStatus: gate.contractStatus,
      });
      return {
        ok: false,
        error: `Contract gate blocked: ${gate.error}`,
      };
    }
  } catch (err) {
    // Best-effort — if the gate check fails (e.g. DB issue), log + proceed.
    // We don't want to block ALL approvals because of a transient error.
    logger.warn("crypto-checkout.contract-gate-check-failed", { orderId, error: String(err) });
  }

  // AUDIT-A-1: atomic claim — conditional updateMany prevents the TOCTOU race
  // where two callers (Stripe webhook + crypto-verifier cron + UPI approval +
  // revenue-engine) all see ownerApproved=false and proceed to buildService +
  // create RevenueEvent in parallel (double-credit). Only the caller that flips
  // ownerApproved false→true proceeds; the rest see count===0 and bail.
  const claimed = await db.serviceOrder.updateMany({
    where: { id: orderId, ownerApproved: false, status: { in: ["pending_payment", "paid_verified"] } },
    data: { ownerApproved: true, ownerApprovedAt: new Date(), status: "building" },
  });
  if (claimed.count === 0) {
    // Someone else already claimed this order concurrently.
    return { ok: false, error: "order already approved (concurrent claim)" };
  }

  logger.info("crypto-checkout.approved", { orderId, serviceId: order.serviceId, previousStatus: order.status });

  // Trigger the build in the background (non-blocking).
  // The builder checks ownerApproved === true before generating code.
  void (async () => {
    try {
      const { buildService } = await import("./builder");
      const result = await buildService(orderId, order.serviceId, order.spec);

      // v45 fix: RE-FETCH the order before marking delivered.
      // If the owner un-approved or the payment was reversed mid-build, block delivery.
      const currentOrder = await db.serviceOrder.findUnique({ where: { id: orderId } });
      if (!currentOrder) {
        logger.error("crypto-checkout.order-vanished", { orderId });
        return;
      }
      const deliveryAllowed =
        currentOrder.ownerApproved === true || currentOrder.status === "paid_verified";
      if (!deliveryAllowed) {
        await db.serviceOrder.update({
          where: { id: orderId },
          data: {
            status: "failed",
            buildLog: `delivery blocked: order no longer paid_verified or ownerApproved (status=${currentOrder.status}, ownerApproved=${currentOrder.ownerApproved}). Build output discarded.`,
          },
        });
        logger.error("crypto-checkout.delivery-blocked", {
          orderId,
          status: currentOrder.status,
          ownerApproved: currentOrder.ownerApproved,
        });
        return;
      }

      if (result.ok) {
        // AUDIT-A-22: conditional delivery — refuse to mark delivered if a concurrent
        // refund already moved status to "refunded" (which would otherwise be overwritten
        // here, delivering to a refunded customer and writing a path to deleted files).
        const deliverRes = await db.serviceOrder.updateMany({
          where: { id: orderId, status: { in: ["building", "paid_verified"] } },
          data: {
            status: "delivered",
            deliverablePath: result.zipPath,
            fileCount: result.fileCount,
            files: JSON.stringify(result.files),
            buildProvider: result.provider ?? null,
            buildModel: result.model ?? null,
            buildLatencyMs: result.latencyMs ?? null,
            deliveredAt: new Date(),
          },
        });
        if (deliverRes.count === 0) {
          logger.error("crypto-checkout.delivery-skipped-status-changed", { orderId });
          return;
        }
        logger.info("crypto-checkout.delivered", { orderId, fileCount: result.fileCount });

        // v45 fix: Persist a RevenueEvent row — single source of truth for revenue.
        // This is what the dashboard + KPI engine + autonomous-business-engine read.
        try {
          await db.revenueEvent.create({
            data: {
              source: "services",
              amount: currentOrder.priceCents / 100,
              description: `ServiceOrder ${orderId} (${currentOrder.serviceName}) — ${currentOrder.cryptoNetwork}${currentOrder.upiUtr ? ` UTR:${currentOrder.upiUtr}` : ""}`,
            },
          });
          logger.info("crypto-checkout.revenue-recorded", {
            orderId,
            amount: currentOrder.priceCents / 100,
          });
        } catch (revErr) {
          // Non-fatal — delivery already happened. But log it so the owner can reconcile.
          logger.error("crypto-checkout.revenue-event-failed", { orderId, error: String(revErr) });
        }

        // v40: Send customer notification via Resend + NotificationLog fallback.
        // v47 fix 6: Only set customerNotified:true if sendNotification() actually succeeded.
        // Previously it was set unconditionally on resolve, even when Resend failed
        // (sendNotification returns {ok:false} rather than throwing). This made the
        // owner unable to trust the customerNotified field.
        try {
          const { sendNotification } = await import("@/lib/email-service");
          if (currentOrder.customerEmail) {
            const notifyResult = await sendNotification({
              to: currentOrder.customerEmail,
              subject: `Your order is ready: ${currentOrder.serviceName}`,
              text: `Hi ${currentOrder.customerName || "there"},\n\nYour order for "${currentOrder.serviceName}" has been completed and is ready for download.\n\nOrder ID: ${orderId}\nFiles: ${result.fileCount}\n\nThank you for your purchase!\n\n— ARIA Mission Control`,
              html: buildDeliveryEmailHtml(currentOrder.serviceName, orderId, result.fileCount),
              metadata: { orderId, serviceName: currentOrder.serviceName },
            });

            if (notifyResult.ok) {
              // v47 fix 6: Only mark notified on actual success.
              await db.serviceOrder.update({
                where: { id: orderId },
                data: { customerNotified: true },
              });
            } else {
              // sendNotification returned a failure (Resend down, key missing, etc.)
              // The NotificationLog row records the failure for the owner to see.
              // Leave customerNotified: false so the owner can retry.
              logger.warn("crypto-checkout.notification-failed-marker", {
                orderId,
                error: notifyResult.error,
                provider: notifyResult.provider,
                hint: "customerNotified left false — owner should retry from dashboard",
              });
            }
          } else {
            // No customer email on file — can't notify. Leave customerNotified: false.
            logger.warn("crypto-checkout.no-customer-email", { orderId });
          }
        } catch (err) {
          // sendNotification threw (rare — indicates a code bug, not a Resend failure)
          logger.warn("crypto-checkout.notification-exception", { orderId, error: String(err) });
        }
      } else {
        await db.serviceOrder.update({
          where: { id: orderId },
          data: {
            status: "failed",
            buildLog: result.error ?? "unknown build error",
            buildProvider: result.provider ?? null,
            buildModel: result.model ?? null,
          },
        });
        logger.error("crypto-checkout.build-failed", { orderId, error: result.error });
      }
    } catch (err) {
      await db.serviceOrder.update({
        where: { id: orderId },
        data: {
          status: "failed",
          buildLog: `unexpected error: ${String(err).slice(0, 500)}`,
        },
      }).catch(() => {});
    }
  })();

  return { ok: true, order: { id: orderId, status: "building" } };
}

/**
 * Reject a pending payment (owner didn't receive the crypto).
 */
export async function rejectOrder(orderId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const order = await db.serviceOrder.findUnique({ where: { id: orderId } });
  if (!order) return { ok: false, error: "order not found" };
  if (order.status !== "pending_payment") {
    return { ok: false, error: `order is not pending_payment (status: ${order.status})` };
  }

  await db.serviceOrder.update({
    where: { id: orderId },
    data: {
      status: "failed",
      buildLog: `Owner rejected: ${reason}`,
    },
  });

  logger.info("crypto-checkout.rejected", { orderId, reason });
  return { ok: true };
}

/**
 * Get all pending crypto payments (for the owner dashboard widget).
 */
export async function getPendingPayments(): Promise<any[]> {
  return db.serviceOrder.findMany({
    where: { status: "pending_payment" },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/**
 * v40: Build a polished HTML email for the order delivery notification.
 * Uses the emerald/teal ARIA brand colors. Responsive + email-client-safe.
 */
function buildDeliveryEmailHtml(serviceName: string, orderId: string, fileCount: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0e0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0e0f;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#141a1d;border:1px solid #2a3338;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
        <tr>
          <td style="background:linear-gradient(135deg,#10b981,#0d9488);padding:24px 32px;">
            <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">✦ ARIA Mission Control</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 16px 0;color:#f0f4f3;font-size:18px;">Your order is ready! 🎉</h2>
            <p style="margin:0 0 16px 0;color:#9ca3a3;font-size:14px;line-height:1.6;">
              Your order for <strong style="color:#34d399;">${serviceName}</strong> has been completed and is ready for download.
            </p>
            <table style="width:100%;margin:16px 0;border-collapse:collapse;">
              <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;border-bottom:1px solid #2a3338;">Order ID</td><td style="padding:8px 0;color:#f0f4f3;font-size:13px;font-family:monospace;border-bottom:1px solid #2a3338;text-align:right;">${orderId}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Files</td><td style="padding:8px 0;color:#f0f4f3;font-size:13px;text-align:right;">${fileCount}</td></tr>
            </table>
            <p style="margin:16px 0 0 0;color:#9ca3a3;font-size:14px;line-height:1.6;">
              Thank you for your purchase! If you have any questions, just reply to this email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #2a3338;">
            <p style="margin:0;color:#6b7280;font-size:12px;">Sent by ARIA Mission Control · Automated notification</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
