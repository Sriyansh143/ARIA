/**
 * GET /api/services/orders — list orders for the current session.
 *
 * Query params:
 *   ?email=user@example.com  — filter by customer email (for guests)
 *   ?status=pending_payment  — filter by status
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  const status = req.nextUrl.searchParams.get("status");
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10) || 50, 200);

  const where: any = {};
  if (email) where.customerEmail = email;
  if (status) where.status = status;

  const orders = await db.serviceOrder.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      serviceId: true,
      serviceName: true,
      spec: true,
      priceCents: true,
      currency: true,
      status: true,
      cryptoNetwork: true,
      walletAddress: true,
      cryptoTxHash: true,
      ownerApproved: true,
      ownerApprovedAt: true,
      customerEmail: true,
      customerName: true,
      fileCount: true,
      files: true,
      buildProvider: true,
      buildModel: true,
      buildLatencyMs: true,
      createdAt: true,
      deliveredAt: true,
    },
  });

  return NextResponse.json({ orders, count: orders.length });
}
