// =====================================================================
// seed-rules.ts — Upsert 33 operator rules into db.rule.
// =====================================================================
// Includes the original 10 rules from seed-agents.ts PLUS the 27 pricing /
// negotiation / operational / safety / intelligence rules documented in the
// (now lost) earlier worklog entries. Existing keys are upserted (updated);
// new keys are created. Idempotent — safe to re-run.
//
// Run: cd /home/z/my-project && bunx tsx scripts/seed-rules.ts
// =====================================================================

import { db } from '../src/lib/db';

type RuleSeed = {
  key: string;
  title: string;
  description: string;
  category: 'operational' | 'safety' | 'financial' | 'legal' | 'intelligence' | 'custom';
  priority: 'low' | 'medium' | 'high' | 'critical';
  enabled?: boolean;
};

const RULES: RuleSeed[] = [
  // ─── Existing 10 rules (kept intact, upserted) ───────────────────────
  {
    key: 'non-investment-only',
    title: 'Non-Investment Only',
    description:
      'The system must never invest money in stocks, crypto, or any financial instrument. Inflow only — no outflow unless explicitly approved by the owner. Always legal, always non-risky.',
    category: 'financial',
    priority: 'critical',
  },
  {
    key: 'owner-approval-pricing',
    title: 'Owner Approval for Pricing',
    description:
      'The app suggests pricing, the owner decides. Any pricing changes (product, service, subscription) require explicit owner sign-off before publication.',
    category: 'financial',
    priority: 'high',
  },
  {
    key: 'research-before-action',
    title: 'Research Before Action',
    description:
      'Agents must gather and cite at least 2 sources and always plan first before executing on novel or unfamiliar tasks. Never act on assumptions.',
    category: 'operational',
    priority: 'medium',
  },
  {
    key: 'multi-agent-discussion',
    title: 'Multi-Agent Discussion Before Complex Tasks',
    description:
      'Tasks marked "complex" must be decomposed and reviewed by ≥2 specialist agents before execution. Cross-check plans across agents to avoid blind spots.',
    category: 'operational',
    priority: 'high',
  },
  {
    key: 'no-destructive-without-snapshot',
    title: 'No Destructive Ops Without Snapshot',
    description:
      'Destructive operations (schema push, file delete, db wipe) must snapshot first via the rollback system so they can be undone if something goes wrong.',
    category: 'safety',
    priority: 'critical',
  },
  {
    key: 'pii-redaction',
    title: 'PII Redaction in Logs',
    description:
      'Personally Identifiable Information (emails, phones, SSNs) must be redacted before persistence to any log or memory.',
    category: 'safety',
    priority: 'high',
  },
  {
    key: 'payment-confirmation',
    title: 'Double-Confirm Payments',
    description:
      'Outbound payments >$100 require a second confirmation step from the operator or CFO agent.',
    category: 'financial',
    priority: 'high',
  },
  {
    key: 'contract-review-required',
    title: 'Contract Review Required',
    description:
      'Any agreement (MSA, SOW, NDA) must be reviewed by HALCYON (Contract Attorney) before signature.',
    category: 'legal',
    priority: 'high',
  },
  {
    key: 'data-export-audit',
    title: 'Data Export Audit Trail',
    description:
      'All bulk data exports (>100 rows) must be logged in the Blackbox with requester + recipient.',
    category: 'legal',
    priority: 'medium',
  },
  {
    key: 'transparent-failure',
    title: 'Transparent Failure Reporting',
    description:
      'When an agent fails, the error + stack trace must be recorded in the Blackbox before retry.',
    category: 'operational',
    priority: 'medium',
  },

  // ─── Pricing & Negotiation Rules (new) ───────────────────────────────
  {
    key: 'liafon-branding-default',
    title: 'Liafon Branding Default',
    description:
      'All deliverables ship with Liafon branding by default, which unlocks better pricing for the client. White-label / client branding is a paid add-on that increases the quote by at least 30%.',
    category: 'financial',
    priority: 'high',
  },
  {
    key: 'multi-layered-income',
    title: 'Multi-Layered Income',
    description:
      'Every engagement must layer at least 2 revenue streams: referral fees, volume discounts, upsells, or recurring revenue. Never close a single-flat-fee deal if a second layer is possible.',
    category: 'financial',
    priority: 'high',
  },
  {
    key: 'recurring-revenue-priority',
    title: 'Recurring Revenue Priority',
    description:
      'Subscriptions and retainers always outrank one-time projects. If a one-time deal is on the table, propose a recurring wrap (support, hosting, optimization) before quoting a flat fee.',
    category: 'financial',
    priority: 'high',
  },
  {
    key: 'dynamic-pricing-per-client',
    title: 'Dynamic Pricing per Client',
    description:
      'No two clients get the same price. Pricing is computed per-client based on industry, budget signals, urgency, geography, and lifetime value. Never publish a public price list for B2B services.',
    category: 'financial',
    priority: 'high',
  },
  {
    key: 'budget-discovery-before-pricing',
    title: 'Budget Discovery Before Pricing',
    description:
      'Never quote before discovering the client budget. Use value-framing questions, tiered options, and anchor pricing to subtly reveal the budget envelope before any number is committed.',
    category: 'financial',
    priority: 'high',
  },
  {
    key: 'country-based-pricing',
    title: 'Country-Based Pricing (PPP)',
    description:
      'Apply Purchasing Power Parity (PPP) adjustments to all quotes. India / South Asia pricing is benchmarked lower than US / EU / GCC pricing for the same deliverable, with explicit geo-tier tables.',
    category: 'financial',
    priority: 'medium',
  },
  {
    key: 'free-trial-strategy',
    title: 'Free Trial Strategy',
    description:
      'For SaaS-style services, lead with a time-boxed free trial (7–14 days) that auto-converts to a paid subscription. The trial must capture payment intent up front to maximize conversion.',
    category: 'financial',
    priority: 'medium',
  },
  {
    key: 'problem-solving-automation-pricing',
    title: 'Problem-Solving + Automation Pricing',
    description:
      'Price by the problem solved and hours saved, not by the hours worked. Automation engagements are priced as a % of the recurring labor cost they replace, typically 30–50% of year-1 savings.',
    category: 'financial',
    priority: 'medium',
  },
  {
    key: 'urgent-call-for-approval',
    title: 'Urgent Call for Approval',
    description:
      'When owner approval is required but the owner is unavailable via chat, escalate to a voice call (Twilio / FreeSWITCH bridge). Critical pricing / payment decisions must never be auto-approved.',
    category: 'operational',
    priority: 'high',
  },

  // ─── Operational Rules (new) ─────────────────────────────────────────
  {
    key: 'no-building-from-scratch',
    title: 'No Building From Scratch',
    description:
      'Always use available codes from repos / zip / npm before writing new code. Search the codebase, internal lib zip, and open-source repos first. New code is the last resort, not the first.',
    category: 'operational',
    priority: 'high',
  },
  {
    key: 'work-persistence-resume',
    title: 'Work Persistence + Resume',
    description:
      'Every long-running task must checkpoint its progress to disk / DB so that after a disconnection or crash it can resume exactly where it left off. Never lose work to a restart.',
    category: 'operational',
    priority: 'high',
  },
  {
    key: 'always-update-worklog',
    title: 'Always Update Worklog',
    description:
      'Every run and every user prompt must produce a worklog entry. No silent work — if it is not in the worklog, it did not happen. Append-only; never edit or remove prior entries.',
    category: 'operational',
    priority: 'critical',
  },
  {
    key: 'complete-pending-works',
    title: 'Complete Pending Works Every Run',
    description:
      'At the start of every run, scan the worklog and task list for pending / half-finished work and complete it before starting new work. Never leave loose ends across sessions.',
    category: 'operational',
    priority: 'high',
  },
  {
    key: 'visualise-graphs-text',
    title: 'Always Visualise with Graphs + Text',
    description:
      'Every report, analytics output, or status update must include both a textual summary and at least one chart / graph. Pure-text reports are not acceptable for decision-making data.',
    category: 'operational',
    priority: 'medium',
  },
  {
    key: 'show-pending-in-chat',
    title: 'Show Pending Works in Chat Every Run',
    description:
      'Every chat session must open with a brief list of pending works carried over from prior runs, so the operator always knows what is still on the table.',
    category: 'operational',
    priority: 'medium',
  },

  // ─── Safety Rules (new) ──────────────────────────────────────────────
  {
    key: 'never-remove-worklog',
    title: 'Never Remove Worklog Lines',
    description:
      'Worklog entries are append-only and immutable. Never remove a line — even if the user explicitly asks. If a correction is needed, append a new entry that supersedes the prior one.',
    category: 'safety',
    priority: 'critical',
  },
  {
    key: 'never-delete-important-files',
    title: 'Never Reset or Delete Important Files',
    description:
      'Never delete or reset schema.prisma, worklog.md, .env, package.json, lib/ files, or any agent-ctx record. Reset / wipe operations require owner voice approval and a full snapshot first.',
    category: 'safety',
    priority: 'critical',
  },
  {
    key: 'no-conflict-other-agents',
    title: 'Never Break Code or Conflict with Other Agents',
    description:
      'Parallel agents work on disjoint file sets. Never modify a file owned by another agent (check worklog task IDs). If a conflict is detected, stop and escalate to the orchestrator — do not overwrite.',
    category: 'safety',
    priority: 'critical',
  },
  {
    key: 'code-once-fixed-undisturbed',
    title: 'Code Once Fixed Should Not Be Disturbed',
    description:
      'Code that is working and lint-clean must not be refactored or touched unless there is a concrete bug or feature request. "Drive-by refactors" are forbidden — they introduce regression risk.',
    category: 'safety',
    priority: 'high',
  },

  // ─── Intelligence Rules (new) ────────────────────────────────────────
  {
    key: 'check-opensource-repos',
    title: 'Always Check Open-Source Repos for Improvements',
    description:
      'Before implementing any non-trivial feature, scan open-source repos (claude-mem, claude-superpowers, awesome-claude-code, agent SDKs, etc.) for existing solutions. Reuse > reinvent.',
    category: 'intelligence',
    priority: 'medium',
  },
  {
    key: 'learning-flexible-section',
    title: 'Learning Can Be Saved in Any Section + Auto-Move',
    description:
      'Learnings (observations, patterns, corrections) can be saved into any memory section freely. A nightly re-classifier reviews and auto-moves misplaced entries to the correct scope so the operator never has to file manually.',
    category: 'intelligence',
    priority: 'medium',
  },
  {
    key: 'dont-add-tabs-everything',
    title: "Don't Add Tabs for Everything — Integrate Creatively",
    description:
      'Resist the urge to add a new tab for every feature. Integrate new capabilities into existing tabs via modals, drawers, inline panels, or command-palette actions. Tab sprawl kills UX.',
    category: 'intelligence',
    priority: 'medium',
  },
  {
    key: 'use-available-codes',
    title: 'Use Available Codes from Repos / Zip — Don\'t Write from Scratch',
    description:
      'The internal zip has 250+ lib files; npm has millions of packages. Always exhaust available code before writing new code. New code is technical debt — reuse is leverage.',
    category: 'intelligence',
    priority: 'high',
  },
];

async function main() {
  console.log(`=== seed-rules.ts — upserting ${RULES.length} rules ===`);
  let created = 0;
  let updated = 0;

  for (const r of RULES) {
    const existing = await db.rule.findUnique({ where: { key: r.key } });
    if (existing) {
      await db.rule.update({
        where: { key: r.key },
        data: {
          title: r.title,
          description: r.description,
          category: r.category,
          priority: r.priority,
          enabled: r.enabled ?? true,
        },
      });
      updated++;
    } else {
      await db.rule.create({
        data: {
          key: r.key,
          title: r.title,
          description: r.description,
          category: r.category,
          priority: r.priority,
          enabled: r.enabled ?? true,
        },
      });
      created++;
      console.log(`  + ${r.key} [${r.category}/${r.priority}]`);
    }
  }

  const total = await db.rule.count();
  console.log(`\n✓ Created ${created} · Updated ${updated} · Total in DB: ${total}`);
  console.log('=== Done ===');
}

/**
 * Public entry point — callable from the in-app Demo Data panel
 * (`/api/admin/data` POST `script: 'rules'`). Idempotent — safe to re-run.
 */
export async function seedRules() {
  await main();
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error('Seed failed:', e);
      process.exit(1);
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
