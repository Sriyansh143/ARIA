/**
 * GET /api/services/orders/[id] — get a single order's status + details.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await db.serviceOrder.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: order.id,
    serviceId: order.serviceId,
    serviceName: order.serviceName,
    spec: order.spec.length > 500 ? order.spec.slice(0, 500) + "…" : order.spec,
    priceCents: order.priceCents,
    currency: order.currency,
    status: order.status,
    cryptoNetwork: order.cryptoNetwork,
    walletAddress: order.walletAddress,
    cryptoTxHash: order.cryptoTxHash,
    ownerApproved: order.ownerApproved,
    ownerApprovedAt: order.ownerApprovedAt,
    customerEmail: order.customerEmail,
    customerName: order.customerName,
    fileCount: order.fileCount,
    files: JSON.parse(order.files || "[]"),
    buildProvider: order.buildProvider,
    buildModel: order.buildModel,
    buildLatencyMs: order.buildLatencyMs,
    buildLog: order.buildLog,
    createdAt: order.createdAt,
    deliveredAt: order.deliveredAt,
    downloadUrl: order.status === "delivered" && order.deliverablePath
      ? `/api/services/orders/${order.id}/deliverable`
      : null,
  });
}
