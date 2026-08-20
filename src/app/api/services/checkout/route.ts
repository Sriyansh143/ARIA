/**
 * POST /api/services/checkout — Create a crypto payment order.
 *
 * Request body:
 *   { serviceId: string, spec: string, customerEmail?: string, customerName?: string, cryptoTxHash?: string }
 *
 * Response:
 *   200: { orderId, walletAddress, cryptoNetwork, priceUsd, qrCodeUrl, status }
 *   400: { error: string }
 *   503: { error: "Crypto not configured" }
 *
 * The customer is shown a QR code for the wallet address. They send crypto
 * from their wallet app. The owner manually verifies the payment and clicks
 * "Approve & Build" in the dashboard.
 */
import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { createCryptoOrder } from "@/lib/services/crypto-checkout";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Check if crypto payments are configured.
  if (!process.env.CRYPTO_WALLET_ADDRESS) {
    return NextResponse.json(
      { error: "Crypto payments not configured. Set CRYPTO_WALLET_ADDRESS in .env." },
      { status: 503 },
    );
  }

  let body: {
    serviceId?: unknown;
    spec?: unknown;
    customerEmail?: unknown;
    customerName?: unknown;
    cryptoTxHash?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const serviceId = typeof body.serviceId === "string" ? body.serviceId : "";
  const spec = typeof body.spec === "string" ? body.spec.trim() : "";
  const customerEmail = typeof body.customerEmail === "string" ? body.customerEmail : undefined;
  const customerName = typeof body.customerName === "string" ? body.customerName : undefined;
  const cryptoTxHash = typeof body.cryptoTxHash === "string" ? body.cryptoTxHash : undefined;

  const result = await createCryptoOrder({ serviceId, spec, customerEmail, customerName, cryptoTxHash });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result.order);
}
