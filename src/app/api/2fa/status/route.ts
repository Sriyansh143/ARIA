import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getSession } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/2fa/status
 *
 * v40: Returns 2FA enrollment status from the User model (not Setting table).
 * Public route (needed for pre-login check via ?email= param).
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const emailParam = url.searchParams.get("email")?.toLowerCase().trim()

    // If we have a session, use it.
    const session = await getSession()
    if (session) {
      const user = await db.user.findUnique({ where: { id: session.id } })
      return NextResponse.json({
        authenticated: true,
        hasSecret: Boolean(user?.twoFactorSecret),
        enabled: Boolean(user?.twoFactorEnabled),
      })
    }

    // Pre-login check: does this email need a TOTP?
    if (emailParam) {
      const user = await db.user.findUnique({ where: { email: emailParam } })
      return NextResponse.json({
        authenticated: false,
        userExists: Boolean(user),
        requiresTwoFactor: Boolean(user?.twoFactorEnabled),
      })
    }

    return NextResponse.json({ authenticated: false, userExists: false, requiresTwoFactor: false })
  } catch (err) {
    console.error("[api/2fa/status]", err)
    return NextResponse.json({ error: "failed to read 2FA status" }, { status: 500 })
  }
}
