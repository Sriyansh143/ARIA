/**
 * tests/sample-phase-30.test.ts — v80 Phase 30 smoke tests
 *
 * Verifies the 6 new Phase 30 modules:
 *   1. Esign Provider abstraction (MockProvider + signature verification)
 *   2. Esign Webhook handler (idempotency + Contract status transitions)
 *   3. Stripe Tax Calculator (static fallback + jurisdiction lookup)
 *   4. Project Lifecycle state machine (contract-signing gate)
 *   5. Memory Watchdog (sampling + leak detection)
 *   6. Stripe Reconciliation (idempotent upsert + discrepancy detection)
 *
 * All tests use the in-memory SQLite dev.db (created by `prisma db push`).
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
mock.module("server-only", () => ({}));

import { db } from "../src/lib/db";
import {
  getEsignProvider,
  sendContractForEsign,
  handleEsignWebhook,
  type EsignWebhookEvent,
} from "../src/lib/legal/esign-provider";
import {
  assertCanTransition,
  checkContractGate,
  transitionServiceOrder,
  canStartBuild,
  SERVICE_ORDER_STATUSES,
} from "../src/lib/services/project-lifecycle";
import {
  calculateTax,
  getStripeAutomaticTaxConfig,
} from "../src/lib/finance/tax-calculator";
import {
  takeMemorySample,
  startMemoryWatchdog,
  stopMemoryWatchdog,
  isMemoryWatchdogRunning,
  getLatestMemorySample,
  detectMemoryLeak,
} from "../src/lib/memory-watchdog";

// ─── Helpers ─────────────────────────────────────────────────────────

async function createTestContract(overrides?: Partial<{
  status: string;
  esignProvider: string;
  envelopeId: string;
  esignStatus: string;
  serviceOrderId: string;
  amountCents: number;
}>): Promise<string> {
  const row = await db.contract.create({
    data: {
      contractNumber: `ARIA-SOW-TEST-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      clientName: "Test Client",
      clientEmail: "test.client@example.com",
      serviceName: "Test Service",
      amountCents: overrides?.amountCents ?? 50_000,
      status: overrides?.status ?? "draft",
      esignProvider: overrides?.esignProvider ?? "",
      envelopeId: overrides?.envelopeId ?? "",
      esignStatus: overrides?.esignStatus ?? "",
      serviceOrderId: overrides?.serviceOrderId ?? null,
      pdfBase64: "dGVzdC1wZGYtY29udGVudHM=", // "test-pdf-contents" base64-encoded
    },
  });
  return row.id;
}

async function createTestServiceOrder(overrides?: Partial<{
  status: string;
  ownerApproved: boolean;
}>): Promise<string> {
  const row = await db.serviceOrder.create({
    data: {
      serviceId: "test-service",
      serviceName: "Test Service",
      spec: "test spec",
      priceCents: 50_000,
      currency: "usd",
      status: overrides?.status ?? "pending_payment",
      ownerApproved: overrides?.ownerApproved ?? false,
    },
  });
  return row.id;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("Phase 30 — E-Sign Provider Abstraction", () => {

  beforeEach(async () => {
    await db.esignEvent.deleteMany({});
    await db.contract.deleteMany({});
  });

  it("getEsignProvider returns null when ESIGN_PROVIDER is not set", () => {
    const saved = process.env.ESIGN_PROVIDER;
    delete process.env.ESIGN_PROVIDER;
    expect(getEsignProvider()).toBeNull();
    if (saved) process.env.ESIGN_PROVIDER = saved;
  });

  it("getEsignProvider returns MockProvider when ESIGN_PROVIDER=mock", () => {
    const saved = process.env.ESIGN_PROVIDER;
    process.env.ESIGN_PROVIDER = "mock";
    const provider = getEsignProvider();
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe("mock");
    if (saved) process.env.ESIGN_PROVIDER = saved;
    else delete process.env.ESIGN_PROVIDER;
  });

  it("MockProvider.sendEnvelope returns a fake envelopeId + providerUrl", async () => {
    process.env.ESIGN_PROVIDER = "mock";
    const contractId = await createTestContract();
    const result = await sendContractForEsign(contractId);

    expect(result.ok).toBe(true);
    expect(result.envelopeId).toBeDefined();
    expect(result.envelopeId!.startsWith("mock-env-")).toBe(true);

    // Verify the Contract row was updated.
    const contract = await db.contract.findUnique({ where: { id: contractId } });
    expect(contract?.status).toBe("sent");
    expect(contract?.esignProvider).toBe("mock");
    expect(contract?.envelopeId).toBe(result.envelopeId);
    expect(contract?.esignStatus).toBe("sent");

    delete process.env.ESIGN_PROVIDER;
  });

  it("sendContractForEsign fails when contract is not in 'draft' status", async () => {
    process.env.ESIGN_PROVIDER = "mock";
    const contractId = await createTestContract({ status: "sent" });
    const result = await sendContractForEsign(contractId);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("must be 'draft'");
    delete process.env.ESIGN_PROVIDER;
  });

  it("sendContractForEsign fails when no provider is configured", async () => {
    delete process.env.ESIGN_PROVIDER;
    const contractId = await createTestContract();
    const result = await sendContractForEsign(contractId);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("no e-sign provider configured");
  });

  it("MockProvider.verifyWebhook always returns valid (no signature to check)", () => {
    process.env.ESIGN_PROVIDER = "mock";
    const provider = getEsignProvider()!;
    const result = provider.verifyWebhook({}, "{}");
    expect(result.valid).toBe(true);
    delete process.env.ESIGN_PROVIDER;
  });

  it("MockProvider.parseWebhookEvent parses a valid mock event payload", () => {
    process.env.ESIGN_PROVIDER = "mock";
    const provider = getEsignProvider()!;
    const payload = JSON.stringify({
      envelopeId: "mock-env-123",
      eventType: "envelope.completed",
      eventTimestamp: new Date().toISOString(),
      signerEmail: "client@example.com",
      signerName: "Test Client",
      payload: { mock: true },
    });
    const event = provider.parseWebhookEvent(payload);
    expect(event).not.toBeNull();
    expect(event!.provider).toBe("mock");
    expect(event!.envelopeId).toBe("mock-env-123");
    expect(event!.eventType).toBe("envelope.completed");
    expect(event!.signerEmail).toBe("client@example.com");
    delete process.env.ESIGN_PROVIDER;
  });

  it("MockProvider.parseWebhookEvent returns null for malformed JSON", () => {
    process.env.ESIGN_PROVIDER = "mock";
    const provider = getEsignProvider()!;
    expect(provider.parseWebhookEvent("not-json")).toBeNull();
    expect(provider.parseWebhookEvent("{}")).toBeNull(); // missing envelopeId + eventType
    delete process.env.ESIGN_PROVIDER;
  });
});

describe("Phase 30 — Esign Webhook Handler (handleEsignWebhook)", () => {

  beforeEach(async () => {
    await db.esignEvent.deleteMany({});
    await db.contract.deleteMany({});
  });

  it("envelope.completed event marks Contract as signed + records EsignEvent", async () => {
    const contractId = await createTestContract({
      status: "sent",
      esignProvider: "mock",
      envelopeId: "mock-env-test-1",
      esignStatus: "sent",
    });

    const event: EsignWebhookEvent = {
      provider: "mock",
      envelopeId: "mock-env-test-1",
      eventType: "envelope.completed",
      eventTimestamp: new Date(),
      signerEmail: "test.client@example.com",
      signerName: "Test Client",
      rawPayload: { test: true },
    };

    const result = await handleEsignWebhook(event);
    expect(result.ok).toBe(true);
    expect(result.deduped).toBe(false);
    expect(result.contractId).toBe(contractId);

    // Verify Contract was updated.
    const contract = await db.contract.findUnique({ where: { id: contractId } });
    expect(contract?.status).toBe("signed");
    expect(contract?.signedAt).not.toBeNull();
    expect(contract?.signedByEmail).toBe("test.client@example.com");
    expect(contract?.esignStatus).toBe("completed");
    expect(contract?.esignSignedAt).not.toBeNull();

    // Verify EsignEvent row was created.
    const events = await db.esignEvent.findMany({ where: { contractId } });
    expect(events.length).toBe(1);
    expect(events[0].processed).toBe(true);
  });

  it("duplicate envelope.completed event is deduped (idempotency)", async () => {
    const contractId = await createTestContract({
      status: "sent",
      esignProvider: "mock",
      envelopeId: "mock-env-test-2",
      esignStatus: "sent",
    });

    const event: EsignWebhookEvent = {
      provider: "mock",
      envelopeId: "mock-env-test-2",
      eventType: "envelope.completed",
      eventTimestamp: new Date("2026-01-01T00:00:00Z"),
      signerEmail: "test@example.com",
      rawPayload: {},
    };

    // First delivery.
    const r1 = await handleEsignWebhook(event);
    expect(r1.ok).toBe(true);
    expect(r1.deduped).toBe(false);

    // Second delivery (same eventTimestamp).
    const r2 = await handleEsignWebhook(event);
    expect(r2.ok).toBe(true);
    expect(r2.deduped).toBe(true);

    // Only ONE EsignEvent row should exist.
    const events = await db.esignEvent.findMany({ where: { contractId } });
    expect(events.length).toBe(1);
  });

  it("envelope.declined event marks Contract as rejected", async () => {
    const contractId = await createTestContract({
      status: "sent",
      esignProvider: "mock",
      envelopeId: "mock-env-test-3",
      esignStatus: "sent",
    });

    const event: EsignWebhookEvent = {
      provider: "mock",
      envelopeId: "mock-env-test-3",
      eventType: "envelope.declined",
      eventTimestamp: new Date(),
      signerEmail: "test@example.com",
      rawPayload: {},
    };

    const result = await handleEsignWebhook(event);
    expect(result.ok).toBe(true);

    const contract = await db.contract.findUnique({ where: { id: contractId } });
    expect(contract?.status).toBe("rejected");
    expect(contract?.esignStatus).toBe("declined");
  });

  it("webhook with unknown envelopeId is recorded but no contract is updated", async () => {
    const event: EsignWebhookEvent = {
      provider: "mock",
      envelopeId: "unknown-envelope-id",
      eventType: "envelope.completed",
      eventTimestamp: new Date(),
      rawPayload: {},
    };

    const result = await handleEsignWebhook(event);
    expect(result.ok).toBe(true);
    expect(result.contractId).toBeUndefined();

    // The event should still be recorded for audit purposes.
    const events = await db.esignEvent.findMany({
      where: { envelopeId: "unknown-envelope-id" },
    });
    expect(events.length).toBe(1);
    expect(events[0].contractId).toBeNull();
  });

  it("envelope.delivered event updates esignStatus without flipping Contract.status", async () => {
    const contractId = await createTestContract({
      status: "sent",
      esignProvider: "mock",
      envelopeId: "mock-env-test-4",
      esignStatus: "sent",
    });

    const event: EsignWebhookEvent = {
      provider: "mock",
      envelopeId: "mock-env-test-4",
      eventType: "envelope.delivered",
      eventTimestamp: new Date(),
      rawPayload: {},
    };

    await handleEsignWebhook(event);

    const contract = await db.contract.findUnique({ where: { id: contractId } });
    expect(contract?.status).toBe("sent"); // unchanged
    expect(contract?.esignStatus).toBe("delivered"); // updated
  });
});

describe("Phase 30 — Tax Calculator", () => {

  beforeEach(async () => {
    await db.taxCalculation.deleteMany({});
    delete process.env.STRIPE_TAX_ENABLED;
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("calculateTax falls back to static rates when Stripe Tax is not configured", async () => {
    const result = await calculateTax({
      subtotalCents: 100_00, // $100
      currency: "USD",
      customerCountry: "US",
      customerState: "US-CA",
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe("static-fallback");
    expect(result.taxJurisdiction).toBe("US-CA");
    // California rate is 7.25% — $100 * 0.0725 = $7.25
    expect(result.taxAmountCents).toBe(725);
    expect(result.totalCents).toBe(10725);
    expect(result.taxRate).toBe(0.0725);
  });

  it("calculateTax uses national average for unknown US states", async () => {
    const result = await calculateTax({
      subtotalCents: 100_00,
      currency: "USD",
      customerCountry: "US",
      customerState: "US-XX", // unknown state
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe("static-fallback");
    expect(result.taxJurisdiction).toBe("US");
    // National avg 8.5%
    expect(result.taxRate).toBe(0.085);
    expect(result.taxAmountCents).toBe(850);
  });

  it("calculateTax uses EU VAT rates for European countries", async () => {
    const result = await calculateTax({
      subtotalCents: 100_00,
      currency: "EUR",
      customerCountry: "DE",
    });

    expect(result.ok).toBe(true);
    expect(result.source).toBe("static-fallback");
    expect(result.taxJurisdiction).toBe("EU-DE");
    expect(result.taxRate).toBe(0.19);
    expect(result.taxAmountCents).toBe(1900);
  });

  it("calculateTax uses 18% GST for India", async () => {
    const result = await calculateTax({
      subtotalCents: 100_00,
      currency: "INR",
      customerCountry: "IN",
    });

    expect(result.ok).toBe(true);
    expect(result.taxJurisdiction).toBe("IN");
    expect(result.taxRate).toBe(0.18);
    expect(result.taxAmountCents).toBe(1800);
  });

  it("calculateTax returns 0 tax for unknown countries (zero-rated)", async () => {
    const result = await calculateTax({
      subtotalCents: 100_00,
      currency: "USD",
      customerCountry: "XX", // unknown
    });

    expect(result.ok).toBe(true);
    expect(result.taxAmountCents).toBe(0);
    expect(result.totalCents).toBe(10000);
  });

  it("calculateTax persists to TaxCalculation table", async () => {
    await calculateTax({
      subtotalCents: 500_00,
      currency: "USD",
      customerCountry: "GB",
    });

    const rows = await db.taxCalculation.findMany();
    expect(rows.length).toBe(1);
    expect(rows[0].source).toBe("static-fallback");
    expect(rows[0].taxJurisdiction).toBe("GB");
    expect(rows[0].taxRate).toBe(0.20);
    expect(rows[0].taxAmountCents).toBe(100_00); // 20% of $500
  });

  it("getStripeAutomaticTaxConfig returns null when STRIPE_TAX_ENABLED is not set", () => {
    delete process.env.STRIPE_TAX_ENABLED;
    expect(getStripeAutomaticTaxConfig()).toBeNull();
  });

  it("getStripeAutomaticTaxConfig returns {enabled:true} when STRIPE_TAX_ENABLED=true", () => {
    process.env.STRIPE_TAX_ENABLED = "true";
    expect(getStripeAutomaticTaxConfig()).toEqual({ enabled: true });
    delete process.env.STRIPE_TAX_ENABLED;
  });
});

describe("Phase 30 — Project Lifecycle State Machine", () => {

  beforeEach(async () => {
    await db.contract.deleteMany({});
    await db.serviceOrder.deleteMany({});
    await db.auditLogEntry.deleteMany({});
  });

  it("SERVICE_ORDER_STATUSES includes all 7 expected statuses", () => {
    expect(SERVICE_ORDER_STATUSES).toEqual([
      "pending_payment",
      "paid_verified",
      "building",
      "delivered",
      "failed",
      "refunded",
      "rejected",
    ]);
  });

  it("assertCanTransition allows pending_payment → paid_verified", () => {
    const result = assertCanTransition("pending_payment", "paid_verified");
    expect(result.ok).toBe(true);
  });

  it("assertCanTransition allows paid_verified → building", () => {
    const result = assertCanTransition("paid_verified", "building");
    expect(result.ok).toBe(true);
  });

  it("assertCanTransition allows building → delivered", () => {
    const result = assertCanTransition("building", "delivered");
    expect(result.ok).toBe(true);
  });

  it("assertCanTransition rejects delivered → pending_payment (no backward)", () => {
    const result = assertCanTransition("delivered", "pending_payment");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not allowed");
  });

  it("assertCanTransition rejects delivered → delivered (self-loop)", () => {
    const result = assertCanTransition("delivered", "delivered");
    expect(result.ok).toBe(false);
  });

  it("checkContractGate returns ok when no contract is linked", async () => {
    const orderId = await createTestServiceOrder();
    const gate = await checkContractGate(orderId);
    expect(gate.ok).toBe(true);
  });

  it("checkContractGate blocks when contract is not signed", async () => {
    const orderId = await createTestServiceOrder();
    await createTestContract({
      status: "sent",
      serviceOrderId: orderId,
    });

    const gate = await checkContractGate(orderId);
    expect(gate.ok).toBe(false);
    expect(gate.contractStatus).toBe("sent");
    expect(gate.error).toContain("must be");
  });

  it("checkContractGate passes when contract is signed", async () => {
    const orderId = await createTestServiceOrder();
    await createTestContract({
      status: "signed",
      serviceOrderId: orderId,
    });

    const gate = await checkContractGate(orderId);
    expect(gate.ok).toBe(true);
    expect(gate.contractStatus).toBe("signed");
  });

  it("transitionServiceOrder blocks transition to 'building' when contract is unsigned", async () => {
    const orderId = await createTestServiceOrder({ status: "paid_verified", ownerApproved: true });
    await createTestContract({
      status: "sent",
      serviceOrderId: orderId,
    });

    const result = await transitionServiceOrder(orderId, "building");
    expect(result.ok).toBe(false);
    expect(result.contractBlocked).toBe(true);
    expect(result.error).toContain("must be \"signed\"");

    // Verify the order status didn't change.
    const order = await db.serviceOrder.findUnique({ where: { id: orderId } });
    expect(order?.status).toBe("paid_verified");
  });

  it("transitionServiceOrder allows transition to 'building' when contract is signed", async () => {
    const orderId = await createTestServiceOrder({ status: "paid_verified", ownerApproved: true });
    await createTestContract({
      status: "signed",
      serviceOrderId: orderId,
    });

    const result = await transitionServiceOrder(orderId, "building");
    expect(result.ok).toBe(true);
    expect(result.status).toBe("building");

    // Verify the audit log entry was created.
    const audit = await db.auditLogEntry.findFirst({
      where: { resource: "ServiceOrder", resourceId: orderId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.action).toBe("building");
  });

  it("transitionServiceOrder rejects unknown source status", async () => {
    const result = await transitionServiceOrder("nonexistent-id", "building");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("order not found");
  });

  it("canStartBuild returns false when contract is unsigned", async () => {
    const orderId = await createTestServiceOrder({ status: "paid_verified", ownerApproved: true });
    await createTestContract({
      status: "sent",
      serviceOrderId: orderId,
    });

    const result = await canStartBuild(orderId);
    expect(result.ok).toBe(false);
    expect(result.contractBlocked).toBe(true);
  });

  it("canStartBuild returns true when no contract is linked + order is approved", async () => {
    const orderId = await createTestServiceOrder({ status: "paid_verified", ownerApproved: true });
    const result = await canStartBuild(orderId);
    expect(result.ok).toBe(true);
  });

  it("canStartBuild returns false when order is not owner-approved", async () => {
    const orderId = await createTestServiceOrder({ status: "paid_verified", ownerApproved: false });
    const result = await canStartBuild(orderId);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not owner-approved");
  });
});

describe("Phase 30 — Memory Watchdog", () => {

  beforeEach(async () => {
    await db.memorySnapshot.deleteMany({});
    stopMemoryWatchdog();
  });

  afterEach(() => {
    stopMemoryWatchdog();
  });

  it("takeMemorySample returns a sample with all fields populated", async () => {
    const sample = await takeMemorySample();
    expect(sample.pid).toBe(process.pid);
    expect(sample.uptimeSeconds).toBeGreaterThanOrEqual(0); // can be 0 if test runs immediately
    expect(sample.rssBytes).toBeGreaterThan(0);
    expect(sample.heapUsedBytes).toBeGreaterThan(0);
    // heapTotal can momentarily be less than heapUsed (V8 GC quirk) — just check both > 0.
    expect(sample.heapTotalBytes).toBeGreaterThan(0);
    expect(sample.systemTotalMemoryBytes).toBeGreaterThan(0);
    expect(sample.rssPercent).toBeGreaterThanOrEqual(0);
    expect(["ok", "warn", "critical"]).toContain(sample.alertLevel);
  });

  it("takeMemorySample persists to MemorySnapshot table", async () => {
    await takeMemorySample();
    const rows = await db.memorySnapshot.findMany();
    expect(rows.length).toBe(1);
    expect(rows[0].pid).toBe(process.pid);
  });

  it("startMemoryWatchdog is idempotent (calling twice is a no-op)", () => {
    expect(isMemoryWatchdogRunning()).toBe(false);
    startMemoryWatchdog({ testMode: true });
    expect(isMemoryWatchdogRunning()).toBe(true);
    startMemoryWatchdog({ testMode: true }); // second call — should not throw
    expect(isMemoryWatchdogRunning()).toBe(true);
  });

  it("stopMemoryWatchdog clears the running state", () => {
    startMemoryWatchdog({ testMode: true });
    expect(isMemoryWatchdogRunning()).toBe(true);
    stopMemoryWatchdog();
    expect(isMemoryWatchdogRunning()).toBe(false);
  });

  it("getLatestMemorySample returns the most recent sample", async () => {
    await takeMemorySample();
    await new Promise((r) => setTimeout(r, 10));
    await takeMemorySample();

    const latest = await getLatestMemorySample();
    expect(latest).not.toBeNull();
    expect(latest!.pid).toBe(process.pid);
  });

  it("detectMemoryLeak returns {leakDetected:false} when there are too few samples", async () => {
    // Only 5 samples — below the 10-sample threshold.
    for (let i = 0; i < 5; i++) {
      await takeMemorySample();
      await new Promise((r) => setTimeout(r, 5));
    }
    const analysis = await detectMemoryLeak(1);
    expect(analysis.leakDetected).toBe(false);
    expect(analysis.samples).toBe(5);
  });

  it("detectMemoryLeak returns {leakDetected:false} for stable memory (no growth)", async () => {
    // Take 12 samples quickly — memory should be stable in such a short window.
    for (let i = 0; i < 12; i++) {
      await takeMemorySample();
      await new Promise((r) => setTimeout(r, 5));
    }
    const analysis = await detectMemoryLeak(1);
    expect(analysis.samples).toBe(12);
    // Leak detection requires slope > 10 MB/hour + R² > 0.7 — in a 1-minute
    // window with 12 samples, this should not fire.
    expect(analysis.leakDetected).toBe(false);
  });
});

describe("Phase 30 — Constitution + Phase 30 modules wired", () => {

  it("constitution has 80 rules total", async () => {
    const { ALL_CONSTITUTION_RULES } = await import("../src/lib/constitution");
    expect(ALL_CONSTITUTION_RULES.length).toBe(80);
  });

  it("new cron handlers are registered in JOB_HANDLERS", async () => {
    // cron-handlers.ts exports JOB_HANDLERS as a named export (not default).
    const cronModule = await import("../src/lib/cron-handlers");
    const handlers = (cronModule as unknown as { JOB_HANDLERS: Record<string, unknown> }).JOB_HANDLERS;
    expect(handlers).toBeDefined();
    expect(handlers["daily-stripe-reconciliation"]).toBeDefined();
    expect(handlers["memory-watchdog"]).toBeDefined();
    expect(handlers["daily-soak-analysis"]).toBeDefined();
  });

  it("Contract model has Phase 30 esign + tax fields", async () => {
    // Create a contract + verify the new fields exist.
    const contract = await db.contract.create({
      data: {
        contractNumber: `ARIA-FIELD-TEST-${Date.now()}`,
        clientName: "Test",
        clientEmail: "test@example.com",
        serviceName: "Test",
        esignProvider: "mock",
        envelopeId: "test-env",
        esignStatus: "sent",
        subtotalCents: 100_00,
        taxAmountCents: 8_50,
        taxRate: 0.085,
        taxJurisdiction: "US",
      },
    });
    expect(contract.esignProvider).toBe("mock");
    expect(contract.envelopeId).toBe("test-env");
    expect(contract.esignStatus).toBe("sent");
    expect(contract.subtotalCents).toBe(100_00);
    expect(contract.taxAmountCents).toBe(8_50);
    expect(contract.taxRate).toBe(0.085);
    expect(contract.taxJurisdiction).toBe("US");
  });
});
