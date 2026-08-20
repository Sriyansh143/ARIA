/**
 * GET /api/services/orders/[id]/deliverable — download the built zip.
 *
 * Returns the zip file as a binary download. Only available when the
 * order status is "delivered" and the zip file exists on disk.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import fs from "fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await db.serviceOrder.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }
  if (order.status !== "delivered") {
    return NextResponse.json(
      { error: `order is not delivered yet (status: ${order.status})` },
      { status: 409 },
    );
  }
  if (!order.deliverablePath || !fs.existsSync(order.deliverablePath)) {
    return NextResponse.json({ error: "deliverable file not found" }, { status: 404 });
  }

  const fileBuffer = fs.readFileSync(order.deliverablePath);
  const filename = `${order.serviceId}-${order.id}.zip`;

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(fileBuffer.length),
      "Cache-Control": "no-store",
    },
  });
}
