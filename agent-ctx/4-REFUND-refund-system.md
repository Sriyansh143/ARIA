# Task 4-REFUND — Refund System

## Agent
refund-system (Z.ai Code)

## Task
Build a complete refund system: backend lib + API routes + PaymentsTab UI integration.

User said: "Refund system is not handled properly — every confirmed transaction can have refund later stages, fix it."

## What was built

### Backend lib: `src/lib/refund-system.ts`
- `createRefund(input)` — validates parent payment is `confirmed`, validates amount ≤ (payment.amount − committed refunds), creates Refund + ActionLog (reversible) + ApprovalRequest (category=`payment-refund`).
- `processRefund(refundId, { gatewayRef?, reviewNote?, reviewer })` — moves status → `processed`, updates parent Payment (full refund → `refunded`; partial → stays `confirmed` + note appended). Requires reviewer.
- `rejectRefund(refundId, { reviewNote?, reviewer })` — moves status → `rejected`. Requires reviewer.
- `listRefunds({ status?, paymentId? })` — refunds with parent payment included (manual lookup).
- `getRefundStats()` — requested/processed/rejected counts + sums, by-reason breakdown.
- `getRefund(id)` — single refund + parent payment.
- Discriminated union `{ ok: true, refund } | { ok: false, error }` — no try/catch needed by callers.
- Direct prisma calls (db-write-queue is best-effort and doesn't return created records).

### API routes
- `src/app/api/refunds/route.ts` — GET (list + optional stats) + POST (create with strict validation).
- `src/app/api/refunds/[id]/route.ts` — GET (single) + POST (process | reject).
- All routes: `runtime='nodejs'`, `dynamic='force-dynamic'`.

### UI: `src/components/tabs/PaymentsTab.tsx`
- Sub-view toggle: [Payments | Refunds].
- Payments view: refund button on each `confirmed` payment row.
- Refunds view: stats cards + status filter + table (Date, Payment, Amount, Reason, Status badge, Requested By, Actions) + by-reason breakdown.
- Request Refund dialog (shadcn Dialog) — amount, reason dropdown, reason note, requestedBy.
- Review Refund dialog (shadcn Dialog) — reviewer, optional gatewayRef (process) or warning banner (reject).
- Uses Table, Dialog, Select, Badge, Button, Input, Textarea from shadcn/ui.
- JARVIS dark theme preserved (jarvis-panel, jarvis-mono, JARVIS.colors, var(--j-*) tokens).

## Validation rules enforced (STRICT)
1. Refund amount must be > 0.
2. Refund amount must be ≤ (payment.amount − already-committed refunds). Committed = {requested, under_review, approved, processed}.
3. Parent payment MUST be `confirmed` (not pending/failed/refunded).
4. Reason must be one of: customer_request | duplicate | service_not_delivered | fraud | other.
5. Processing requires a reviewer name.

## End-to-end verification
- Partial refund ₹1500 on ₹5000 confirmed payment → processed → payment stays `confirmed` + note appended. ✅
- Full refund ₹3000 on ₹3000 confirmed payment → processed → payment status becomes `refunded`. ✅
- Reject refund → status=`rejected`, reviewedBy + reviewNote set. ✅
- Refund on `pending` payment → 400 with clear error. ✅
- Refund > available amount → 400 with "exceeds available refundable amount". ✅
- Process already-processed refund → 400. ✅
- Missing reviewer → 400. ✅

## Lint result
- `bun run lint`: 1 pre-existing error in `src/lib/ide/index.ts` (NOT my file).
- `npx eslint` on my 4 files: EXIT=0, 0 errors, 0 warnings.
- `npx tsc --noEmit`: no errors in my files.

## Stage Summary
- 3 new files + 1 modified file.
- Refund lifecycle fully working end-to-end.
- Every confirmed transaction can now have refund later stages.
- 0 lint errors in my files, 0 TypeScript errors in my files.
- ActionLog + ApprovalRequest integration wired (reversible actions + escalation dispatcher compatibility).
