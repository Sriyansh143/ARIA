import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { logger } from "@/lib/logger"
import {
  generateSecret,
  generateQRCodeURI,
  generateBackupCodes,
  hashBackupCodes,
} from "@/lib/two-factor"
import { requireAuth } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/2fa/setup
 *
 * v40: Stores the TOTP secret + 5 hashed backup codes on the User model
 * (not the Setting table). Returns { secret, qrUri, backupCodes }.
 * The backupCodes are plaintext — only shown ONCE at setup time.
 *
 * Auth: requires authenticated session.
 */
export async function POST() {
  try {
    const user = await requireAuth()

    const secret = generateSecret()
    if (!secret) {
      logger.error("api.2fa.setup.secret-failed", { userId: user.id })
      return NextResponse.json({ error: "failed to generate TOTP secret" }, { status: 500 })
    }

    const qrUri = generateQRCodeURI(secret, user.email)

    // Generate 5 one-time backup codes + hash them for storage.
    const backupCodes = generateBackupCodes(5)
    const hashedCodes = await hashBackupCodes(backupCodes)

    // Store secret (not yet enabled) + hashed backup codes on the User.
    await db.user.update({
      where: { id: user.id },
      data: {
        twoFactorSecret: secret,
        twoFactorBackupCodes: JSON.stringify(hashedCodes),
      },
    })

    logger.info("api.2fa.setup.generated", { userId: user.id, backupCodeCount: backupCodes.length })
    return NextResponse.json({ secret, qrUri, backupCodes })
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    logger.error("api.2fa.setup.failed", { error: String(err) })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to set up 2FA" },
      { status: 500 },
    )
  }
}
