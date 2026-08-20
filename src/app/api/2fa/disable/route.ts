import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { logger } from "@/lib/logger"
import { verifyTOTP, verifyBackupCode } from "@/lib/two-factor"
import { requireAuth } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/2fa/disable
 * Body: { token } — current TOTP code OR a backup code (to confirm identity)
 *
 * v40: Disables 2FA for the current user. Requires a valid TOTP token or
 * backup code as confirmation (prevents accidental/malicious disable).
 * Clears the secret + backup codes + sets twoFactorEnabled=false.
 *
 * Auth: requires authenticated session.
 */
export async function POST(req: Request) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const token = String(body.token || "").trim()

    if (!token) {
      return NextResponse.json({ error: "token required (current TOTP or backup code)" }, { status: 400 })
    }

    const dbUser = await db.user.findUnique({ where: { id: user.id } })
    if (!dbUser?.twoFactorEnabled) {
      return NextResponse.json({ ok: false, error: "2FA is not currently enabled" }, { status: 400 })
    }

    // Try TOTP first
    let verified = false
    if (dbUser.twoFactorSecret) {
      verified = verifyTOTP(dbUser.twoFactorSecret, token, 1)
    }

    // If TOTP failed, try backup codes
    if (!verified && dbUser.twoFactorBackupCodes) {
      try {
        const hashedCodes = JSON.parse(dbUser.twoFactorBackupCodes) as string[]
        const matchIdx = await verifyBackupCode(token, hashedCodes)
        if (matchIdx >= 0) {
          // Remove the used backup code
          hashedCodes.splice(matchIdx, 1)
          verified = true
          logger.info("api.2fa.disable.backup-code-used", { userId: user.id, remaining: hashedCodes.length })
        }
      } catch {
        // JSON parse error — ignore
      }
    }

    if (!verified) {
      logger.warn("api.2fa.disable.rejected", { userId: user.id })
      return NextResponse.json({ ok: false, error: "invalid token or backup code" }, { status: 403 })
    }

    // Disable 2FA + clear secret + backup codes
    await db.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: "[]",
      },
    })

    logger.success("api.2fa.disable.success", { userId: user.id })
    return NextResponse.json({ ok: true, enabled: false })
  } catch (err) {
    if (String(err).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    logger.error("api.2fa.disable.failed", { error: String(err) })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to disable 2FA" },
      { status: 500 },
    )
  }
}
