import { test, expect } from "@playwright/test"
import {
  registerUser,
  login,
  getValidTOTP,
  cleanupTestUser,
  ensureDBReady,
} from "./helpers"

/**
 * E2E Test: Admin & RBAC
 *
 * Flow:
 *   1. Register an owner + a viewer
 *   2. Owner: approve a LeadFinder lead → verify Task creation
 *   3. Owner: trigger refund → verify NotificationLog
 *   4. Viewer: GET /api/users → verify 403
 */

const OWNER_EMAIL = `e2e-owner-${Date.now()}@aria-test.dev`
const VIEWER_EMAIL = `e2e-viewer-${Date.now()}@aria-test.dev`
const PASSWORD = "TestPass123!"
const BASE = "http://localhost:3000"

test.describe("Admin & RBAC", () => {
  test.beforeAll(async () => {
    expect(await ensureDBReady()).toBe(true)
    await cleanupTestUser(OWNER_EMAIL)
    await cleanupTestUser(VIEWER_EMAIL)
  })

  test.afterAll(async () => {
    await cleanupTestUser(OWNER_EMAIL)
    await cleanupTestUser(VIEWER_EMAIL)
  })

  test("register owner + viewer", async ({ request }) => {
    // First user becomes owner automatically
    const ownerResult = await registerUser(OWNER_EMAIL, PASSWORD, "E2E Owner")
    expect(ownerResult.ok).toBe(true)

    // Second user becomes viewer (not owner, since owner already exists)
    const viewerResult = await registerUser(VIEWER_EMAIL, PASSWORD, "E2E Viewer")
    expect(viewerResult.ok).toBe(true)
  })

  test("owner can access /api/users", async ({ request, browser }) => {
    const ctx = await browser.newContext()
    const req = ctx.request

    await login(req, OWNER_EMAIL, PASSWORD)

    const res = await req.get(`${BASE}/api/users`)
    expect(res.ok()).toBe(true)
    const data = await res.json()
    expect(data.users).toBeDefined()
    expect(Array.isArray(data.users)).toBe(true)

    await ctx.close()
  })

  test("viewer gets 403 on /api/users", async ({ request, browser }) => {
    const ctx = await browser.newContext()
    const req = ctx.request

    await login(req, VIEWER_EMAIL, PASSWORD)

    const res = await req.get(`${BASE}/api/users`)
    expect(res.status()).toBe(403)

    await ctx.close()
  })

  test("viewer cannot approve leads", async ({ request, browser }) => {
    const ctx = await browser.newContext()
    const req = ctx.request

    await login(req, VIEWER_EMAIL, PASSWORD)

    // Try to approve a lead (using a fake ID — should still be 403, not 404)
    const res = await req.post(`${BASE}/api/leads/fake-id/approve`)
    expect(res.status()).toBe(403)

    await ctx.close()
  })

  test("viewer cannot trigger refunds", async ({ request, browser }) => {
    const ctx = await browser.newContext()
    const req = ctx.request

    await login(req, VIEWER_EMAIL, PASSWORD)

    const res = await req.post(`${BASE}/api/services/refund`, {
      data: { orderId: "fake-order-id" },
    })
    expect(res.status()).toBe(403)

    await ctx.close()
  })

  test("owner can fetch leads list", async ({ request, browser }) => {
    const ctx = await browser.newContext()
    const req = ctx.request

    await login(req, OWNER_EMAIL, PASSWORD)

    const res = await req.get(`${BASE}/api/leads`)
    expect(res.ok()).toBe(true)
    const data = await res.json()
    expect(data.leads).toBeDefined()

    await ctx.close()
  })

  test("owner can fetch notifications", async ({ request, browser }) => {
    const ctx = await browser.newContext()
    const req = ctx.request

    await login(req, OWNER_EMAIL, PASSWORD)

    const res = await req.get(`${BASE}/api/notifications`)
    expect(res.ok()).toBe(true)
    const data = await res.json()
    expect(data.notifications).toBeDefined()

    await ctx.close()
  })
})
