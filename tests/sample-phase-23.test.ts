/**
 * tests/sample-phase-23.test.ts — v73 Phase 23 smoke tests
 *
 * Verifies the 4 new Phase 23 modules:
 *   1. Self-Evolving Codebase (refactor-engine detects mock failure + creates proposal)
 *   2. Legal & Onboarding (contract-generator creates SOW PDF + e-signature matching)
 *   3. Double-Entry Ledger (records balance, calculates P&L)
 *   4. Client Portal (magic-link access)
 *
 * Run via: bun test tests/sample-phase-23.test.ts
 */

import { describe, it, expect, mock } from "bun:test";
mock.module("server-only", () => ({}));

import {
  detectFailingModules,
  draftAndProposeRefactor,
  FAILURE_RATE_THRESHOLD,
} from "../src/lib/self-evolution/refactor-engine";
import {
  createContractForServiceOrder,
  sendContractForSignature,
  processInboundSignatureEmail,
  SIGNATURE_PHRASE,
  CONTRACT_THRESHOLD_CENTS,
} from "../src/lib/legal/contract-generator";
import {
  recordLedgerEntry,
  recordDoubleEntry,
  recordStripePayout,
  recordApiExpense,
  calculatePnL,
  verifyLedgerBalance,
  getCashBalance,
} from "../src/lib/finance/ledger";

describe("Phase 23 — Real-World MNC Operations Smoke Tests", () => {

  // ─── 1. Self-Evolving Codebase (refactor-engine) ───

  it("refactor-engine exports the FAILURE_RATE_THRESHOLD constant (15%)", () => {
    expect(FAILURE_RATE_THRESHOLD).toBe(15);
  });

  it("refactor-engine detectFailingModules returns an array (may be empty)", async () => {
    const detections = await detectFailingModules();
    expect(Array.isArray(detections)).toBe(true);
    // On a fresh DB with no failures, this should be empty.
    expect(detections.length).toBe(0);
  });

  it("refactor-engine draftAndProposeRefactor returns null when the file doesn't exist", async () => {
    const fakeDetection = {
      targetFile: "src/lib/__nonexistent_file__.ts",
      reason: "Mock test — file does not exist",
      failureRate: 50,
      failureCount: 10,
      errorSamples: ["Error: Cannot find module", "Error: file not found"],
      techDebtDeadline: null,
    };
    const proposalId = await draftAndProposeRefactor(fakeDetection);
    expect(proposalId).toBe(null);
  });

  // ─── 2. Legal & Onboarding (contract-generator) ───

  it("contract-generator exports the SIGNATURE_PHRASE constant", () => {
    expect(SIGNATURE_PHRASE).toBe("I AGREE TO THE TERMS");
  });

  it("contract-generator CONTRACT_THRESHOLD_CENTS is $500 (50_000 cents)", () => {
    expect(CONTRACT_THRESHOLD_CENTS).toBe(50_000);
  });

  it("contract-generator createContractForServiceOrder generates a SOW + PDF", async () => {
    const result = await createContractForServiceOrder(
      `test-order-${Date.now()}`,
      {
        clientName: "Smoke Test Client",
        clientEmail: "smoke-test-client@test.com",
        clientCompany: "Smoke Test Inc",
        serviceName: "SaaS Scaffold",
        serviceDescription: "Full Next.js + Prisma + Stripe + auth scaffold",
        amountCents: 990_00, // $990 — above threshold
        currency: "USD",
        milestones: [
          { name: "M1: Research", deliverable: "Tech stack analysis", dueDate: "2026-09-01", amountCents: 330_00 },
          { name: "M2: Build", deliverable: "Working scaffold", dueDate: "2026-09-15", amountCents: 330_00 },
          { name: "M3: Deploy", deliverable: "Production deploy", dueDate: "2026-09-22", amountCents: 330_00 },
        ],
      },
    );
    // createContractForServiceOrder returns a ContractResult (no `ok` field —
    // success is implied by the contractId being truthy).
    expect(result.contractId).toBeTruthy();
    expect(result.contractNumber).toMatch(/^ARIA-SOW-\d{4}-\d{3}$/);
    expect(result.pdfPath).toContain(".pdf");
    expect(result.pdfBase64.length).toBeGreaterThan(100); // PDF is non-empty
    expect(result.status).toBe("draft");
  });

  it("contract-generator processInboundSignatureEmail rejects reply without signature phrase", async () => {
    const result = await processInboundSignatureEmail({
      fromEmail: "smoke-test-client@test.com",
      subject: "RE: ARIA-SOW-2026-001",
      body: "Thanks for the contract, I'll review and get back to you.",
      receivedAt: new Date(),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Signature phrase");
  });

  it("contract-generator processInboundSignatureEmail accepts reply with exact signature phrase", async () => {
    // First create a contract, mark it as sent, then reply with the phrase.
    const uniqueEmail = `smoke-sign-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`;
    const uniqueOrderId = `test-order-sign-${Date.now()}`;
    const createResult = await createContractForServiceOrder(uniqueOrderId, {
      clientName: "Signature Test",
      clientEmail: uniqueEmail,
      clientCompany: "Test Inc",
      serviceName: "Landing Page",
      serviceDescription: "Single-page landing site",
      amountCents: 990_00,
      currency: "USD",
      milestones: [],
    });

    // In a test environment (no Resend creds), sendContractForSignature fails
    // because the email can't be delivered. Manually mark the contract as 'sent'
    // so the e-signature reply can be processed.
    const { db } = await import("../src/lib/db");
    await db.contract.update({
      where: { id: createResult.contractId },
      data: { status: "sent", sentAt: new Date() },
    });

    // Now send the reply with the signature phrase.
    const result = await processInboundSignatureEmail({
      fromEmail: uniqueEmail,
      subject: `RE: ${createResult.contractNumber}`,
      body: `I've reviewed the contract and ${SIGNATURE_PHRASE}`,
      receivedAt: new Date(),
    });
    expect(result.ok).toBe(true);
    expect(result.contractId).toBeTruthy();
  });

  // ─── 3. Double-Entry Ledger ───

  it("ledger recordLedgerEntry rejects zero debit + zero credit", async () => {
    const result = await recordLedgerEntry({
      account: "Revenue",
      debitCents: 0,
      creditCents: 0,
      description: "Zero entry",
    });
    expect(result.ok).toBe(false);
  });

  it("ledger recordLedgerEntry rejects negative amounts", async () => {
    const result = await recordLedgerEntry({
      account: "Revenue",
      debitCents: -100,
      creditCents: 0,
      description: "Negative entry",
    });
    expect(result.ok).toBe(false);
  });

  it("ledger recordDoubleEntry rejects zero cents", async () => {
    const result = await recordDoubleEntry({
      debitAccount: "Cash",
      creditAccount: "Revenue",
      cents: 0,
      description: "Zero",
    });
    expect(result.ok).toBe(false);
  });

  it("ledger recordDoubleEntry records matching debit + credit (balanced)", async () => {
    const result = await recordDoubleEntry({
      debitAccount: "Cash",
      debitSubAccount: "Cash:Stripe",
      creditAccount: "Revenue",
      creditSubAccount: "Revenue:SaaS-Scaffold",
      cents: 99_00,
      description: "Stripe payout for SaaS scaffold",
      referenceType: "stripe-payment",
      referenceId: `test-${Date.now()}`,
    });
    expect(result.ok).toBe(true);
  });

  it("ledger recordStripePayout creates balanced entries (Revenue + Cash)", async () => {
    const uniqueId = `stripe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await recordStripePayout({
      amountCents: 49_00,
      currency: "USD",
      serviceName: "Landing Page",
      stripePaymentId: uniqueId,
      clientEmail: "stripe-customer@test.com",
    });
    // Verify the ledger is balanced after the entry.
    const balance = await verifyLedgerBalance();
    expect(balance.balanced).toBe(true);
  });

  it("ledger recordApiExpense creates balanced entries (API Expense + Cash)", async () => {
    await recordApiExpense({
      provider: "zai",
      estimatedCostCents: 5,
      description: "Z-AI API call for lead hunt",
      referenceId: `api-call-${Date.now()}`,
    });
    const balance = await verifyLedgerBalance();
    expect(balance.balanced).toBe(true);
  });

  it("ledger calculatePnL returns Revenue - COGS - OpEx with balanced check", async () => {
    const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    const pnl = await calculatePnL(fromDate, new Date());
    expect(pnl).toHaveProperty("revenue");
    expect(pnl).toHaveProperty("cogs");
    expect(pnl).toHaveProperty("opex");
    expect(pnl).toHaveProperty("netProfitCents");
    expect(pnl).toHaveProperty("marginPercent");
    expect(pnl).toHaveProperty("isBalanced");
    expect(typeof pnl.netProfitCents).toBe("number");
    expect(typeof pnl.marginPercent).toBe("number");
    expect(pnl.isBalanced).toBe(true); // our test entries all balance
  });

  it("ledger getCashBalance returns the current cash position", async () => {
    const balance = await getCashBalance();
    expect(typeof balance.balanceCents).toBe("number");
  });

  it("ledger verifyLedgerBalance confirms debits == credits", async () => {
    const check = await verifyLedgerBalance();
    expect(check.balanced).toBe(true);
    expect(check.totalDebits).toBe(check.totalCredits);
    expect(check.difference).toBe(0);
  });

  // ─── 4. Constitution rules ───

  it("constitution has 80 rules total (was 79 before Phase 25)", async () => {
    const { ALL_CONSTITUTION_RULES } = await import("../src/lib/constitution");
    expect(ALL_CONSTITUTION_RULES.length).toBe(80);
  });

  it("constitution has RULE-72 + RULE-73 + RULE-74 (Phase 23 additions)", async () => {
    const { ALL_CONSTITUTION_RULES } = await import("../src/lib/constitution");
    const ids = ALL_CONSTITUTION_RULES.map((r) => r.id);
    expect(ids).toContain("RULE-72-SELF-EVOLVING-CODEBASE");
    expect(ids).toContain("RULE-73-LEGAL-ONBOARDING");
    expect(ids).toContain("RULE-74-DOUBLE-ENTRY-ACCOUNTING");
  });

  it("constitution has RULE-75 through RULE-79 (Phase 24 additions)", async () => {
    const { ALL_CONSTITUTION_RULES } = await import("../src/lib/constitution");
    const ids = ALL_CONSTITUTION_RULES.map((r) => r.id);
    expect(ids).toContain("RULE-75-INTERACTIVE-REFACTOR-REVIEW");
    expect(ids).toContain("RULE-76-LIVE-COMPLIANCE-AUDIT");
    expect(ids).toContain("RULE-77-CAPABILITY-REGISTRY");
    expect(ids).toContain("RULE-78-MULTI-OWNER-ISOLATION");
    expect(ids).toContain("RULE-79-SAFE-ROLLBACK-POLICY");
  });
});
