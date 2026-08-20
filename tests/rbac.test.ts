import { describe, test, expect } from "bun:test"
import { canAccess, getRoles, describeRole, OWNER_ONLY_ROUTES } from "../src/lib/rbac"

describe("RBAC Permission Matrix", () => {
  test("owner has full access to all routes", () => {
    expect(canAccess("owner", "GET", "/api/anything").allowed).toBe(true)
    expect(canAccess("owner", "POST", "/api/settings/env").allowed).toBe(true)
    expect(canAccess("owner", "POST", "/api/services/refund").allowed).toBe(true)
    expect(canAccess("owner", "DELETE", "/api/credential-vault/key").allowed).toBe(true)
  })

  test("admin can access operational routes but not owner-only", () => {
    // Admin can approve orders
    expect(canAccess("admin", "POST", "/api/services/approve").allowed).toBe(true)
    // Admin can GET anything
    expect(canAccess("admin", "GET", "/api/history").allowed).toBe(true)
    // Admin CANNOT access owner-only routes
    expect(canAccess("admin", "POST", "/api/settings/env").allowed).toBe(false)
    expect(canAccess("admin", "POST", "/api/services/refund").allowed).toBe(false)
    expect(canAccess("admin", "GET", "/api/credential-vault/key").allowed).toBe(false)
    expect(canAccess("admin", "DELETE", "/api/credential-vault/key").allowed).toBe(false)
  })

  test("viewer has read-only access", () => {
    // Viewer can GET
    expect(canAccess("viewer", "GET", "/api/history").allowed).toBe(true)
    // Viewer CANNOT POST/DELETE
    expect(canAccess("viewer", "POST", "/api/services/approve").allowed).toBe(false)
    expect(canAccess("viewer", "DELETE", "/api/notes/123").allowed).toBe(false)
    // Viewer CANNOT access owner-only
    expect(canAccess("viewer", "POST", "/api/settings/env").allowed).toBe(false)
  })

  test("unknown role is denied", () => {
    expect(canAccess("hacker", "GET", "/api/anything").allowed).toBe(false)
  })

  test("OWNER_ONLY_ROUTES includes the critical routes", () => {
    expect(OWNER_ONLY_ROUTES).toContain("POST:/api/settings/env")
    expect(OWNER_ONLY_ROUTES).toContain("POST:/api/services/refund")
    expect(OWNER_ONLY_ROUTES.some((r) => r.startsWith("GET:/api/credential-vault"))).toBe(true)
  })

  test("getRoles returns the 3 roles", () => {
    const roles = getRoles()
    expect(roles).toEqual(["owner", "admin", "viewer"])
    expect(roles.length).toBe(3)
  })

  test("describeRole returns a non-empty description", () => {
    for (const role of getRoles()) {
      const desc = describeRole(role)
      expect(desc.length).toBeGreaterThan(10)
    }
  })

  test("wildcard pattern matching works", () => {
    // "/api/services/*" should match "/api/services/orders/123"
    expect(canAccess("admin", "POST", "/api/services/orders/123").allowed).toBe(true)
    // But "/api/services/refund" is owner-only, so admin is blocked
    expect(canAccess("admin", "POST", "/api/services/refund").allowed).toBe(false)
  })
})
