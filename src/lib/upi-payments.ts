/**
 * src/lib/upi-payments.ts — UPI/QR Payment Integration (v44)
 *
 * Adds Indian UPI payment support alongside crypto. UPI has no public API
 * for verification, so we use an owner-approval flow:
 *
 *   1. Owner configures their VPA (e.g. owner@upi) + uploads a QR image
 *      via /api/settings/payment-qr
 *   2. Customer selects "Pay via UPI" at checkout
 *   3. We display the owner's QR + VPA + exact INR amount (USD→INR via
 *      free forex API)
 *   4. Customer scans QR, pays via their UPI app, returns to page
 *   5. Customer clicks "I've Paid" → enters their UTR (transaction ref)
 *   6. Order status → pending_upi_verification
 *   7. Owner is notified (email + dashboard alert)
 *   8. Owner checks UPI app, clicks Approve or Reject in dashboard
 *   9. If approved → trigger ServiceBuilder → deliver
 *      If rejected → notify customer with reason
 *
 * Storage:
 *   - VPA: Setting key="upi.vpa"
 *   - Display name: Setting key="upi.displayName"
 *   - QR image: Setting key="upi.qrImageB64" (base64-encoded PNG/JPG/SVG, max 2MB)
 *   - Per-order UTR + INR amount: ServiceOrder.upiUtr + ServiceOrder.upiAmountInr
 */
import "server-only";

import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";

const SETTING_KEY_VPA = "upi.vpa";
const SETTING_KEY_DISPLAY_NAME = "upi.displayName";
const SETTING_KEY_QR = "upi.qrImageB64";
const MAX_QR_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

// ─── Owner settings (VPA + QR upload) ────────────────────────────────

export interface UpiSettings {
  vpa: string | null;
  displayName: string | null;
  qrImageB64: string | null;
  qrMimeType: string | null;
  isConfigured: boolean;
}

export async function getUpiSettings(): Promise<UpiSettings> {
  try {
    const rows = await db.setting.findMany({
      where: { key: { in: [SETTING_KEY_VPA, SETTING_KEY_DISPLAY_NAME, SETTING_KEY_QR] } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const vpa = map.get(SETTING_KEY_VPA) ?? null;
    const displayName = map.get(SETTING_KEY_DISPLAY_NAME) ?? null;
    const qrImageB64 = map.get(SETTING_KEY_QR) ?? null;

    return {
      vpa,
      displayName,
      qrImageB64,
      qrMimeType: qrImageB64 ? detectMimeType(qrImageB64) : null,
      isConfigured: !!(vpa && qrImageB64),
    };
  } catch (err) {
    logger.error("upi.get-settings-failed", { error: String(err) });
    return { vpa: null, displayName: null, qrImageB64: null, qrMimeType: null, isConfigured: false };
  }
}

export async function saveUpiSettings(input: {
  vpa?: string;
  displayName?: string;
  qrImageB64?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    // Validate VPA format: word@word (e.g. owner@upi, owner@okicici)
    if (input.vpa !== undefined) {
      const vpa = input.vpa.trim();
      if (vpa && !/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z0-9.\-_]{2,64}$/.test(vpa)) {
        return { ok: false, error: "Invalid VPA format. Expected: name@bank (e.g. owner@upi)" };
      }
      await db.setting.upsert({
        where: { key: SETTING_KEY_VPA },
        create: { key: SETTING_KEY_VPA, value: vpa, category: "payment" },
        update: { value: vpa },
      });
    }

    if (input.displayName !== undefined) {
      const name = input.displayName.trim().slice(0, 100);
      await db.setting.upsert({
        where: { key: SETTING_KEY_DISPLAY_NAME },
        create: { key: SETTING_KEY_DISPLAY_NAME, value: name, category: "payment" },
        update: { value: name },
      });
    }

    if (input.qrImageB64 !== undefined) {
      // Validate base64 + size
      const sizeBytes = Math.ceil((input.qrImageB64.length * 3) / 4);
      if (sizeBytes > MAX_QR_SIZE_BYTES) {
        return { ok: false, error: `QR image too large (${sizeBytes} bytes). Max ${MAX_QR_SIZE_BYTES} bytes (2MB).` };
      }
      // Basic base64 format check
      if (!/^[A-Za-z0-9+/\n\r]+=*$/.test(input.qrImageB64)) {
        return { ok: false, error: "QR image is not valid base64" };
      }
      await db.setting.upsert({
        where: { key: SETTING_KEY_QR },
        create: { key: SETTING_KEY_QR, value: input.qrImageB64, category: "payment" },
        update: { value: input.qrImageB64 },
      });
    }

    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: "UPI payment settings updated",
      level: "success",
    });

    return { ok: true };
  } catch (err) {
    logger.error("upi.save-settings-failed", { error: String(err) });
    return { ok: false, error: String(err) };
  }
}

// ─── Customer checkout flow ──────────────────────────────────────────

/**
 * Create a UPI payment order. Converts USD price to INR using a free forex API.
 */
export async function createUpiOrder(input: {
  serviceId: string;
  spec: string;
  customerEmail: string;
  customerName?: string;
}): Promise<{ ok: boolean; orderId?: string; error?: string; amountInr?: number; vpa?: string | null; qrImageB64?: string | null }> {
  try {
    const { getService } = await import("./services/catalog");
    const service = getService(input.serviceId);
    if (!service) {
      return { ok: false, error: `Unknown service: ${input.serviceId}` };
    }

    if (!input.spec || input.spec.length < 10 || input.spec.length > 5000) {
      return { ok: false, error: "Spec must be 10-5000 chars" };
    }

    const settings = await getUpiSettings();
    if (!settings.isConfigured) {
      return { ok: false, error: "UPI payments not configured. Owner must set VPA + QR first." };
    }

    // Convert USD to INR
    const usdAmount = service.priceCents / 100;
    const usdInrRate = await getUsdInrRate();
    if (usdInrRate === null) {
      return { ok: false, error: "Could not fetch USD→INR exchange rate. Please try again." };
    }
    const amountInr = Math.round(usdAmount * usdInrRate * 100) / 100; // 2 decimal places

    const order = await db.serviceOrder.create({
      data: {
        serviceId: service.id,
        serviceName: service.name,
        spec: input.spec,
        priceCents: service.priceCents,
        currency: "inr",
        status: "pending_upi_payment",
        cryptoNetwork: "UPI",
        upiVpa: settings.vpa,
        upiAmountInr: amountInr,
        upiQrImageB64: settings.qrImageB64,
        customerEmail: input.customerEmail,
        customerName: input.customerName ?? null,
      },
    });

    logger.info("upi.order-created", {
      orderId: order.id,
      serviceId: service.id,
      amountInr,
      customerEmail: input.customerEmail,
    });

    return {
      ok: true,
      orderId: order.id,
      amountInr,
      vpa: settings.vpa,
      qrImageB64: settings.qrImageB64,
    };
  } catch (err) {
    logger.error("upi.create-order-failed", { error: String(err) });
    return { ok: false, error: String(err) };
  }
}

/**
 * Customer clicked "I've Paid" — record their UTR + notify owner.
 */
export async function claimUpiPayment(
  orderId: string,
  utr: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // UTR is 12 digits (most UPI apps) or 22 chars (some banks). Be lenient but validate.
    const trimmedUtr = utr.trim();
    if (!/^[A-Za-z0-9]{10,30}$/.test(trimmedUtr)) {
      return { ok: false, error: "Invalid UTR format. Expected 10-30 alphanumeric characters." };
    }

    const order = await db.serviceOrder.findUnique({ where: { id: orderId } });
    if (!order) {
      return { ok: false, error: "Order not found" };
    }

    if (order.status !== "pending_upi_payment") {
      return { ok: false, error: `Order is in status ${order.status}, cannot claim UPI payment` };
    }

    await db.serviceOrder.update({
      where: { id: orderId },
      data: {
        upiUtr: trimmedUtr,
        status: "pending_upi_verification",
      },
    });

    // Notify owner
    const { sendNotification } = await import("./email-service");
    // AUDIT-A-13: don't fall back to owner@example.com (a real third-party domain —
    // leaks order IDs + customer emails + amounts as PII). Skip the alert if unset.
    const ownerEmail = process.env.ARIA_OWNER_EMAIL;
    if (!ownerEmail) { logger.warn("upi-payments.notify.no-owner-email",{orderId}); }
    else await sendNotification({
      to: ownerEmail,
      subject: `[UPI] Verify payment for order ${orderId.slice(-8)}`,
      text: `A customer has claimed a UPI payment.

Order: ${order.serviceName} ($${order.priceCents / 100})
Amount expected: ₹${order.upiAmountInr != null ? order.upiAmountInr : "(unknown)"}
Customer UTR: ${trimmedUtr}
Customer email: ${order.customerEmail || "unknown"}

Check your UPI app for this UTR. Then go to the dashboard → Services → Pending UPI to approve or reject.`,
      metadata: { orderId, type: "upi_verification_request", utr: trimmedUtr },
    });

    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: `UPI payment claimed for order ${orderId.slice(-8)} (UTR: ${trimmedUtr})`,
      level: "info",
    });

    return { ok: true };
  } catch (err) {
    logger.error("upi.claim-failed", { orderId, error: String(err) });
    return { ok: false, error: String(err) };
  }
}

/**
 * Owner approves a UPI payment → trigger builder.
 *
 * v45 fix (phantom-revenue bug): Transition through `paid_verified` first,
 * then call approveOrder() which handles the `paid_verified → building → delivered`
 * transition WITH the delivery sanity check + RevenueEvent creation.
 */
export async function approveUpiOrder(orderId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const order = await db.serviceOrder.findUnique({ where: { id: orderId } });
    if (!order) {
      return { ok: false, error: "Order not found" };
    }
    if (order.status !== "pending_upi_verification") {
      return { ok: false, error: `Order is in status ${order.status}, cannot approve` };
    }

    // v45: Transition to paid_verified FIRST. Do NOT set ownerApproved here —
    // approveOrder() will do that + the delivery sanity check + RevenueEvent creation.
    await db.serviceOrder.update({
      where: { id: orderId },
      data: {
        status: "paid_verified",
        upiApprovedAt: new Date(),
        paymentConfirmedAt: new Date(),
      },
    });

    // Notify customer that payment was received (build is starting)
    if (order.customerEmail) {
      const { sendNotification } = await import("./email-service");
      // AUDIT-A-14: null-check upiAmountInr + upiUtr so the customer doesn't see "₹undefined".
      const amtStr = order.upiAmountInr != null ? `₹${order.upiAmountInr.toFixed(2)}` : "(amount unknown)";
      const utrStr = order.upiUtr || "(UTR pending)";
      await sendNotification({
        to: order.customerEmail,
        subject: `[ARIA] Payment received — building your ${order.serviceName}`,
        text: `Hi ${order.customerName || "there"},

We've received your UPI payment of ${amtStr} (UTR: ${utrStr}).

Your order is now being built. You'll receive a follow-up email with your deliverable within ${order.serviceName.includes("Landing") ? "1 hour" : "a few hours"}.

Order ID: ${orderId}

— The ARIA Team`,
        metadata: { orderId, type: "upi_payment_confirmed" },
      }).catch(() => {
        // non-fatal
      });
    }

    // Now trigger approveOrder() which handles building → delivered + RevenueEvent
    try {
      const { approveOrder } = await import("./services/crypto-checkout");
      const result = await approveOrder(orderId);
      if (!result.ok) {
        logger.error("upi.approve-order-failed", { orderId, error: result.error });
        return { ok: false, error: result.error };
      }
      logger.success("upi.approved", { orderId });
    } catch (buildErr) {
      logger.error("upi.build-failed", { orderId, error: String(buildErr) });
      return { ok: false, error: String(buildErr) };
    }

    return { ok: true };
  } catch (err) {
    logger.error("upi.approve-failed", { orderId, error: String(err) });
    return { ok: false, error: String(err) };
  }
}

/**
 * Owner rejects a UPI payment → notify customer with reason.
 */
export async function rejectUpiOrder(orderId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const order = await db.serviceOrder.findUnique({ where: { id: orderId } });
    if (!order) {
      return { ok: false, error: "Order not found" };
    }
    if (order.status !== "pending_upi_verification") {
      return { ok: false, error: `Order is in status ${order.status}, cannot reject` };
    }

    await db.serviceOrder.update({
      where: { id: orderId },
      data: {
        status: "failed",
        upiRejectedReason: reason.slice(0, 500),
        buildLog: `UPI payment rejected: ${reason}`,
      },
    });

    // Notify customer
    if (order.customerEmail) {
      const { sendNotification } = await import("./email-service");
      await sendNotification({
        to: order.customerEmail,
        subject: `[ARIA] UPI payment not verified — action needed`,
        text: `Hi ${order.customerName || "there"},

We couldn't verify your UPI payment for order ${orderId}.

Reason: ${reason}

If you believe this is an error, please reply to this email with:
- Your UPI transaction reference (UTR)
- A screenshot of the payment from your UPI app

We'll review and get back to you within 24 hours.

— The ARIA Team`,
        metadata: { orderId, type: "upi_payment_rejected" },
      }).catch(() => {
        // non-fatal
      });
    }

    emit({
      type: "system",
      ts: new Date().toISOString(),
      message: `UPI payment rejected for order ${orderId.slice(-8)}: ${reason.slice(0, 80)}`,
      level: "warn",
    });

    return { ok: true };
  } catch (err) {
    logger.error("upi.reject-failed", { orderId, error: String(err) });
    return { ok: false, error: String(err) };
  }
}

/**
 * Get all orders pending UPI verification (for owner dashboard).
 */
export async function getPendingUpiVerifications(limit = 50) {
  return db.serviceOrder.findMany({
    where: { status: "pending_upi_verification" },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
  });
}

// ─── USD → INR conversion (free forex API) ───────────────────────────

let usdInrCache: { rate: number; at: number } | null = null;
const USD_INR_CACHE_MS = 30 * 60 * 1000; // 30 min

async function getUsdInrRate(): Promise<number | null> {
  if (usdInrCache && Date.now() - usdInrCache.at < USD_INR_CACHE_MS) {
    return usdInrCache.rate;
  }

  // Try free forex APIs (no key needed)
  const sources: Array<() => Promise<number | null>> = [
    async () => {
      // exchangerate-api.com free tier (no key, open data)
      const res = await fetch("https://open.er-api.com/v6/latest/USD", {
        signal: AbortSignal.timeout(5_000),
      });
      const data = await res.json();
      return data?.rates?.INR ?? null;
    },
    async () => {
      // frankfurter.app (ECB data, no key)
      const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=INR", {
        signal: AbortSignal.timeout(5_000),
      });
      const data = await res.json();
      return data?.rates?.INR ?? null;
    },
    async () => {
      // fawazahmed0 forex (no key, GitHub-hosted)
      const res = await fetch(
        "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
        { signal: AbortSignal.timeout(5_000) },
      );
      const data = await res.json();
      return data?.usd?.inr ?? null;
    },
  ];

  for (const source of sources) {
    try {
      const rate = await source();
      if (rate !== null && rate > 0) {
        usdInrCache = { rate, at: Date.now() };
        return rate;
      }
    } catch {
      // try next
    }
  }

  logger.error("upi.usd-inr-all-sources-failed", {});
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function detectMimeType(b64: string): string | null {
  // Decode first few bytes to sniff the magic number
  try {
    const head = b64.slice(0, 16);
    const decoded = Buffer.from(head, "base64").toString("hex").toLowerCase();
    if (decoded.startsWith("89504e47")) return "image/png";
    if (decoded.startsWith("ffd8ff")) return "image/jpeg";
    if (decoded.startsWith("3c737667") || decoded.startsWith("3c3f786d6c")) return "image/svg+xml";
    if (decoded.startsWith("47494638")) return "image/gif";
    if (decoded.startsWith("424d")) return "image/bmp";
    if (decoded.startsWith("52494646")) return "image/webp";
    return null;
  } catch {
    return null;
  }
}
