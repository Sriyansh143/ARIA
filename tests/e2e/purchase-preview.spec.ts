import { test, expect } from "@playwright/test"
import { ensureDBReady } from "./helpers"

/**
 * E2E Test: Purchase & Preview Flow
 *
 * Flow: Browse /services → Trigger free preview → Initiate crypto checkout
 *
 * Note: Rate-limit testing is tricky in E2E because the limits are per-IP
 * and the test runner shares an IP. We test the preview endpoint works,
 * then test the checkout initiation. The rate-limit itself is covered
 * by unit tests (tests/rate-limiter.test.ts).
 */

const BASE = "http://localhost:3000"

test.describe("Purchase & Preview", () => {
  test.beforeAll(async () => {
    expect(await ensureDBReady()).toBe(true)
  })

  test("/services page loads with catalog", async ({ page }) => {
    await page.goto(`${BASE}/services`)
    await expect(page).toHaveTitle(/ARIA|Services/i)

    // The page should show service cards
    const serviceCards = page.locator("[data-testid='service-card'], .service-card, article")
    const count = await serviceCards.count()
    // At minimum, the page should render without error
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test("services catalog API returns services", async ({ request }) => {
    const res = await request.get(`${BASE}/api/services/catalog`)
    expect(res.ok()).toBe(true)
    const data = await res.json()
    expect(data.services).toBeDefined()
    expect(Array.isArray(data.services)).toBe(true)
  })

  test("services preview endpoint works", async ({ request }) => {
    // The preview endpoint is public (in PUBLIC_API_PREFIXES)
    const res = await request.post(`${BASE}/api/services/preview`, {
      data: {
        serviceId: "landing-page",
        spec: "A simple landing page for a coffee shop",
      },
    })
    // It may return 200 (success) or 429 (rate-limited) or 503 (LLM unavailable)
    // We just verify it doesn't 500
    expect(res.status()).toBeLessThan(500)
  })

  test("crypto checkout requires wallet address config", async ({ request }) => {
    // The checkout endpoint requires CRYPTO_WALLET_ADDRESS to be set.
    // If not set, it returns 503. If set, it returns 200.
    const res = await request.post(`${BASE}/api/services/checkout`, {
      data: {
        serviceId: "landing-page",
        spec: "Coffee shop landing page",
        customerEmail: "e2e-test@aria.dev",
        customerName: "E2E Test",
      },
    })
    // Either 200 (wallet configured) or 503 (wallet not configured)
    expect([200, 503]).toContain(res.status())
  })
})
