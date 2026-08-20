/**
 * src/lib/finance/stripe-reconciliation.ts — Phase 30
 *
 * Daily Stripe reconciliation: fetches Stripe Balance Transactions from
 * the past 24 hours + matches each against internal RevenueEvent +
 * LedgerEntry records. Discrepancies fire SystemAlert + Telegram owner
 * notification.
 *
 * WORKFLOW
 * --------
 *   1. Fetch Stripe Balance Transactions (type: charge, refund, payout)
 *      via `stripe.balanceTransactions.list({ created: { gte: 24h ago } })`.
 *   2. For each transaction, upsert a StripeReconciliation row (idempotent
 *      by `balanceTransactionId`).
 *   3. Match against internal records:
 *      - For charges: find a RevenueEvent with matching amount + createdAt
 *        (within 5 minutes of the Stripe timestamp). Match to a
 *        LedgerEntry with referenceType="stripe-payment".
 *      - For refunds: find a LedgerEntry with referenceType="refund" +
 *        matching negative amount.
 *   4. If matched: mark StripeReconciliation.status="matched" + populate
 *      matchedRevenueEventId / matchedLedgerEntryId / matchedServiceOrderId.
 *   5. If unmatched: mark status="discrepancy" + fire SystemAlert +
 *      Telegram owner notification.
 *
 * DESIGN NOTES
 * ------------
 * - Stripe Balance Transactions are the source of truth for "money moved".
 *   Internal RevenueEvent records are the source of truth for "we recognized
 *   revenue". The two should match 1:1 for charges.
 * - For payouts (Stripe → bank), we DON'T match against internal records
 *   (payouts are not revenue events — they're transfers between accounts).
 *   We just record them for accounting completeness.
 * - The cron runs daily at 4 AM (after the nightly backup + before the
 *   morning standup).
 * - All amounts are in cents to avoid floating-point issues.
 */

import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/lib/audit-log";
import { sendTelegramMessage } from "@/lib/telegram-notifier";

// ─── Types ───────────────────────────────────────────────────────────

export interface ReconciliationResult {
  total: number;
  matched: number;
  discrepancies: number;
  ignored: number;
  totalAmountCents: number;
  totalFeeCents: number;
  totalNetCents: number;
  discrepanciesList: Array<{
    balanceTransactionId: string;
    type: string;
    amountCents: number;
    reason: string;
  }>;
}

// ─── Stripe helper ─────────────────────────────────────────────────

async function getStripeClient(): Promise<import("stripe").default | null> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  const Stripe = (await import("stripe")).default;
  return new Stripe(secretKey, { apiVersion: "2024-06-20" as any });
}

// ─── Main: runReconciliation ───────────────────────────────────────

/**
 * Run a reconciliation pass over the last N hours (default 24).
 * Fetches Stripe Balance Transactions + matches each against internal records.
 *
 * This is the function called by the `daily-stripe-reconciliation` cron.
 */
export async function runStripeReconciliation(windowHours = 24): Promise<ReconciliationResult> {
  const stripe = await getStripeClient();
  if (!stripe) {
    logger.warn("stripe-reconciliation.no-key", {});
    return {
      total: 0, matched: 0, discrepancies: 0, ignored: 0,
      totalAmountCents: 0, totalFeeCents: 0, totalNetCents: 0,
      discrepanciesList: [],
    };
  }

  const createdGte = Math.floor(Date.now() / 1000) - (windowHours * 3600);
  const result: ReconciliationResult = {
    total: 0, matched: 0, discrepancies: 0, ignored: 0,
    totalAmountCents: 0, totalFeeCents: 0, totalNetCents: 0,
    discrepanciesList: [],
  };

  let hasMore = true;
  let startingAfter: string | undefined = undefined;

  while (hasMore) {
    const list = await stripe.balanceTransactions.list(
      {
        created: { gte: createdGte },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
    );

    for (const txn of list.data) {
      result.total++;
      result.totalAmountCents += txn.amount;
      result.totalFeeCents += txn.fee;
      result.totalNetCents += txn.net;

      await reconcileTransaction(txn, result);
    }

    hasMore = list.has_more;
    if (hasMore && list.data.length > 0) {
      startingAfter = list.data[list.data.length - 1].id;
    }
  }

  // Fire alerts for any discrepancies.
  if (result.discrepancies > 0) {
    await fireDiscrepancyAlert(result);
  }

  // Audit log entry for the reconciliation run.
  await recordAudit({
    actor: "stripe-reconciliation-cron",
    actorRole: "system",
    action: "reconcile",
    resource: "StripeReconciliation",
    after: {
      total: result.total,
      matched: result.matched,
      discrepancies: result.discrepancies,
      totalAmountCents: result.totalAmountCents,
      totalNetCents: result.totalNetCents,
    },
    source: "cron",
  });

  logger.info("stripe-reconciliation.complete", {
    total: result.total,
    matched: result.matched,
    discrepancies: result.discrepancies,
    totalAmountCents: result.totalAmountCents,
  });

  return result;
}

// ─── Reconcile a single transaction ─────────────────────────────────

async function reconcileTransaction(
  txn: import("stripe").Stripe.BalanceTransaction,
  result: ReconciliationResult,
): Promise<void> {
  // Skip non-charge / non-refund transactions (payouts, adjustments, application_fees).
  // We just record them with status="ignored".
  if (txn.type !== "charge" && txn.type !== "refund" && txn.type !== "payment") {
    await upsertReconciliationRow(txn, { status: "ignored", discrepancyReason: `type: ${txn.type}` });
    result.ignored++;
    return;
  }

  // Find a matching RevenueEvent (for charges).
  let matchedRevenueEventId: string | null = null;
  let matchedLedgerEntryId: string | null = null;
  let matchedServiceOrderId: string | null = null;
  let discrepancyReason = "";

  if (txn.type === "charge" || txn.type === "payment") {
    // Look for a RevenueEvent with the same amount + created within 5 min of the Stripe timestamp.
    const txnTime = new Date(txn.created * 1000);
    const lowerBound = new Date(txnTime.getTime() - 5 * 60 * 1000);
    const upperBound = new Date(txnTime.getTime() + 5 * 60 * 1000);

    const candidates = await db.revenueEvent.findMany({
      where: {
        amount: txn.amount / 100, // RevenueEvent stores dollars; Stripe stores cents
        createdAt: { gte: lowerBound, lte: upperBound },
      },
      take: 10,
    });

    if (candidates.length === 0) {
      discrepancyReason = "no-matching-revenue-event";
    } else {
      matchedRevenueEventId = candidates[0].id;
      matchedServiceOrderId = candidates[0].dealId ?? null; // dealId is repurposed for serviceOrderId
    }
  }

  // Find a matching LedgerEntry (for both charges + refunds).
  if (!discrepancyReason) {
    const txnTime = new Date(txn.created * 1000);
    const lowerBound = new Date(txnTime.getTime() - 5 * 60 * 1000);
    const upperBound = new Date(txnTime.getTime() + 5 * 60 * 1000);

    const referenceType = txn.type === "refund" ? "refund" : "stripe-payment";
    const expectedCents = Math.abs(txn.amount); // LedgerEntry stores positive numbers

    const ledgerCandidates = await db.ledgerEntry.findMany({
      where: {
        referenceType,
        // Debit on refund (creditCents), credit on charge (debitCents)
        OR: [
          { debitCents: expectedCents },
          { creditCents: expectedCents },
        ],
        entryDate: { gte: lowerBound, lte: upperBound },
      },
      take: 10,
    });

    if (ledgerCandidates.length === 0) {
      discrepancyReason = "no-matching-ledger-entry";
    } else {
      matchedLedgerEntryId = ledgerCandidates[0].id;
    }
  }

  const status = discrepancyReason ? "discrepancy" : "matched";
  await upsertReconciliationRow(txn, {
    status,
    discrepancyReason,
    matchedRevenueEventId,
    matchedLedgerEntryId,
    matchedServiceOrderId,
  });

  if (status === "matched") {
    result.matched++;
  } else {
    result.discrepancies++;
    result.discrepanciesList.push({
      balanceTransactionId: txn.id,
      type: txn.type,
      amountCents: txn.amount,
      reason: discrepancyReason,
    });
  }
}

// ─── Upsert helper ───────────────────────────────────────────────────

async function upsertReconciliationRow(
  txn: import("stripe").Stripe.BalanceTransaction,
  data: {
    status: string;
    discrepancyReason: string;
    matchedRevenueEventId?: string | null;
    matchedLedgerEntryId?: string | null;
    matchedServiceOrderId?: string | null;
  },
): Promise<void> {
  // Idempotent: if balanceTransactionId already exists, skip (don't overwrite).
  // This protects against the cron running twice in a day.
  const existing = await db.stripeReconciliation.findUnique({
    where: { balanceTransactionId: txn.id },
  });
  if (existing) {
    return;
  }

  await db.stripeReconciliation.create({
    data: {
      balanceTransactionId: txn.id,
      stripeCreatedAt: new Date(txn.created * 1000),
      amountCents: txn.amount,
      currency: txn.currency,
      feeCents: txn.fee,
      netCents: txn.net,
      type: txn.type,
      description: txn.description ?? "",
      matchedRevenueEventId: data.matchedRevenueEventId,
      matchedLedgerEntryId: data.matchedLedgerEntryId,
      matchedServiceOrderId: data.matchedServiceOrderId,
      status: data.status,
      discrepancyReason: data.discrepancyReason,
      reconciledAt: data.status === "matched" ? new Date() : null,
    },
  });
}

// ─── Discrepancy alert ──────────────────────────────────────────────

async function fireDiscrepancyAlert(result: ReconciliationResult): Promise<void> {
  const topDiscrepancies = result.discrepanciesList.slice(0, 5);
  const lines = topDiscrepancies.map(
    (d) => `• ${d.balanceTransactionId} (${d.type}, $${(d.amountCents / 100).toFixed(2)}): ${d.reason}`,
  );

  const message =
    `🟠 *Stripe Reconciliation — ${result.discrepancies} discrepancies found*\n\n` +
    `*Window:* last 24 hours\n` +
    `*Total transactions:* ${result.total}\n` +
    `*Matched:* ${result.matched}\n` +
    `*Discrepancies:* ${result.discrepancies}\n\n` +
    `*Top discrepancies:*\n${lines.join("\n")}\n\n` +
    (result.discrepancies > 5 ? `...and ${result.discrepancies - 5} more\n\n` : "") +
    `_Review the full list in the dashboard → Financials → Reconciliation._`;

  try {
    await sendTelegramMessage(message);
  } catch (err) {
    logger.warn("stripe-reconciliation.alert-failed", { error: String(err) });
  }

  // Also create a SystemAlert row.
  try {
    await db.systemAlert.create({
      data: {
        severity: result.discrepancies > 5 ? "critical" : "error",
        source: "stripe-reconciliation",
        message: `${result.discrepancies} Stripe reconciliation discrepancies (out of ${result.total} transactions)`,
        ack: false,
      },
    });
  } catch (err) {
    logger.warn("stripe-reconciliation.alert-row-failed", { error: String(err) });
  }
}

// ─── Query helper (for dashboard) ───────────────────────────────────

export async function getReconciliationSummary(days = 7): Promise<{
  total: number;
  matched: number;
  discrepancies: number;
  ignored: number;
  totalAmountCents: number;
  totalNetCents: number;
}> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.stripeReconciliation.findMany({
    where: { stripeCreatedAt: { gte: since } },
    select: { status: true, amountCents: true, netCents: true },
  });

  return {
    total: rows.length,
    matched: rows.filter((r) => r.status === "matched").length,
    discrepancies: rows.filter((r) => r.status === "discrepancy").length,
    ignored: rows.filter((r) => r.status === "ignored").length,
    totalAmountCents: rows.reduce((sum, r) => sum + r.amountCents, 0),
    totalNetCents: rows.reduce((sum, r) => sum + r.netCents, 0),
  };
}

export async function listDiscrepancies(limit = 50): Promise<Array<{
  id: string;
  balanceTransactionId: string;
  type: string;
  amountCents: number;
  currency: string;
  description: string;
  discrepancyReason: string;
  stripeCreatedAt: Date;
}>> {
  return db.stripeReconciliation.findMany({
    where: { status: "discrepancy" },
    orderBy: { stripeCreatedAt: "desc" },
    take: Math.min(limit, 200),
  });
}
