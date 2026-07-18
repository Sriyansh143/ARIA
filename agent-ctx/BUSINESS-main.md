# Task ID: BUSINESS — Agent: main (Z.ai Code)

## Summary
Built business automation capabilities (CRM/Sales/Support) for JARVIS Mission Control.

## Files Created (8)
- `prisma/schema.prisma` — appended 3 models: Client, Lead, SupportTicket (with proper indexes)
- `src/app/api/clients/route.ts` — GET (list + pipeline stats) + POST (create)
- `src/app/api/clients/[id]/route.ts` — GET + PATCH + DELETE
- `src/app/api/leads/route.ts` — GET (list + stats) + POST (create with auto-score)
- `src/app/api/leads/[id]/route.ts` — GET + PATCH (re-scores on key-field changes) + DELETE
- `src/app/api/support/route.ts` — GET (list + stats) + POST (create)
- `src/app/api/support/[id]/route.ts` — GET + PATCH + DELETE
- `src/components/tabs/CRMTab.tsx` — MergedTab with 3 sub-views (Clients/Leads/Support), stat cards, filterable tables, 5 modals, lead-score distribution chart, live auto-score preview, 15s polling
- `src/lib/lead-score.ts` — shared pure lead-scoring function (0-100 scale)

## Files Modified (3)
- `src/lib/orion-intent.ts` — added 4 new matchers (create-lead, create-client, create-ticket, query-clients), `parseContactString()` helper, 4 INTENT_CATALOG entries, 5 PALETTE_ENTRIES, CRM tab aliases; **also fixed pre-existing bug** by adding 5 missing intents (make-plan, run-command, read-file, write-file, browse) to IntentName type union
- `src/app/api/orion/command/route.ts` — added 4 cases to POST switch + 4 handler functions (handleCreateLead uses scoreLead for auto-scoring, handleCreateClient, handleCreateTicket, handleQueryClients with parallel DB queries)
- `src/app/page-client.tsx` — surgical: 1 import + 1 TabKey entry + 1 TABS entry + 1 TAB_MAP entry (Business group, amber accent, Briefcase icon)

## Schema Changes
3 new models appended to prisma/schema.prisma (647 → 709 lines):
- `Client` — CRM pipeline contact (lead→contacted→qualified→proposal→negotiation→won|lost)
- `Lead` — early-stage prospect with 0-100 auto-score
- `SupportTicket` — support requests across chat/email/phone/telegram

Ran `bunx prisma db push --accept-data-loss` + `bunx prisma generate` — both succeeded.

## Lint Status
✅ `bun run lint` — clean (0 errors, 0 warnings).
✅ TypeScript — 0 errors in any new/modified file (only pre-existing TS errors in unrelated files remain).

## Notes for Future Agents
- Lead scoring formula lives in `src/lib/lead-score.ts` — import from there, don't duplicate.
- Lead/Client/Support API routes follow the same pattern as `/api/payments` — GET returns `{items, stats}`, POST validates input + creates, PATCH updates whitelisted fields, DELETE removes.
- CRM tab is in the Business group, accent=amber, icon=Briefcase. Sub-views: Clients / Leads / Support.
- Orion intent `query-clients` returns a multi-line CRM report with pipeline value, avg score, urgent ticket count — good for voice summary.
- Dev server was down at task completion (system-managed `bun run dev`). Lint and TS checks pass; runtime verification pending dev server restart.
