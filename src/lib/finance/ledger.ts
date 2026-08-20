/**
 * src/lib/finance/ledger.ts — v73 Phase 23 (RULE-74)
 *
 * Double-entry bookkeeping ledger. Tracks every financial event:
 *   - Revenue (Stripe payouts, crypto payments, free-offer redemptions at $0)
 *   - API Expense (Z-AI, Twilio, Resend, etc.)
 *   - Compute Expense (Ollama compute — internal allocation, no cash leaves)
 *   - Contractor Expense (freelancer payouts)
 *   - OpEx (subscriptions, infrastructure)
 *
 * Every entry has both a DEBIT (what comes IN to an account) + a CREDIT
 * (what goes OUT of an account). The ledger MUST always balance —
 * sum(debits) == sum(credits) across the entire ledger.
 *
 * The /api/finance/pnl endpoint returns real-time Profit & Loss =
 * Revenue - COGS - OpEx, filterable by date range + sub-account.
 */

import "server-only";
import { db } from "../db";
import { logger } from "../logger";
import { emit } from "../event-bus";

// ─── Types ────────────────────────────────────────────────────────────

export type LedgerAccount =
  | "Revenue"
  | "Cash"
  | "Accounts Receivable"
  | "API Expense"
  | "Compute Expense"
  | "Contractor Expense"
  | "OpEx"
  | "Refunds";

export interface LedgerEntryInput {
  account: LedgerAccount | string;
  subAccount?: string;
  debitCents: number;
  creditCents: number;
  description: string;
  referenceType?: string;
  referenceId?: string;
  entryDate?: Date;
}

export interface PnLResult {
  period: { from: string; to: string };
  revenue: { totalCents: number; bySubAccount: Record<string, number> };
  cogs: { totalCents: number; bySubAccount: Record<string, number> };
  opex: { totalCents: number; bySubAccount: Record<string, number> };
  netProfitCents: number;
  marginPercent: number;
  isBalanced: boolean;
  totalDebitsCents: number;
  totalCreditsCents: number;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Record a single ledger entry. Validates the entry has either a debit or
 * a credit (but not both zero).
 */
export async function recordLedgerEntry(input: LedgerEntryInput): Promise<{ ok: boolean; entryId?: string; reason?: string }> {
  if (input.debitCents === 0 && input.creditCents === 0) {
    return { ok: false, reason: "Both debit + credit are 0 — nothing to record." };
  }
  if (input.debitCents < 0 || input.creditCents < 0) {
    return { ok: false, reason: "Debit + credit must be non-negative." };
  }

  try {
    const entry = await db.ledgerEntry.create({
      data: {
        account: input.account,
        subAccount: input.subAccount ?? "",
        debitCents: input.debitCents,
        creditCents: input.creditCents,
        description: input.description.slice(0, 500),
        referenceType: input.referenceType ?? "",
        referenceId: input.referenceId ?? "",
        entryDate: input.entryDate ?? new Date(),
      },
    });
    return { ok: true, entryId: entry.id };
  } catch (err) {
    return { ok: false, reason: String(err).slice(0, 100) };
  }
}

/**
 * Record a double-sided (debit + credit) entry — the typical bookkeeping
 * pattern. e.g. for a Stripe payment:
 *   recordDoubleEntry({
 *     debitAccount: "Cash", debitCents: amount,
 *     creditAccount: "Revenue", creditCents: amount,
 *     description: "Stripe payout for SOW-2026-001",
 *     referenceType: "stripe-payment", referenceId: "pi_xxx",
 *   });
 *
 * Ensures the entry balances (debitCents == creditCents).
 */
export async function recordDoubleEntry(input: {
  debitAccount: LedgerAccount | string;
  creditAccount: LedgerAccount | string;
  debitSubAccount?: string;
  creditSubAccount?: string;
  cents: number;
  description: string;
  referenceType?: string;
  referenceId?: string;
  entryDate?: Date;
}): Promise<{ ok: boolean; reason?: string }> {
  if (input.cents <= 0) {
    return { ok: false, reason: "Amount must be positive." };
  }
  const [debit, credit] = await Promise.all([
    recordLedgerEntry({
      account: input.debitAccount,
      subAccount: input.debitSubAccount,
      debitCents: input.cents,
      creditCents: 0,
      description: input.description,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      entryDate: input.entryDate,
    }),
    recordLedgerEntry({
      account: input.creditAccount,
      subAccount: input.creditSubAccount,
      debitCents: 0,
      creditCents: input.cents,
      description: input.description,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      entryDate: input.entryDate,
    }),
  ]);
  if (!debit.ok || !credit.ok) {
    return { ok: false, reason: `Debit: ${debit.reason} | Credit: ${credit.reason}` };
  }
  logger.info("ledger.double-entry.recorded", {
    debitAccount: input.debitAccount,
    creditAccount: input.creditAccount,
    cents: input.cents,
    description: input.description.slice(0, 80),
  });
  return { ok: true };
}

/**
 * Record an API call cost. Called by llm-client.ts after each external API call.
 * Credits API Expense, Debits Cash (the cash leaves the bank to pay the API bill).
 */
export async function recordApiExpense(input: {
  provider: string; // "zai" | "twilio" | "resend" | "openai"
  estimatedCostCents: number;
  description: string;
  referenceId?: string;
}): Promise<void> {
  if (input.estimatedCostCents <= 0) return;
  await recordDoubleEntry({
    debitAccount: "API Expense",
    debitSubAccount: `API:${input.provider}`,
    creditAccount: "Cash",
    creditSubAccount: `Cash:${input.provider}`,
    cents: input.estimatedCostCents,
    description: `API call to ${input.provider}: ${input.description}`.slice(0, 400),
    referenceType: "api-call",
    referenceId: input.referenceId ?? "",
  });
}

/**
 * Record Ollama compute usage. Internal allocation — no actual cash leaves.
 * Credits Compute Expense, Debits an internal "Compute Allocated" contra-account.
 */
export async function recordComputeExpense(input: {
  model: string; // "llama3.2:3b"
  estimatedTokens: number;
  estimatedCostCents: number;
  description: string;
  referenceId?: string;
}): Promise<void> {
  if (input.estimatedCostCents <= 0) return;
  await recordDoubleEntry({
    debitAccount: "Compute Expense",
    debitSubAccount: `Compute:${input.model}`,
    creditAccount: "Cash",
    creditSubAccount: "Cash:Internal",
    cents: input.estimatedCostCents,
    description: `Ollama compute (${input.model}, ~${input.estimatedTokens} tokens): ${input.description}`.slice(0, 400),
    referenceType: "ollama-compute",
    referenceId: input.referenceId ?? "",
  });
}

/**
 * Record a Stripe payout. Credits Revenue, Debits Cash.
 */
export async function recordStripePayout(input: {
  amountCents: number;
  currency: string;
  serviceName: string;
  stripePaymentId: string;
  clientEmail: string;
}): Promise<void> {
  await recordDoubleEntry({
    debitAccount: "Cash",
    debitSubAccount: `Cash:Stripe`,
    creditAccount: "Revenue",
    creditSubAccount: `Revenue:${input.serviceName}`,
    cents: input.amountCents,
    description: `Stripe payout ${input.stripePaymentId} from ${input.clientEmail} for ${input.serviceName}`,
    referenceType: "stripe-payment",
    referenceId: input.stripePaymentId,
  });
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: `💰 Ledger: Stripe payout $${(input.amountCents / 100).toFixed(2)} for ${input.serviceName} recorded (Revenue credited, Cash debited)`,
    level: "success",
  });
}

/**
 * Record a contractor (freelancer) payout. Credits Contractor Expense, Debits Cash.
 */
export async function recordContractorPayout(input: {
  amountCents: number;
  contractorName: string;
  taskId: string;
}): Promise<void> {
  await recordDoubleEntry({
    debitAccount: "Contractor Expense",
    debitSubAccount: `Contractor:${input.contractorName}`,
    creditAccount: "Cash",
    creditSubAccount: "Cash:Contractors",
    cents: input.amountCents,
    description: `Payout to ${input.contractorName} for task ${input.taskId}`,
    referenceType: "contractor-payout",
    referenceId: input.taskId,
  });
}

// ─── P&L Calculation ─────────────────────────────────────────────────

/**
 * Calculate the real-time Profit & Loss for a date range.
 * Returns:
 *   - Revenue (sum of credits to Revenue account)
 *   - COGS = API Expense + Compute Expense + Contractor Expense (sum of debits)
 *   - OpEx (sum of debits to OpEx account)
 *   - Net Profit = Revenue - COGS - OpEx
 *   - Margin % = Net Profit / Revenue * 100
 *   - Balanced check: totalDebits == totalCredits across the period
 */
export async function calculatePnL(fromDate: Date, toDate: Date = new Date()): Promise<PnLResult> {
  const entries = await db.ledgerEntry.findMany({
    where: { entryDate: { gte: fromDate, lte: toDate } },
    select: { account: true, subAccount: true, debitCents: true, creditCents: true, description: true },
  });

  // Revenue = sum of CREDITS to the Revenue account (when we earn money).
  const revenue = { totalCents: 0, bySubAccount: {} as Record<string, number> };
  // COGS = sum of DEBITS to API Expense + Compute Expense + Contractor Expense.
  const cogs = { totalCents: 0, bySubAccount: {} as Record<string, number> };
  // OpEx = sum of DEBITS to OpEx account.
  const opex = { totalCents: 0, bySubAccount: {} as Record<string, number> };

  let totalDebitsCents = 0;
  let totalCreditsCents = 0;

  for (const e of entries) {
    totalDebitsCents += e.debitCents;
    totalCreditsCents += e.creditCents;

    if (e.account === "Revenue") {
      revenue.totalCents += e.creditCents;
      revenue.bySubAccount[e.subAccount || "general"] = (revenue.bySubAccount[e.subAccount || "general"] ?? 0) + e.creditCents;
    } else if (e.account === "API Expense" || e.account === "Compute Expense" || e.account === "Contractor Expense") {
      cogs.totalCents += e.debitCents;
      cogs.bySubAccount[e.subAccount || e.account] = (cogs.bySubAccount[e.subAccount || e.account] ?? 0) + e.debitCents;
    } else if (e.account === "OpEx") {
      opex.totalCents += e.debitCents;
      opex.bySubAccount[e.subAccount || "general"] = (opex.bySubAccount[e.subAccount || "general"] ?? 0) + e.debitCents;
    }
  }

  const netProfitCents = revenue.totalCents - cogs.totalCents - opex.totalCents;
  const marginPercent = revenue.totalCents > 0 ? (netProfitCents / revenue.totalCents) * 100 : 0;

  return {
    period: { from: fromDate.toISOString(), to: toDate.toISOString() },
    revenue,
    cogs,
    opex,
    netProfitCents,
    marginPercent,
    isBalanced: totalDebitsCents === totalCreditsCents,
    totalDebitsCents,
    totalCreditsCents,
  };
}

/**
 * Get the current cash balance = sum(debits to Cash) - sum(credits to Cash).
 * (Cash is debited when money comes in, credited when it leaves.)
 */
export async function getCashBalance(): Promise<{ balanceCents: number }> {
  const entries = await db.ledgerEntry.findMany({
    where: { account: "Cash" },
    select: { debitCents: true, creditCents: true },
  });
  const totalDebits = entries.reduce((sum, e) => sum + e.debitCents, 0);
  const totalCredits = entries.reduce((sum, e) => sum + e.creditCents, 0);
  return { balanceCents: totalDebits - totalCredits };
}

/**
 * Verify the ledger balances — sum(debits) == sum(credits) across ALL entries.
 * Called by the weekly audit cron + by /api/finance/pnl.
 */
export async function verifyLedgerBalance(): Promise<{ balanced: boolean; totalDebits: number; totalCredits: number; difference: number }> {
  const entries = await db.ledgerEntry.findMany({ select: { debitCents: true, creditCents: true } });
  const totalDebits = entries.reduce((sum, e) => sum + e.debitCents, 0);
  const totalCredits = entries.reduce((sum, e) => sum + e.creditCents, 0);
  return {
    balanced: totalDebits === totalCredits,
    totalDebits,
    totalCredits,
    difference: totalDebits - totalCredits,
  };
}
