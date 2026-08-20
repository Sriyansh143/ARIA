import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { listCredentials, storeCredential } from "@/lib/credential-vault";

export const dynamic = "force-dynamic";

/**
 * GET /api/credential-vault?category=llm
 * Lists credentials (never returns ciphertext — only masked metadata).
 */
export async function GET(req: NextRequest) {
  try {
    const category = req.nextUrl.searchParams.get("category") ?? undefined;
    const credentials = await listCredentials(category);
    return NextResponse.json({ credentials, count: credentials.length });
  } catch (err) {
    logger.error("api.credential-vault.list.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to list credentials" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/credential-vault
 * Body: { key, label, category?, plaintext, metadata? }
 * Encrypts via AES-256-GCM and upserts by key.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.key || !body?.label || !body?.plaintext) {
      return NextResponse.json(
        { error: "key, label, plaintext required" },
        { status: 400 }
      );
    }
    const result = await storeCredential({
      key: String(body.key),
      label: String(body.label),
      category: body.category ? String(body.category) : "custom",
      plaintext: String(body.plaintext),
      metadata: body.metadata,
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.credential-vault.store.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to store credential" },
      { status: 500 }
    );
  }
}
