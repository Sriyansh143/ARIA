/**
 * src/lib/auth.ts — Convenience helpers for server-side auth (v40).
 *
 * Audit fix #2: requireOwner existed but 0/104 routes called it.
 * v40: Added requireRole() with RBAC integration + a 401/403 helper
 * for API routes. All sensitive routes now call these helpers.
 */
import "server-only"

import { getServerSession } from "next-auth"
import { NextResponse } from "next/server"
import { authOptions } from "@/lib/auth-options"
import { db } from "@/lib/db"
import { canAccess, type Role } from "@/lib/rbac"

export interface SessionUser {
  id: string
  email: string
  name?: string | null
  role: string
  requiresTwoFactor?: boolean
}

/** Get the current authenticated session. Returns null if not authenticated. */
export async function getSession(): Promise<SessionUser | null> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return null
    const u = session.user as any
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role ?? "viewer",
      requiresTwoFactor: u.requiresTwoFactor ?? false,
    }
  } catch {
    return null
  }
}

/** Require authentication. Throws if not authenticated. */
export async function requireAuth(): Promise<SessionUser> {
  const user = await getSession()
  if (!user) {
    throw new Error("Unauthorized: authentication required")
  }
  return user
}

/** Require owner or admin role. Throws if insufficient. */
export async function requireOwner(): Promise<SessionUser> {
  const user = await requireAuth()
  if (user.role !== "owner" && user.role !== "admin") {
    throw new Error("Forbidden: owner role required")
  }
  return user
}

/** Require specifically the owner role (not admin). Throws otherwise. */
export async function requireOwnerOnly(): Promise<SessionUser> {
  const user = await requireAuth()
  if (user.role !== "owner") {
    throw new Error("Forbidden: owner-only operation")
  }
  return user
}

/**
 * Require a specific role. Throws if the user's role doesn't match.
 */
export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await requireAuth()
  if (user.role !== role) {
    throw new Error(`Forbidden: ${role} role required (you are ${user.role})`)
  }
  return user
}

/**
 * v40 RBAC: Check if the current user can perform METHOD on PATH.
 * Returns the user if allowed, throws otherwise.
 */
export async function requirePermission(
  method: string,
  path: string,
): Promise<SessionUser> {
  const user = await requireAuth()
  const check = canAccess(user.role, method, path)
  if (!check.allowed) {
    throw new Error(`Forbidden: ${check.reason}`)
  }
  return user
}

/**
 * v40: Helper for API route handlers — wraps requirePermission and
 * returns a proper NextResponse on failure instead of throwing.
 *
 * Usage:
 *   const [user, errorResponse] = await requirePermissionResponse("POST", "/api/services/refund")
 *   if (errorResponse) return errorResponse
 *   // ... user is guaranteed to be authed + authorized
 */
export async function requirePermissionResponse(
  method: string,
  path: string,
): Promise<[SessionUser, null] | [null, Response]> {
  try {
    const user = await requirePermission(method, path)
    return [user, null]
  } catch (err) {
    const msg = err instanceof Error ? err.message : "auth failed"
    const status = msg.includes("Unauthorized") ? 401 : 403
    return [null, new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { "Content-Type": "application/json" },
    })]
  }
}

/**
 * v57: Simpler helper for route handlers that don't need the user object.
 * Returns a NextResponse on failure (to return immediately) or null on success.
 *
 * Usage:
 *   const auth = await requireAuthOrResponse("GET", "/api/...")
 *   if (auth) return auth
 *   // ... do the work
 */
export async function requireAuthOrResponse(
  method: string,
  path: string,
): Promise<NextResponse | null> {
  try {
    await requirePermission(method, path)
    return null
  } catch (err) {
    const msg = err instanceof Error ? err.message : "auth failed"
    const status = msg.includes("Unauthorized") ? 401 : 403
    return NextResponse.json({ error: msg }, { status })
  }
}

/** Get the user count (for bootstrap-mode detection on the login page). */
export async function getUserCount(): Promise<number> {
  try {
    return await db.user.count()
  } catch {
    return 0
  }
}
