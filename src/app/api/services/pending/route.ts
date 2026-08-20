/**
 * GET /api/services/pending — list pending crypto payments for the owner dashboard.
 */
import { NextResponse } from "next/server";
import { getPendingPayments } from "@/lib/services/crypto-checkout";

export const dynamic = "force-dynamic";

export async function GET() {
  const orders = await getPendingPayments();
  return NextResponse.json({ orders, count: orders.length });
}
