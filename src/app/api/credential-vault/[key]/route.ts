import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getCredential, deleteCredential } from "@/lib/credential-vault";
import { requirePermissionResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/credential-vault/[key]
 * v40: Owner-only. Decrypts and returns the plaintext.
 * This is the ONLY endpoint that ever returns the secret in cleartext.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  // v40: require owner permission (was unauthenticated — CRITICAL security fix)
  const [user, errorResponse] = await requirePermissionResponse("GET", "/api/credential-vault/key");
  if (errorResponse) return errorResponse;

  try {
    const { key } = await params;
    const result = await getCredential(key);
    if (!result) {
      return NextResponse.json(
        { error: "credential not found" },
        { status: 404 }
      );
    }
    logger.info("api.credential-vault.get.success", { key, userId: user!.id });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.credential-vault.get.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to decrypt credential" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/credential-vault/[key]
 * v40: Owner-only.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const [user, errorResponse] = await requirePermissionResponse("DELETE", "/api/credential-vault/key");
  if (errorResponse) return errorResponse;

  try {
    const { key } = await params;
    const result = await deleteCredential(key);
    if (!result.ok) {
      return NextResponse.json(
        { error: "credential not found or delete failed" },
        { status: 404 }
      );
    }
    logger.info("api.credential-vault.delete.success", { key, userId: user!.id });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("api.credential-vault.delete.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to delete credential" },
      { status: 500 }
    );
  }
}
