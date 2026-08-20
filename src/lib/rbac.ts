/**
 * src/lib/rbac.ts — Role-Based Access Control (v40)
 *
 * Permission matrix mapping roles (owner | admin | viewer) to allowed
 * API route patterns. Used by requireAuth() / requireOwner() helpers
 * which are wired into all sensitive API routes.
 *
 * Roles:
 *   owner  — full access (create user, delete, refund, settings, vault)
 *   admin  — operational access (approve orders, manage agents, trigger builds)
 *   viewer — read-only access (dashboard, metrics, history)
 *
 * Permission resolution:
 *   1. Check if the route is in the user's allowed list (wildcard match)
 *   2. If not, deny with 403 Forbidden
 *
 * Bootstrap: the first user to sign up becomes 'owner' automatically
 * (auth-options.ts:179-200). Additionally, if ARIA_OWNER_EMAIL env var
 * is set, that email bypasses the user-count check and becomes owner
 * on first signup — prevents lockout after enabling strict RBAC.
 */

import "server-only"

export type Role = "owner" | "admin" | "viewer"

export interface PermissionCheck {
  allowed: boolean
  reason?: string
}

/**
 * Route patterns each role can access.
 * Patterns use trailing-wildcard matching: "/api/services/*" matches
 * any path starting with "/api/services/".
 *
 * NOTE: This is a SECONDARY check. The primary auth gate is in proxy.ts
 * (JWT validation). This matrix adds role-based granularity on top.
 */
const PERMISSIONS: Record<Role, string[]> = {
  owner: [
    "*", // full access
  ],
  admin: [
    // Read-mostly + operational mutations
    "GET:/api/*",
    "POST:/api/services/approve",
    "POST:/api/services/orders/*",
    "POST:/api/tasks/*",
    "POST:/api/approvals/*",
    "POST:/api/cron/*/run",
    "POST:/api/agents/*",
    "POST:/api/deals/*",
    "POST:/api/crm/*",
    "POST:/api/workflows/*",
    "POST:/api/notes/*",
    "POST:/api/milestones/*",
    "POST:/api/goals/*",
    "POST:/api/training/*",
    "POST:/api/hermes/*",
    "POST:/api/learning/*",
    "POST:/api/simulator/*",
    "POST:/api/business-lifecycle/*",
    "POST:/api/telephony/*",
    "POST:/api/cash-claw",
    "POST:/api/failure-alchemy",
    "POST:/api/debate/*",
    "POST:/api/multi-company-cycles",
    "PATCH:/api/notes/*",
    "DELETE:/api/notes/*",
    "DELETE:/api/history/*",
    "PATCH:/api/history",
  ],
  viewer: [
    // Read-only
    "GET:/api/*",
  ],
}

/**
 * The "sensitive" routes that require owner role (not just any authed user).
 * These are the routes the v39 audit flagged as publicly callable.
 */
export const OWNER_ONLY_ROUTES = [
  "POST:/api/settings/env",
  "POST:/api/settings",
  "GET:/api/credential-vault",           // list (masked)
  "POST:/api/credential-vault",           // create
  "GET:/api/credential-vault/*",          // read plaintext (MOST sensitive)
  "DELETE:/api/credential-vault/*",
  "POST:/api/services/refund",           // refund flow
  "DELETE:/api/services/orders/*",
  "POST:/api/system-access/approvals/*/decide",
  "POST:/api/system-access/request",
  "POST:/api/seed",
  "POST:/api/sample-data",
  "DELETE:/api/users/*",                 // user management (future)
  "POST:/api/export",
]

/**
 * Check if a role can perform METHOD on PATH.
 */
export function canAccess(
  role: string,
  method: string,
  path: string,
): PermissionCheck {
  const r = (role as Role) || "viewer"
  const perms = PERMISSIONS[r]
  if (!perms) return { allowed: false, reason: `unknown role: ${role}` }

  const methodPath = `${method.toUpperCase()}:${path}`

  // Owner has full access
  if (perms.includes("*")) return { allowed: true }

  // Check owner-only routes first
  const isOwnerOnly = OWNER_ONLY_ROUTES.some((pattern) =>
    matchPattern(pattern, methodPath),
  )
  if (isOwnerOnly && r !== "owner") {
    return { allowed: false, reason: "owner role required for this route" }
  }

  // Check role permissions
  for (const pattern of perms) {
    if (matchPattern(pattern, methodPath)) {
      return { allowed: true }
    }
  }

  return { allowed: false, reason: `${r} role cannot ${method} ${path}` }
}

/**
 * Match a permission pattern against a method:path string.
 * Patterns:
 *   "*"                         → matches everything
 *   "GET:/api/*"                → matches any GET /api/...
 *   "POST:/api/services/*"      → matches POST /api/services/anything
 *   "DELETE:/api/notes/*"       → matches DELETE /api/notes/anything
 */
function matchPattern(pattern: string, methodPath: string): boolean {
  if (pattern === "*") return true

  // Split pattern into method + path
  const [pMethod, pPath] = pattern.split(":")
  const [mMethod, mPath] = methodPath.split(":")

  if (pMethod !== mMethod && pMethod !== "*") return false

  // Wildcard path matching
  if (pPath.endsWith("/*")) {
    const prefix = pPath.slice(0, -2)
    return mPath === prefix || mPath.startsWith(prefix + "/")
  }

  // Exact path match
  return pPath === mPath
}

/**
 * Get the list of all roles (for UI dropdowns / display).
 */
export function getRoles(): Role[] {
  return ["owner", "admin", "viewer"]
}

/**
 * Human-readable description of a role.
 */
export function describeRole(role: string): string {
  switch (role) {
    case "owner":
      return "Full access — can manage users, settings, credentials, refunds, and all operations."
    case "admin":
      return "Operational access — can approve orders, manage agents, trigger builds, and run day-to-day operations."
    case "viewer":
      return "Read-only access — can view dashboards, metrics, and history but cannot modify anything."
    default:
      return "Unknown role."
  }
}
