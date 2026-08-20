/**
 * src/lib/notifications.ts — $0 notification system.
 *
 * Dual-layer:
 *   1. Web Push (web-push npm) — instant browser popups for the owner.
 *   2. Gmail Vision Sender — Playwright + Ollama Vision automates Gmail
 *      to send emails to customers for $0 (no SMTP, no API, no cost).
 *
 * If Gmail Vision fails, falls back to Web Push only (no crash).
 */
import { db } from "./db";
import { logger } from "./logger";

// ─── Web Push ──────────────────────────────────────────────────────

interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const globalForPush = globalThis as unknown as { __ariaPushSubs?: PushSubscription[] };
const pushSubs: PushSubscription[] = globalForPush.__ariaPushSubs ?? [];
if (!globalForPush.__ariaPushSubs) globalForPush.__ariaPushSubs = pushSubs;

export function addPushSubscription(sub: PushSubscription): void {
  // Deduplicate by endpoint
  const exists = pushSubs.some((s) => s.endpoint === sub.endpoint);
  if (!exists) pushSubs.push(sub);
  logger.info("notifications.push.subscribed", { endpoint: sub.endpoint, total: pushSubs.length });
}

export function getPushSubscriptions(): PushSubscription[] {
  return [...pushSubs];
}

export async function sendWebPush(title: string, body: string, url?: string): Promise<void> {
  // v45 fix: Read subscriptions from the DB (persistent across restarts).
  // Falls back to in-memory subs if the DB table doesn't exist yet (legacy).
  let dbSubs: PushSubscription[] = [];
  try {
    const rows = await db.webPushSubscription.findMany({ take: 100 });
    dbSubs = rows.map((r) => ({
      endpoint: r.endpoint,
      keys: { p256dh: r.p256dh, auth: r.auth },
    }));
  } catch {
    // Table might not exist yet (pre-v45 schema) — fall back to in-memory
  }

  const allSubs = [...dbSubs, ...pushSubs];
  // Deduplicate by endpoint
  const seen = new Set<string>();
  const subs = allSubs.filter((s) => {
    if (seen.has(s.endpoint)) return false;
    seen.add(s.endpoint);
    return true;
  });

  if (subs.length === 0) {
    logger.debug("notifications.push.no-subs");
    return;
  }

  // Try to use web-push npm package (optional dep).
  try {
    const webpush = await import("web-push").catch(() => null);
    if (!webpush?.default) {
      logger.warn("notifications.push.web-push-not-installed");
      return;
    }

    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    if (!vapidPublicKey || !vapidPrivateKey) {
      logger.warn("notifications.push.no-vapid-keys");
      return;
    }

    webpush.default.setVapidDetails(
      "mailto:" + (process.env.SMTP_FROM || process.env.ARIA_OWNER_EMAIL || "noreply@aria.local"),
      vapidPublicKey,
      vapidPrivateKey,
    );

    const payload = JSON.stringify({ title, body, url: url || "/dashboard" });

    const results = await Promise.allSettled(
      subs.map((sub) =>
        webpush.default.sendNotification(sub, payload),
      ),
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    logger.info("notifications.push.sent", { succeeded, failed, total: subs.length });

    // v45 fix: Remove dead subscriptions from the DB (410 Gone / 404).
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "rejected") {
        const err = (r as PromiseRejectedResult).reason as Error;
        if (err.message.includes("410") || err.message.includes("404")) {
          const endpoint = subs[i].endpoint;
          try {
            await db.webPushSubscription.deleteMany({ where: { endpoint } });
          } catch {
            // non-fatal
          }
          // Also remove from in-memory list
          const memIdx = pushSubs.findIndex((s) => s.endpoint === endpoint);
          if (memIdx >= 0) pushSubs.splice(memIdx, 1);
        }
      }
    }
  } catch (err) {
    logger.warn("notifications.push.failed", { error: String(err) });
  }
}

// ─── Gmail Vision Sender ───────────────────────────────────────────

/**
 * Send an email to the customer via Gmail Vision automation.
 *
 * Uses Playwright to:
 *   1. Open Gmail (persistent context = stays logged in)
 *   2. Take a screenshot of the inbox
 *   3. Send screenshot to Ollama Vision (llava:latest) with prompt:
 *      "Find the 'Compose' button and return its bounding box coordinates."
 *   4. Click the coordinates, type recipient + body, click Send
 *
 * Falls back to Web Push if Playwright or Ollama Vision is unavailable.
 */
export async function sendGmailVision(to: string, subject: string, body: string): Promise<boolean> {
  try {
    // Dynamic import — Playwright is optional.
    let playwright: any;
    try {
      playwright = await import("playwright");
    } catch {
      logger.warn("notifications.gmail-vision.playwright-not-installed");
      await sendWebPush("Email Send Failed", `Playwright not installed. Customer: ${to}`);
      return false;
    }

    const userDataDir = process.env.ARIA_BROWSER_PROFILE || `${process.cwd()}/.browser-profile`;
    const browser = await playwright.chromium.launchPersistentContext(userDataDir, {
      headless: false, // Gmail may require visible browser for some flows
      timeout: 60_000,
    });

    try {
      const page = await browser.newPage();
      await page.goto("https://mail.google.com", { timeout: 30_000, waitUntil: "networkidle" });
      await page.waitForTimeout(2_000);

      // Step 1: Take screenshot of the inbox.
      const screenshot = await page.screenshot({ type: "png" });
      const base64Screenshot = screenshot.toString("base64");

      // Step 2: Send to Ollama Vision to find the "Compose" button.
      const ollamaHost = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
      const visionModel = process.env.ARIA_VISION_MODEL || "llava:latest";

      const visionResponse = await fetch(`${ollamaHost}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: visionModel,
          messages: [
            {
              role: "user",
              content: "Find the 'Compose' button in this Gmail screenshot. Return ONLY the bounding box coordinates as JSON: {\"x\": number, \"y\": number, \"width\": number, \"height\": number}. The button is typically red and in the top-left area.",
              images: [base64Screenshot],
            },
          ],
          stream: false,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!visionResponse.ok) {
        throw new Error(`Ollama Vision HTTP ${visionResponse.status}`);
      }

      const visionData = await visionResponse.json() as { message?: { content?: string } };
      const visionText = visionData.message?.content || "";

      // Parse coordinates from the vision response.
      const coordMatch = visionText.match(/\{[^}]*"x"[^}]*\}/);
      if (!coordMatch) {
        throw new Error("Vision model did not return coordinates");
      }
      const coords = JSON.parse(coordMatch[0]);
      const clickX = coords.x + (coords.width || 50) / 2;
      const clickY = coords.y + (coords.height || 30) / 2;

      logger.info("notifications.gmail-vision.compose-found", { x: clickX, y: clickY });

      // Step 3: Click the Compose button.
      await page.mouse.click(clickX, clickY);
      await page.waitForTimeout(2_000);

      // Step 4: Type the recipient email.
      // The compose window's "To" field is typically the first focused input.
      await page.keyboard.type(to);
      await page.keyboard.press("Tab");
      await page.waitForTimeout(500);

      // Type the subject.
      await page.keyboard.type(subject);
      await page.keyboard.press("Tab");
      await page.waitForTimeout(500);

      // Type the body.
      await page.keyboard.type(body);
      await page.waitForTimeout(500);

      // Step 5: Find + click the Send button using Vision.
      const sendScreenshot = await page.screenshot({ type: "png" });
      const sendBase64 = sendScreenshot.toString("base64");

      const sendVisionResponse = await fetch(`${ollamaHost}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: visionModel,
          messages: [
            {
              role: "user",
              content: "Find the 'Send' button in this Gmail compose window screenshot. Return ONLY the bounding box coordinates as JSON: {\"x\": number, \"y\": number, \"width\": number, \"height\": number}. The Send button is typically blue or white with text 'Send'.",
              images: [sendBase64],
            },
          ],
          stream: false,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      const sendVisionData = await sendVisionResponse.json() as { message?: { content?: string } };
      const sendVisionText = sendVisionData.message?.content || "";
      const sendCoordMatch = sendVisionText.match(/\{[^}]*"x"[^}]*\}/);
      if (sendCoordMatch) {
        const sendCoords = JSON.parse(sendCoordMatch[0]);
        await page.mouse.click(
          sendCoords.x + (sendCoords.width || 50) / 2,
          sendCoords.y + (sendCoords.height || 30) / 2,
        );
        await page.waitForTimeout(2_000);
        logger.info("notifications.gmail-vision.sent", { to, subject });
        return true;
      } else {
        // Fallback: press Ctrl+Enter (Gmail keyboard shortcut for Send)
        await page.keyboard.press("Control+Enter");
        await page.waitForTimeout(2_000);
        logger.info("notifications.gmail-vision.sent-keyboard", { to, subject });
        return true;
      }
    } finally {
      await browser.close();
    }
  } catch (err) {
    logger.warn("notifications.gmail-vision.failed", { error: String(err) });
    // Fallback to Web Push
    await sendWebPush(
      "Email Send Failed — Manual Action Required",
      `Gmail Vision automation failed for ${to}. Subject: ${subject}. Error: ${String(err).slice(0, 100)}`,
    );
    return false;
  }
}

// ─── Order Notification Helpers ────────────────────────────────────

export async function notifyOrderPlaced(orderId: string): Promise<void> {
  const order = await db.serviceOrder.findUnique({ where: { id: orderId } });
  if (!order) return;

  await sendWebPush(
    "New Crypto Order Placed",
    `${order.serviceName} — $${(order.priceCents / 100).toFixed(2)} ${order.cryptoNetwork}. Check your wallet, then approve.`,
    "/dashboard",
  );
}

export async function notifyOrderDelivered(orderId: string): Promise<void> {
  const order = await db.serviceOrder.findUnique({ where: { id: orderId } });
  if (!order) return;

  // Notify the owner via Web Push.
  await sendWebPush(
    "Order Delivered",
    `${order.serviceName} for ${order.customerEmail || "customer"} is ready. Download link sent.`,
    `/api/services/orders/${orderId}/deliverable`,
  );

  // Try to email the customer via Gmail Vision.
  if (order.customerEmail) {
    const downloadUrl = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/services/orders/${orderId}/deliverable`;
    const subject = `Your ARIA deliverable is ready: ${order.serviceName}`;
    const body = `Hi ${order.customerName || "there"},\n\nYour order is ready! Download your ${order.serviceName} here:\n${downloadUrl}\n\nThanks for using ARIA Mission Control.\n— The ARIA Team`;

    await sendGmailVision(order.customerEmail, subject, body);

    // Mark as notified.
    await db.serviceOrder.update({
      where: { id: orderId },
      data: {
        customerNotified: true,
        notificationLog: JSON.stringify({
          ts: new Date().toISOString(),
          method: "gmail-vision + web-push",
          customerEmail: order.customerEmail,
        }),
      },
    }).catch(() => {});
  }
}
