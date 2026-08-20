import { test, expect } from "@playwright/test"
import {
  registerUser,
  login,
  getValidTOTP,
  cleanupTestUser,
  ensureDBReady,
} from "./helpers"

/**
 * E2E Test: Auth & 2FA Flow
 *
 * Flow: Register → Login → Enable 2FA → Logout → Login with TOTP
 *
 * The TOTP is "mocked" by reading the secret directly from the test DB
 * + computing a valid code using the same RFC 6238 algorithm.
 */

const TEST_EMAIL = `e2e-auth-${Date.now()}@aria-test.dev`
const TEST_PASSWORD = "TestPass123!"
const BASE = "http://localhost:3000"

test.describe("Auth & 2FA", () => {
  test.beforeAll(async () => {
    // Ensure the server + DB are up
    expect(await ensureDBReady()).toBe(true)
    // Clean up any existing test user
    await cleanupTestUser(TEST_EMAIL)
  })

  test.afterAll(async () => {
    await cleanupTestUser(TEST_EMAIL)
  })

  test("register a new user", async ({ request }) => {
    const result = await registerUser(TEST_EMAIL, TEST_PASSWORD, "E2E Test User")
    expect(result.ok).toBe(true)
  })

  test("login without 2FA succeeds", async ({ request }) => {
    const res = await login(request, TEST_EMAIL, TEST_PASSWORD)
    expect(res.ok()).toBe(true)

    // Verify session is active
    const sessionRes = await request.get(`${BASE}/api/auth/session`)
    const session = await sessionRes.json()
    expect(session.user).toBeTruthy()
    expect(session.user.email).toBe(TEST_EMAIL)
  })

  test("enable 2FA via setup + verify", async ({ request }) => {
    // Login first
    await login(request, TEST_EMAIL, TEST_PASSWORD)

    // Setup 2FA
    const setupRes = await request.post(`${BASE}/api/2fa/setup`)
    expect(setupRes.ok()).toBe(true)
    const setupData = await setupRes.json()
    expect(setupData.secret).toBeTruthy()
    expect(setupData.qrUri).toContain("otpauth://")
    expect(setupData.backupCodes).toHaveLength(5)

    // Compute a valid TOTP from the secret
    const validTOTP = getValidTOTP(TEST_EMAIL)
    expect(validTOTP).toMatch(/^\d{6}$/)

    // Verify the TOTP
    const verifyRes = await request.post(`${BASE}/api/2fa/verify`, {
      data: { token: validTOTP },
    })
    expect(verifyRes.ok()).toBe(true)
    const verifyData = await verifyRes.json()
    expect(verifyData.enabled).toBe(true)

    // Check status
    const statusRes = await request.get(`${BASE}/api/2fa/status`)
    const statusData = await statusRes.json()
    expect(statusData.enabled).toBe(true)
  })

  test("login without TOTP fails when 2FA is enabled", async ({ request, browser }) => {
    // Create a fresh context (no cookies)
    const ctx = await browser.newContext()
    const newRequest = ctx.request

    // Try to login without TOTP — should return requiresTwoFactor
    const res = await login(newRequest, TEST_EMAIL, TEST_PASSWORD)
    // NextAuth returns 200 on the callback but the session won't be fully active
    // The proxy.ts will block access to protected routes with 403

    // Try to access a protected API route
    const protectedRes = await newRequest.get(`${BASE}/api/history`)
    expect([401, 403]).toContain(protectedRes.status())

    await ctx.close()
  })

  test("login with valid TOTP succeeds", async ({ request, browser }) => {
    // Fresh context
    const ctx = await browser.newContext()
    const newRequest = ctx.request

    // Get a fresh TOTP (the previous one may have expired)
    const validTOTP = getValidTOTP(TEST_EMAIL)

    // Login with TOTP
    const res = await login(newRequest, TEST_EMAIL, TEST_PASSWORD, validTOTP)
    expect(res.ok()).toBe(true)

    // Verify session is active
    const sessionRes = await newRequest.get(`${BASE}/api/auth/session`)
    const session = await sessionRes.json()
    expect(session.user).toBeTruthy()
    expect(session.user.email).toBe(TEST_EMAIL)

    // Verify we can access protected routes now
    const protectedRes = await newRequest.get(`${BASE}/api/history`)
    expect(protectedRes.ok()).toBe(true)

    await ctx.close()
  })

  test("disable 2FA", async ({ request }) => {
    // Login with TOTP
    const validTOTP = getValidTOTP(TEST_EMAIL)
    await login(request, TEST_EMAIL, TEST_PASSWORD, validTOTP)

    // Disable with a valid TOTP
    const freshTOTP = getValidTOTP(TEST_EMAIL)
    const disableRes = await request.post(`${BASE}/api/2fa/disable`, {
      data: { token: freshTOTP },
    })
    expect(disableRes.ok()).toBe(true)
    const data = await disableRes.json()
    expect(data.enabled).toBe(false)

    // Verify 2FA is disabled
    const statusRes = await request.get(`${BASE}/api/2fa/status`)
    const statusData = await statusRes.json()
    expect(statusData.enabled).toBe(false)
  })
})
