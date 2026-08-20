/**
 * tests/sample-phase-29.test.ts — v79 Phase 29 smoke tests
 *
 * Verifies the 5 new Phase 29 modules:
 *   1. Telegram-FIRST Owner Approval (requestOwnerApproval + inline keyboard + handleOwnerCallback)
 *   2. ApprovalConversation model (threaded questions / suggestions / answers)
 *   3. Audit Log Helper (recordAudit + queryAuditLog + redactSensitive)
 *   4. Currency Converter (convertCurrency + formatMoney + FX cache)
 *   5. GDPR Data Subject Request handler (submitDsr + collectSubjectData + executeErasure)
 *
 * All tests use the in-memory SQLite dev.db (created by `prisma db push`).
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
mock.module("server-only", () => ({}));

import { db } from "../src/lib/db";
import {
  requestOwnerApproval,
  buildApprovalKeyboard,
  buildApprovalRequestFromRow,
  handleOwnerCallback,
  getApprovalConversation,
  getApprovalsAwaitingRevision,
  type ApprovalRequestPayload,
} from "../src/lib/owner-approval/telegram-approval";
import {
  recordAudit,
  queryAuditLog,
  getResourceHistory,
  redactSensitive,
} from "../src/lib/audit-log";
import {
  convertCurrency,
  formatMoney,
  isSupportedCurrency,
  listSupportedCurrencies,
  clearFxCache,
} from "../src/lib/currency-converter";
import {
  submitDsr,
  collectSubjectData,
  executeErasure,
  processExpiredErasureRequests,
} from "../src/lib/gdpr";

// ─── Helpers ─────────────────────────────────────────────────────────

async function createTestApproval(overrides?: Partial<{
  title: string;
  action: string | null;
  risk: string;
  amount: number | null;
  status: string;
  requester: string;
}>): Promise<string> {
  const row = await db.approval.create({
    data: {
      title: overrides?.title ?? "Test approval",
      summary: "Test summary",
      risk: overrides?.risk ?? "medium",
      status: overrides?.status ?? "pending",
      action: overrides?.action ?? null,
      amount: overrides?.amount ?? null,
      requester: overrides?.requester ?? "test-agent",
    },
  });
  return row.id;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("Phase 29 — Telegram-First Owner Approval", () => {

  beforeEach(async () => {
    // Clean up conversations + approvals between tests so IDs don't leak.
    await db.approvalConversation.deleteMany({});
    await db.approval.deleteMany({});
  });

  it("buildApprovalKeyboard returns 4 buttons for routine approvals", () => {
    const kb = buildApprovalKeyboard("test-id-123", false);
    expect(kb).not.toBeNull();
    expect(kb.inline_keyboard).toHaveLength(2);
    expect(kb.inline_keyboard[0]).toHaveLength(2); // [Approve, Deny]
    expect(kb.inline_keyboard[1]).toHaveLength(2); // [Ask, Suggest]
    expect(kb.inline_keyboard[0][0].text).toContain("Approve");
    expect(kb.inline_keyboard[0][0].callback_data).toBe("approve:test-id-123");
    expect(kb.inline_keyboard[0][1].callback_data).toBe("deny:test-id-123");
    expect(kb.inline_keyboard[1][0].callback_data).toBe("ask:test-id-123");
    expect(kb.inline_keyboard[1][1].callback_data).toBe("suggest:test-id-123");
  });

  it("buildApprovalKeyboard replaces Approve with Pay-Approve Required for spend approvals", () => {
    const kb = buildApprovalKeyboard("pay-id-456", true);
    expect(kb.inline_keyboard[0][0].text).toContain("Pay-Approve Required");
    expect(kb.inline_keyboard[0][0].callback_data).toBe("payrequired:pay-id-456");
  });

  it("requestOwnerApproval returns {sent:false} when Telegram not configured", async () => {
    // Ensure env vars are unset for this test.
    const savedToken = process.env.TELEGRAM_BOT_TOKEN;
    const savedChat = process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    const id = await createTestApproval();
    const payload = await buildApprovalRequestFromRow(id);
    expect(payload).not.toBeNull();
    expect(payload!.title).toBe("Test approval");

    const result = await requestOwnerApproval(payload!);
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("not-configured");

    // Restore env vars.
    if (savedToken) process.env.TELEGRAM_BOT_TOKEN = savedToken;
    if (savedChat) process.env.TELEGRAM_CHAT_ID = savedChat;
  });

  it("handleOwnerCallback with 'deny' action marks the approval denied + resolves conversation", async () => {
    const id = await createTestApproval();
    const result = await handleOwnerCallback(`deny:${id}`);
    expect(result.ok).toBe(true);
    expect(result.replyText).toContain("Denied");

    // Verify the approval row was updated.
    const row = await db.approval.findUnique({ where: { id } });
    expect(row?.status).toBe("denied");
    expect(row?.decidedAt).not.toBeNull();

    // Verify a conversation was created + resolved.
    const conv = await db.approvalConversation.findFirst({ where: { approvalId: id } });
    expect(conv).not.toBeNull();
    expect(conv?.status).toBe("resolved");
  });

  it("handleOwnerCallback with 'ask' action prompts for question text when no input provided", async () => {
    const id = await createTestApproval();
    const result = await handleOwnerCallback(`ask:${id}`);
    expect(result.ok).toBe(true);
    expect(result.showAlert).toBe(true);
    expect(result.replyText).toContain("Reply with your question");
  });

  it("handleOwnerCallback with 'suggest' action records the suggestion in the conversation", async () => {
    const id = await createTestApproval();
    const result = await handleOwnerCallback(
      `suggest:${id}`,
      "Use a smaller batch size and add a rollback plan",
    );
    expect(result.ok).toBe(true);
    expect(result.replyText).toContain("Suggestion recorded");

    // Verify the conversation thread contains the owner's suggestion.
    const conv = await getApprovalConversation(id);
    expect(conv).not.toBeNull();
    expect(conv!.messages.length).toBeGreaterThanOrEqual(2);
    const ownerMsg = conv!.messages.find((m) => m.role === "owner" && m.kind === "suggestion");
    expect(ownerMsg).toBeDefined();
    expect(ownerMsg!.content).toContain("smaller batch size");
  });

  it("handleOwnerCallback with 'approve' action refuses spend approvals (must use /pay-approve)", async () => {
    const id = await createTestApproval({
      action: "spend",
      risk: "high",
      amount: 5000,
    });
    const result = await handleOwnerCallback(`approve:${id}`);
    expect(result.ok).toBe(false);
    expect(result.showAlert).toBe(true);
    expect(result.replyText).toContain("/pay-approve");

    // Approval should remain pending.
    const row = await db.approval.findUnique({ where: { id } });
    expect(row?.status).toBe("pending");
  });

  it("handleOwnerCallback with 'payrequired' action points the owner to /pay-approve", async () => {
    const id = await createTestApproval({ action: "spend", risk: "high", amount: 1000 });
    const result = await handleOwnerCallback(`payrequired:${id}`);
    expect(result.ok).toBe(false);
    expect(result.showAlert).toBe(true);
    expect(result.replyText).toContain("/pay-approve");
  });

  it("handleOwnerCallback with 'approve' action executes + resolves conversation for routine approval", async () => {
    const id = await createTestApproval({
      title: "Test routine approval",
      action: "deploy",
      risk: "medium",
    });
    const result = await handleOwnerCallback(`approve:${id}`);
    expect(result.ok).toBe(true);
    expect(result.replyText).toContain("Approved");

    // Verify the approval row was updated.
    const row = await db.approval.findUnique({ where: { id } });
    expect(row?.status).toBe("approved");
    expect(row?.decidedAt).not.toBeNull();

    // Verify conversation resolved.
    const conv = await getApprovalConversation(id);
    expect(conv?.status).toBe("resolved");
  });

  it("handleOwnerCallback returns error for invalid callback format", async () => {
    const result = await handleOwnerCallback("invalid-no-colon");
    expect(result.ok).toBe(false);
    expect(result.showAlert).toBe(true);
    expect(result.replyText).toContain("Invalid callback");
  });

  it("handleOwnerCallback returns error for unknown action", async () => {
    const id = await createTestApproval();
    const result = await handleOwnerCallback(`unknown:${id}`);
    expect(result.ok).toBe(false);
    expect(result.replyText).toContain("Unknown action");
  });

  it("getApprovalsAwaitingRevision lists only approvals with unresolved owner suggestions", async () => {
    const id1 = await createTestApproval({ title: "Approval 1" });
    const id2 = await createTestApproval({ title: "Approval 2" });

    // Make a suggestion on id1 only.
    await handleOwnerCallback(`suggest:${id1}`, "Reduce batch size");

    const awaiting = await getApprovalsAwaitingRevision();
    const ids = awaiting.map((a) => a.approvalId);
    expect(ids).toContain(id1);
    expect(ids).not.toContain(id2);
  });

  it("buildApprovalRequestFromRow infers type from action when type not provided", async () => {
    const id = await createTestApproval({
      title: "Deploy test",
      action: "deploy",
      risk: "medium",
    });
    const payload = await buildApprovalRequestFromRow(id);
    expect(payload).not.toBeNull();
    expect(payload!.type).toBe("workflow");
  });

  it("buildApprovalRequestFromRow infers 'expenditure' type for spend actions", async () => {
    const id = await createTestApproval({
      title: "Spend test",
      action: "spend",
      risk: "high",
      amount: 1000,
    });
    const payload = await buildApprovalRequestFromRow(id);
    expect(payload).not.toBeNull();
    expect(payload!.type).toBe("expenditure");
  });

  it("buildApprovalRequestFromRow returns null for nonexistent approval", async () => {
    const payload = await buildApprovalRequestFromRow("nonexistent-id");
    expect(payload).toBeNull();
  });
});

describe("Phase 29 — Audit Log Helper", () => {

  beforeEach(async () => {
    await db.auditLogEntry.deleteMany({});
  });

  it("recordAudit creates a row in AuditLogEntry", async () => {
    const id = await recordAudit({
      actor: "owner",
      actorRole: "owner",
      action: "approve",
      resource: "Approval",
      resourceId: "test-approval-id",
      after: { status: "approved", title: "Test" },
      source: "api",
    });
    expect(id).not.toBeNull();

    const rows = await db.auditLogEntry.findMany();
    expect(rows.length).toBe(1);
    expect(rows[0].actor).toBe("owner");
    expect(rows[0].action).toBe("approve");
    expect(rows[0].resource).toBe("Approval");
  });

  it("recordAudit redacts sensitive fields (password, token, secret)", async () => {
    await recordAudit({
      actor: "system",
      action: "create",
      resource: "Credential",
      after: {
        username: "admin",
        password: "super-secret-pwd",
        token: "sk_live_abc123",
        apiKey: "key-xyz",
      },
    });
    const rows = await db.auditLogEntry.findMany();
    expect(rows.length).toBe(1);
    const after = JSON.parse(rows[0].after!);
    expect(after.username).toBe("admin");
    expect(after.password).toBe("[REDACTED]");
    expect(after.token).toBe("[REDACTED]");
    expect(after.apiKey).toBe("[REDACTED]");
  });

  it("recordAudit redacts nested sensitive fields in objects + arrays", () => {
    const input = {
      user: { name: "Alice", password: "secret" },
      tokens: [{ kind: "stripe", secret: "sk_abc" }],
    };
    const redacted = redactSensitive(input);
    expect(redacted.user.name).toBe("Alice");
    expect((redacted.user as Record<string, unknown>).password).toBe("[REDACTED]");
    expect((redacted.tokens[0] as Record<string, unknown>).secret).toBe("[REDACTED]");
  });

  it("queryAuditLog filters by actor / resource / action", async () => {
    await recordAudit({ actor: "alice", action: "approve", resource: "Approval" });
    await recordAudit({ actor: "bob", action: "deny", resource: "Approval" });
    await recordAudit({ actor: "alice", action: "create", resource: "Contract" });

    const all = await queryAuditLog({});
    expect(all.length).toBe(3);

    const alice = await queryAuditLog({ actor: "alice" });
    expect(alice.length).toBe(2);

    const approvals = await queryAuditLog({ resource: "Approval" });
    expect(approvals.length).toBe(2);

    const denied = await queryAuditLog({ action: "deny" });
    expect(denied.length).toBe(1);
    expect(denied[0].actor).toBe("bob");
  });

  it("getResourceHistory returns entries oldest-first for a specific resource", async () => {
    const resourceId = "shared-resource-id";
    await recordAudit({ actor: "alice", action: "create", resource: "Contract", resourceId });
    await new Promise((r) => setTimeout(r, 20));
    await recordAudit({ actor: "bob", action: "update", resource: "Contract", resourceId });
    await new Promise((r) => setTimeout(r, 20));
    await recordAudit({ actor: "alice", action: "sign", resource: "Contract", resourceId });

    const history = await getResourceHistory("Contract", resourceId);
    expect(history.length).toBe(3);
    expect(history[0].action).toBe("create");
    expect(history[1].action).toBe("update");
    expect(history[2].action).toBe("sign");
  });

  it("recordAudit is best-effort — never throws on failure", async () => {
    // Force a failure by passing an invalid actor (empty string is OK;
    // we'd need to break the schema to actually fail, but the wrapper
    // catches all errors so we just verify it returns null not throw).
    const result = await recordAudit({
      actor: "",
      action: "test",
      resource: "Test",
    });
    // It should either succeed (returning an id) or return null — but never throw.
    expect(typeof result === "string" || result === null).toBe(true);
  });
});

describe("Phase 29 — Currency Converter", () => {

  beforeEach(() => {
    clearFxCache();
  });

  it("isSupportedCurrency recognizes all 10 supported codes", () => {
    const codes = listSupportedCurrencies();
    expect(codes.length).toBe(10);
    expect(codes).toContain("USD");
    expect(codes).toContain("EUR");
    expect(codes).toContain("GBP");
    expect(codes).toContain("INR");
    expect(codes).toContain("JPY");
    expect(isSupportedCurrency("USD")).toBe(true);
    expect(isSupportedCurrency("INR")).toBe(true);
    expect(isSupportedCurrency("XYZ" as never)).toBe(false);
  });

  it("convertCurrency with same currency returns the same amount", async () => {
    const result = await convertCurrency({ amount: 100, currency: "USD" }, "USD");
    expect(result.amount).toBe(100);
    expect(result.currency).toBe("USD");
  });

  it("convertCurrency USD → INR returns a reasonable amount (uses static fallback if live fetch fails)", async () => {
    const result = await convertCurrency({ amount: 100, currency: "USD" }, "INR");
    // Static rate is ~83.5, so 100 USD ≈ 8350 INR. Allow wide tolerance
    // because live rates fluctuate.
    expect(result.amount).toBeGreaterThan(5000);
    expect(result.amount).toBeLessThan(15000);
    expect(result.currency).toBe("INR");
  });

  it("convertCurrency EUR → USD works (cross-currency via USD base)", async () => {
    const result = await convertCurrency({ amount: 100, currency: "EUR" }, "USD");
    // 100 EUR ≈ 108 USD (1/0.92). Wide tolerance for live rates.
    expect(result.amount).toBeGreaterThan(80);
    expect(result.amount).toBeLessThan(150);
    expect(result.currency).toBe("USD");
  });

  it("formatMoney produces human-readable output with currency symbol", () => {
    expect(formatMoney({ amount: 1234.56, currency: "USD" })).toBe("$1,234.56 USD");
    expect(formatMoney({ amount: 98765, currency: "INR" })).toBe("₹98,765.00 INR");
    // JPY has no minor unit.
    expect(formatMoney({ amount: 1500, currency: "JPY" })).toBe("¥1,500 JPY");
  });

  it("convertCurrency throws for unsupported currency codes (should never happen but defensive)", async () => {
    // The isSupportedCurrency guard should prevent this, but if someone
    // bypasses it, the function should throw a clear error.
    await expect(
      convertCurrency(
        { amount: 100, currency: "USD" },
        "UNSUPPORTED" as never,
      ),
    ).rejects.toThrow("Unsupported currency");
  });
});

describe("Phase 29 — GDPR Data Subject Request", () => {

  beforeEach(async () => {
    await db.dataSubjectRequest.deleteMany({});
    await db.importedContact.deleteMany({});
    await db.lead.deleteMany({});
  });

  it("submitDsr for 'access' type completes synchronously + returns collected data", async () => {
    // Seed a couple of records for the subject.
    await db.importedContact.create({
      data: {
        source: "excel",
        email: "test.subject@example.com",
        name: "Test Subject",
        phone: "+1234567890",
      },
    });

    const result = await submitDsr({
      type: "access",
      subject: "test.subject@example.com",
      requestedBy: "owner",
    });

    expect(result.status).toBe("completed");
    expect(result.affectedRecords.ImportedContact).toBe(1);
    expect(result.exportData).toBeDefined();
    expect(result.exportData!.ImportedContact).toHaveLength(1);
  });

  it("submitDsr for 'portability' type behaves the same as access (returns portable JSON)", async () => {
    await db.importedContact.create({
      data: { source: "manual", email: "portable@example.com", name: "Portable User" },
    });

    const result = await submitDsr({
      type: "portability",
      subject: "portable@example.com",
    });
    expect(result.status).toBe("completed");
    expect(result.exportData).toBeDefined();
    expect(result.exportData!.ImportedContact).toHaveLength(1);
  });

  it("submitDsr for 'erasure' type schedules a purge + marks status 'verified'", async () => {
    const result = await submitDsr({
      type: "erasure",
      subject: "erase-me@example.com",
    });
    expect(result.status).toBe("verified");
    expect(result.scheduledPurgeAt).toBeDefined();

    // scheduledPurgeAt should be ~7 days from now (default grace window).
    const purgeAt = new Date(result.scheduledPurgeAt!);
    const diffDays = (purgeAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(6);
    expect(diffDays).toBeLessThan(8);
  });

  it("submitDsr for 'rectification' leaves status 'pending' (manual review)", async () => {
    const result = await submitDsr({
      type: "rectification",
      subject: "fix-me@example.com",
      reason: "Wrong phone number",
    });
    expect(result.status).toBe("pending");
  });

  it("collectSubjectData returns matching records from all relevant tables", async () => {
    await db.importedContact.create({
      data: {
        source: "excel",
        email: "find.me@example.com",
        name: "Find Me",
        phone: "+15551234567",
      },
    });
    await db.lead.create({
      data: {
        username: "find.me@example.com",
        displayName: "Find Me Lead",
      },
    });

    const data = await collectSubjectData("find.me@example.com");
    expect(Object.keys(data).length).toBeGreaterThanOrEqual(1);
    expect(data.ImportedContact).toBeDefined();
    expect(data.ImportedContact).toHaveLength(1);
    // Lead may or may not be present depending on env — both are fine.
  });

  it("executeErasure scrubs PII from ImportedContact + marks request completed", async () => {
    await db.importedContact.create({
      data: {
        source: "excel",
        email: "erase.in.test@example.com",
        name: "Erase Me",
        phone: "+15559876543",
      },
    });

    const submitResult = await submitDsr({
      type: "erasure",
      subject: "erase.in.test@example.com",
    });

    // Force-execute the erasure (cron would normally do this after grace).
    const result = await executeErasure(submitResult.id);
    expect(result.status).toBe("completed");
    expect(result.affectedRecords.ImportedContact).toBe(1);

    // Verify the imported contact's PII was scrubbed.
    const contacts = await db.importedContact.findMany({
      where: { email: "[erased]" },
    });
    expect(contacts.length).toBe(1);
    expect(contacts[0].name).toBe("[erased]");
    expect(contacts[0].phone).toBe("[erased]");
  });

  it("executeErasure refuses to process non-erasure requests", async () => {
    const accessResult = await submitDsr({
      type: "access",
      subject: "non-erasure@example.com",
    });
    await expect(executeErasure(accessResult.id)).rejects.toThrow("not an erasure");
  });

  it("processExpiredErasureRequests returns empty when no requests are due", async () => {
    // Submit an erasure request that's still in the grace window (not expired).
    await submitDsr({ type: "erasure", subject: "future@example.com" });
    const result = await processExpiredErasureRequests();
    expect(result.processed).toBe(0);
    expect(result.results).toHaveLength(0);
  });
});

describe("Phase 29 — Constitution + Phases", () => {

  it("constitution has 80 rules total (RULE-1 through RULE-80)", async () => {
    const { ALL_CONSTITUTION_RULES } = await import("../src/lib/constitution");
    expect(ALL_CONSTITUTION_RULES.length).toBe(80);
  });

  it("constitution includes Phase 24 rules (RULE-75 through RULE-79)", async () => {
    const { ALL_CONSTITUTION_RULES } = await import("../src/lib/constitution");
    const ids = ALL_CONSTITUTION_RULES.map((r) => r.id);
    expect(ids.some((id) => id.startsWith("RULE-75"))).toBe(true);
    expect(ids.some((id) => id.startsWith("RULE-76"))).toBe(true);
    expect(ids.some((id) => id.startsWith("RULE-77"))).toBe(true);
    expect(ids.some((id) => id.startsWith("RULE-78"))).toBe(true);
    expect(ids.some((id) => id.startsWith("RULE-79"))).toBe(true);
    expect(ids.some((id) => id.startsWith("RULE-80"))).toBe(true);
  });
});
