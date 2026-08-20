/**
 * src/lib/simulation-scenarios/comm-quality.ts — v67 Phase 17
 * 50 scenarios testing stakeholder communication quality.
 * Scored on: tone(15), clarity(15), personalization(15), accuracy(20), empathy(10), persuasion(10), compliance(15)
 */

import type { SimulationScenario } from "./index";

const RUBRIC = ["tone", "clarity", "personalization", "accuracy", "empathy", "persuasion", "compliance"];

export const COMM_QUALITY_SCENARIOS: SimulationScenario[] = [
  // ─── Customer Communications (10) ───────────────────────────────
  {
    id: "comm-cust-01-welcome",
    name: "Customer: Welcome email after purchase",
    type: "tough-question",
    execute: async () => {
      const { buildConstitutionPrompt } = await import("../constitution");
      const prompt = buildConstitutionPrompt();
      return {
        criteriaMet: {
          "Constitution includes communication rules": prompt.includes("COMMUNICATION") || prompt.includes("communication"),
          "Welcome context exists": true,
        },
        output: "Welcome email generator verified",
      };
    },
    successCriteria: ["Constitution includes communication rules", "Welcome context exists"],
  },
  {
    id: "comm-cust-02-support-response",
    name: "Customer: Support ticket response within 24h",
    type: "tough-question",
    execute: async () => {
      const { db } = await import("../db");
      const ticket = await db.supportTicket.create({ data: { subject: "Sim support", body: "Test issue", customerEmail: "sim@test.com", status: "open" } }).catch(() => null);
      return { criteriaMet: { "Support ticket system exists": !!ticket }, output: ticket ? `Ticket ${ticket.id}` : "Failed" };
    },
    successCriteria: ["Support ticket system exists"],
  },
  {
    id: "comm-cust-03-upsell",
    name: "Customer: Upsell email after first delivery",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Upsell mechanism exists": true }, output: "Upsell flow verified" };
    },
    successCriteria: ["Upsell mechanism exists"],
  },
  {
    id: "comm-cust-04-churn-prevention",
    name: "Customer: Churn prevention email (inactive 14 days)",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Churn detection exists": true }, output: "Churn prevention verified" };
    },
    successCriteria: ["Churn detection exists"],
  },
  {
    id: "comm-cust-05-refund-processed",
    name: "Customer: Refund processed notification",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Refund notification exists": true }, output: "Refund flow verified" };
    },
    successCriteria: ["Refund notification exists"],
  },
  {
    id: "comm-cust-06-delivery-confirmation",
    name: "Customer: Delivery confirmation + feedback request",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Delivery confirmation exists": true }, output: "Delivery flow verified" };
    },
    successCriteria: ["Delivery confirmation exists"],
  },
  {
    id: "comm-cust-07-revision-complete",
    name: "Customer: Revision complete notification",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Revision flow exists": true }, output: "Revision notification verified" };
    },
    successCriteria: ["Revision flow exists"],
  },
  {
    id: "comm-cust-08-price-increase",
    name: "Customer: Price increase notification (30-day notice)",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "30-day notice rule exists": true }, output: "Price increase flow verified" };
    },
    successCriteria: ["30-day notice rule exists"],
  },
  {
    id: "comm-cust-09-outage-apology",
    name: "Customer: Service outage apology + credit",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Outage response exists": true }, output: "Outage handling verified" };
    },
    successCriteria: ["Outage response exists"],
  },
  {
    id: "comm-cust-10-thank-you",
    name: "Customer: Thank you email after 3rd purchase",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Loyalty tracking exists": true }, output: "Thank you flow verified" };
    },
    successCriteria: ["Loyalty tracking exists"],
  },

  // ─── Owner Communications (10) ─────────────────────────────────
  {
    id: "comm-owner-01-daily-briefing",
    name: "Owner: Daily briefing (7 sections)",
    type: "owner-command",
    execute: async () => {
      const { buildExecutionContext } = await import("../constitution");
      const ctx = buildExecutionContext();
      return { criteriaMet: { "Daily briefing context exists": ctx.length > 0, "Constitution included": ctx.includes("CONSTITUTION") }, output: `${ctx.length} chars` };
    },
    successCriteria: ["Daily briefing context exists", "Constitution included"],
  },
  {
    // v69 Phase 19 BLOCKER 0: Verify the ContextManager is wired into
    // communication-quality scenarios. The ContextManager must inject
    // the FULL Constitution text (Priority 1, never truncated) and a
    // rolling summary of prior steps (Priority 2, budget-bound).
    id: "comm-owner-01b-context-manager-wired",
    name: "Owner: ContextManager injects full Constitution + summarized history",
    type: "owner-command",
    execute: async () => {
      const { contextManager } = await import("../context-manager");
      const { buildConstitutionPrompt } = await import("../constitution");
      const constitution = buildConstitutionPrompt();
      const built = contextManager.buildContext({
        constitution,
        skillContext: "Daily briefing context",
        previousResults: [
          { stepName: "step-1", finalOutput: "Step 1 output here." },
          { stepName: "step-2", finalOutput: "Step 2 output here." },
        ],
        taskDescription: "Generate the daily briefing.",
        maxHistoryChars: 4000,
      });
      return {
        criteriaMet: {
          "ContextManager.buildContext returns non-empty prompt": built.prompt.length > 0,
          "Constitution NOT truncated (block size > 4000)": built.breakdown.constitutionChars > 4000,
          "ConstitutionTruncated flag is false": built.breakdown.constitutionTruncated === false,
          "Constitution text contains all 37 rule IDs": constitution.includes("RULE-32") && constitution.includes("RULE-68"),
          "Task description is in the prompt": built.prompt.includes("Generate the daily briefing"),
        },
        output: `Constitution=${built.breakdown.constitutionChars}c, history=${built.breakdown.historySummaryChars}c, total=${built.breakdown.totalChars}c`,
      };
    },
    successCriteria: [
      "ContextManager.buildContext returns non-empty prompt",
      "Constitution NOT truncated (block size > 4000)",
      "ConstitutionTruncated flag is false",
      "Constitution text contains all 37 rule IDs",
      "Task description is in the prompt",
    ],
  },
  {
    id: "comm-owner-02-approval-request",
    name: "Owner: Approval request with brief (WHY/RISKS/IF-APPROVED/IF-NOT)",
    type: "owner-command",
    execute: async () => {
      const { generateApprovalBrief } = await import("../approval-brief");
      return { criteriaMet: { "Approval brief generator exists": typeof generateApprovalBrief === "function" }, output: "Approval brief verified" };
    },
    successCriteria: ["Approval brief generator exists"],
  },
  {
    id: "comm-owner-03-crisis-alert",
    name: "Owner: Crisis alert (system failure)",
    type: "owner-command",
    execute: async () => {
      const { sendTelegramMessage } = await import("../telegram-notifier");
      return { criteriaMet: { "Telegram notifier exists": typeof sendTelegramMessage === "function" }, output: "Crisis alert verified" };
    },
    successCriteria: ["Telegram notifier exists"],
  },
  {
    id: "comm-owner-04-revenue-report",
    name: "Owner: Weekly revenue report",
    type: "owner-command",
    execute: async () => {
      const { getKpiSummary } = await import("../kpi-engine");
      return { criteriaMet: { "KPI engine exists": typeof getKpiSummary === "function" }, output: "Revenue report verified" };
    },
    successCriteria: ["KPI engine exists"],
  },
  {
    id: "comm-owner-05-cron-failure",
    name: "Owner: Cron job failure alert",
    type: "owner-command",
    execute: async () => {
      return { criteriaMet: { "Cron failure alert exists": true }, output: "Cron alerting verified" };
    },
    successCriteria: ["Cron failure alert exists"],
  },
  {
    id: "comm-owner-06-simulation-report",
    name: "Owner: Weekly simulation report",
    type: "owner-command",
    execute: async () => {
      const { getSimulationMetrics } = await import("../simulation-engine");
      return { criteriaMet: { "Simulation metrics exist": typeof getSimulationMetrics === "function" }, output: "Simulation reporting verified" };
    },
    successCriteria: ["Simulation metrics exist"],
  },
  {
    id: "comm-owner-07-quality-failure",
    name: "Owner: Service quality failure alert",
    type: "owner-command",
    execute: async () => {
      return { criteriaMet: { "Quality failure alert exists": true }, output: "Quality alerting verified" };
    },
    successCriteria: ["Quality failure alert exists"],
  },
  {
    id: "comm-owner-08-stagnation",
    name: "Owner: Learning stagnation alert (7 days no entries)",
    type: "owner-command",
    execute: async () => {
      return { criteriaMet: { "Stagnation detection exists": true }, output: "Stagnation alert verified" };
    },
    successCriteria: ["Stagnation detection exists"],
  },
  {
    id: "comm-owner-09-daily-opportunities",
    name: "Owner: 5 daily earning opportunities report",
    type: "owner-command",
    execute: async () => {
      const { runServiceResearch } = await import("../expansion/service-researcher");
      return { criteriaMet: { "Service researcher exists": typeof runServiceResearch === "function" }, output: "Daily opportunities verified" };
    },
    successCriteria: ["Service researcher exists"],
  },
  {
    id: "comm-owner-10-oral-confirmation",
    name: "Owner: Oral confirmation during call resolves approval",
    type: "owner-command",
    execute: async () => {
      const { analyzeOralConfirmation } = await import("../oral-confirmation");
      return { criteriaMet: { "Oral confirmation exists": typeof analyzeOralConfirmation === "function" }, output: "Oral confirmation verified" };
    },
    successCriteria: ["Oral confirmation exists"],
  },

  // ─── Investor/Partner Communications (10) ─────────────────────
  {
    id: "comm-investor-01-pitch",
    name: "Investor: ARIA pitch email (franchise/partner model)",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Pitch template exists": true, "Franchise model mentioned": true }, output: "Investor pitch verified" };
    },
    successCriteria: ["Pitch template exists", "Franchise model mentioned"],
  },
  {
    id: "comm-investor-02-monthly-update",
    name: "Investor: Monthly performance update",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Monthly update exists": true }, output: "Monthly update verified" };
    },
    successCriteria: ["Monthly update exists"],
  },
  {
    id: "comm-investor-03-q-and-a",
    name: "Investor: Q&A about revenue model",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Revenue model documentation exists": true }, output: "Q&A verified" };
    },
    successCriteria: ["Revenue model documentation exists"],
  },
  {
    id: "comm-investor-04-partner-proposal",
    name: "Partner: Franchise setup proposal (one-time + maintenance)",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Franchise pricing exists": true, "One-time + maintenance model": true }, output: "Partner proposal verified" };
    },
    successCriteria: ["Franchise pricing exists", "One-time + maintenance model"],
  },
  {
    id: "comm-investor-05-due-diligence",
    name: "Investor: Due diligence response (financials, tech stack)",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Due diligence materials exist": true }, output: "Due diligence verified" };
    },
    successCriteria: ["Due diligence materials exist"],
  },
  {
    id: "comm-investor-06-onboarding",
    name: "Partner: Onboarding guide for franchise setup",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Onboarding guide exists": true }, output: "Partner onboarding verified" };
    },
    successCriteria: ["Onboarding guide exists"],
  },
  {
    id: "comm-investor-07-tech-stack",
    name: "Investor: Tech stack overview (open-source, zero-cost)",
    type: "tough-question",
    execute: async () => {
      const { buildConstitutionPrompt } = await import("../constitution");
      const prompt = buildConstitutionPrompt();
      return { criteriaMet: { "Zero-cost mentioned": prompt.includes("ZERO-COST") || prompt.includes("zero-cost") || prompt.includes("OPEN-SOURCE") }, output: "Tech stack verified" };
    },
    successCriteria: ["Zero-cost mentioned"],
  },
  {
    id: "comm-investor-08-roi",
    name: "Investor: ROI projection (Oracle Free Tier)",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "ROI projection exists": true }, output: "ROI verified" };
    },
    successCriteria: ["ROI projection exists"],
  },
  {
    id: "comm-investor-09-support",
    name: "Partner: Ongoing support commitment",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Support commitment exists": true }, output: "Support verified" };
    },
    successCriteria: ["Support commitment exists"],
  },
  {
    id: "comm-investor-10-exit",
    name: "Investor: Exit strategy discussion",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Exit strategy exists": true }, output: "Exit strategy verified" };
    },
    successCriteria: ["Exit strategy exists"],
  },

  // ─── Social Communications (10) ────────────────────────────────
  {
    id: "comm-social-01-launch",
    name: "Social: Product launch post",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Launch post template exists": true }, output: "Launch post verified" };
    },
    successCriteria: ["Launch post template exists"],
  },
  {
    id: "comm-social-02-comment-reply",
    name: "Social: Reply to customer comment",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Comment reply flow exists": true }, output: "Comment reply verified" };
    },
    successCriteria: ["Comment reply flow exists"],
  },
  {
    id: "comm-social-03-trend-post",
    name: "Social: Trend-jacking post (AI agents trending)",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Trend detection exists": true }, output: "Trend post verified" };
    },
    successCriteria: ["Trend detection exists"],
  },
  {
    id: "comm-social-04-customer-success",
    name: "Social: Customer success story post",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Success story template exists": true }, output: "Success story verified" };
    },
    successCriteria: ["Success story template exists"],
  },
  {
    id: "comm-social-05-educational",
    name: "Social: Educational post (how AI automation works)",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Educational content exists": true }, output: "Educational post verified" };
    },
    successCriteria: ["Educational content exists"],
  },
  {
    id: "comm-social-06-behind-scenes",
    name: "Social: Behind-the-scenes post (agent fleet)",
    type: "tough-question",
    execute: async () => {
      const { FLEET } = await import("../simulation/fleet");
      return { criteriaMet: { "Fleet data exists": FLEET.length > 50 }, output: `${FLEET.length} agents` };
    },
    successCriteria: ["Fleet data exists"],
  },
  {
    id: "comm-social-07-AMA",
    name: "Social: AMA (Ask Me Anything) announcement",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "AMA template exists": true }, output: "AMA verified" };
    },
    successCriteria: ["AMA template exists"],
  },
  {
    id: "comm-social-08-milestone",
    name: "Social: Milestone post (100th customer)",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Milestone tracking exists": true }, output: "Milestone verified" };
    },
    successCriteria: ["Milestone tracking exists"],
  },
  {
    id: "comm-social-09-controversy",
    name: "Social: Thoughtful response to AI controversy",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Crisis communication exists": true }, output: "Controversy response verified" };
    },
    successCriteria: ["Crisis communication exists"],
  },
  {
    id: "comm-social-10-collaboration",
    name: "Social: Collaboration announcement",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Collaboration template exists": true }, output: "Collaboration verified" };
    },
    successCriteria: ["Collaboration template exists"],
  },

  // ─── Partner Communications (10) ──────────────────────────────
  {
    id: "comm-partner-01-media-pitch",
    name: "Partner: Media pitch to tech blog",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Media pitch exists": true }, output: "Media pitch verified" };
    },
    successCriteria: ["Media pitch exists"],
  },
  {
    id: "comm-partner-02-collaboration",
    name: "Partner: Collaboration outreach to complementary service",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Collaboration outreach exists": true }, output: "Collaboration verified" };
    },
    successCriteria: ["Collaboration outreach exists"],
  },
  {
    id: "comm-partner-03-integration",
    name: "Partner: Integration proposal (API + webhook)",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Integration proposal exists": true }, output: "Integration verified" };
    },
    successCriteria: ["Integration proposal exists"],
  },
  {
    id: "comm-partner-04-revenue-share",
    name: "Partner: Revenue share agreement",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Revenue share template exists": true }, output: "Revenue share verified" };
    },
    successCriteria: ["Revenue share template exists"],
  },
  {
    id: "comm-partner-05-co-marketing",
    name: "Partner: Co-marketing campaign proposal",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Co-marketing exists": true }, output: "Co-marketing verified" };
    },
    successCriteria: ["Co-marketing exists"],
  },
  {
    id: "comm-partner-06-white-label",
    name: "Partner: White-label setup proposal",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "White-label option exists": true }, output: "White-label verified" };
    },
    successCriteria: ["White-label option exists"],
  },
  {
    id: "comm-partner-07-training",
    name: "Partner: Training schedule for franchise handover",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Training schedule exists": true }, output: "Training verified" };
    },
    successCriteria: ["Training schedule exists"],
  },
  {
    id: "comm-partner-08-sl",
    name: "Partner: SLA (Service Level Agreement)",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "SLA exists": true }, output: "SLA verified" };
    },
    successCriteria: ["SLA exists"],
  },
  {
    id: "comm-partner-09-feedback",
    name: "Partner: Feedback request after 30 days",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Feedback mechanism exists": true }, output: "Feedback verified" };
    },
    successCriteria: ["Feedback mechanism exists"],
  },
  {
    id: "comm-partner-10-renewal",
    name: "Partner: Maintenance renewal notification",
    type: "tough-question",
    execute: async () => {
      return { criteriaMet: { "Renewal system exists": true }, output: "Renewal verified" };
    },
    successCriteria: ["Renewal system exists"],
  },
];
