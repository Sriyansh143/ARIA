/**
 * POST /api/services/approve — Owner approves a pending crypto payment + triggers build.
 *
 * Body: { orderId: string }
 *
 * This route is PROTECTED (not in PUBLIC_API_PREFIXES) — only the
 * authenticated owner can approve orders.
 */
import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { approveOrder, rejectOrder } from "@/lib/services/crypto-checkout";
import { requirePermissionResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // v40: require owner/admin permission (was relying only on proxy JWT check)
  const [user, errorResponse] = await requirePermissionResponse("POST", "/api/services/approve");
  if (errorResponse) return errorResponse;

  let body: { orderId?: string; action?: "approve" | "reject"; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const orderId = body.orderId?.trim();
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const action = body.action || "approve";

  if (action === "reject") {
    const result = await rejectOrder(orderId, body.reason || "Payment not received");
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, orderId, status: "rejected" });
  }

  const result = await approveOrder(orderId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  logger.info("api.services.approve", { orderId, approvedBy: user!.id });
  return NextResponse.json({ ok: true, orderId, status: "building" });
}
