import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { logger } from "@/lib/logger"
import { requirePermissionResponse } from "@/lib/auth"
import { sendNotification } from "@/lib/email-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/services/refund
 * Body: { orderId, reason? }
 *
 * v40: Manual crypto refund flow. Crypto has no automated chargeback
 * webhooks, so refunds are owner-initiated. This route:
 *   1. Marks the ServiceOrder as "refunded"
 *   2. Revokes download access (deletes the deliverable files)
 *   3. Sends a "Refund Processed" notification to the customer via
 *      Resend + NotificationLog fallback
 *
 * Auth: owner-only (requirePermissionResponse).
 */
export async function POST(req: NextRequest) {
  // v40: owner-only
  const [user, errorResponse] = await requirePermissionResponse("POST", "/api/services/refund")
  if (errorResponse) return errorResponse

  try {
    const body = await req.json().catch(() => ({}))
    const orderId = String(body.orderId || "").trim()
    const reason = String(body.reason || "Refund processed by owner").trim()

    if (!orderId) {
      return NextResponse.json({ error: "orderId required" }, { status: 400 })
    }

    // 1. Fetch the order
    const order = await db.serviceOrder.findUnique({ where: { id: orderId } })
    if (!order) {
      return NextResponse.json({ error: "order not found" }, { status: 404 })
    }

    if (order.status === "refunded") {
      return NextResponse.json({ error: "order already refunded" }, { status: 400 })
    }

    // 2. Mark as refunded
    await db.serviceOrder.update({
      where: { id: orderId },
      data: {
        status: "refunded",
        buildLog: `${order.buildLog ?? ""}\n---\nRefunded by ${user!.email} at ${new Date().toISOString()}: ${reason}`,
      },
    })

    logger.info("api.services.refund.processed", {
      orderId,
      refundedBy: user!.id,
      reason,
      previousStatus: order.status,
    })

    // 3. Revoke download access — delete the deliverable files
    try {
      const { getOrderDir } = await import("@/lib/services/builder")
      const fs = await import("fs")
      const orderDir = getOrderDir(orderId)
      if (fs.existsSync(orderDir)) {
        fs.rmSync(orderDir, { recursive: true, force: true })
        logger.info("api.services.refund.access-revoked", { orderId, dir: orderDir })
      }
    } catch (err) {
      logger.warn("api.services.refund.revoke-failed", { orderId, error: String(err) })
      // Non-fatal — the order is marked refunded regardless
    }

    // 4. Send "Refund Processed" notification to the customer
    if (order.customerEmail) {
      try {
        await sendNotification({
          to: order.customerEmail,
          subject: `Refund Processed: ${order.serviceName}`,
          text: `Hi ${order.customerName || "there"},\n\nA refund has been processed for your order "${order.serviceName}".\n\nOrder ID: ${orderId}\nReason: ${reason}\n\nDownload access for this order has been revoked. If you have any questions, please reply to this email.\n\n— ARIA Mission Control`,
          metadata: { orderId, reason, type: "refund" },
        })
      } catch (err) {
        logger.warn("api.services.refund.notification-failed", { orderId, error: String(err) })
        // Non-fatal — the refund is recorded regardless
      }
    }

    return NextResponse.json({
      ok: true,
      orderId,
      status: "refunded",
      reason,
      accessRevoked: true,
    })
  } catch (err) {
    logger.error("api.services.refund.failed", { error: String(err) })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "refund failed" },
      { status: 500 },
    )
  }
}
