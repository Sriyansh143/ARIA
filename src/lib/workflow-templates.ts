/**
 * src/lib/workflow-templates.ts — Cross-functional Workflow Templates.
 *
 * Adds 5 new multi-step workflow templates that span departments —
 * product launches, client onboarding, marketing campaigns, support
 * ticket resolution, and monthly book close. Each template re-uses the
 * existing Workflow / WorkflowStep interfaces from workflow-engine.ts
 * so they run through the same `executeWorkflow()` pipeline.
 *
 * `getAllWorkflowTemplates()` combines the existing 3 templates (from
 * workflow-engine.ts) with these 5 new ones to give the dashboard a
 * single canonical list.
 *
 * Task ID: FEATURES-MULTICOMPANY-WORKFLOWS-CONNECTORS.
 */
import {
  WORKFLOW_TEMPLATES,
  type Workflow,
  type WorkflowStep,
} from "./workflow-engine";

// ─── 5 Cross-Functional Workflow Templates ────────────────────────

export const CROSS_FUNCTIONAL_WORKFLOWS: Workflow[] = [
  // 1. Launch New Product ───────────────────────────────────────────
  {
    id: "wf-launch-product",
    name: "Launch New Product",
    description:
      "Cross-functional product launch: market research → competitive analysis → spec → pricing → landing page → announcement → metrics tracking",
    trigger: "manual",
    status: "active",
    steps: [
      {
        id: "market_research",
        type: "llm_call",
        name: "Market Research",
        config: {
          agent: "Aria-CTO",
          prompt:
            "Analyze the target market for this new product. Identify 3 customer segments, their pain points, willingness to pay, and the top 3 competitors already serving each segment.",
        },
        next: "competitive_analysis",
      },
      {
        id: "competitive_analysis",
        type: "llm_call",
        name: "Competitive Analysis",
        config: {
          agent: "Vector-Sales",
          prompt:
            "For each competitor identified in market research, summarize their pricing, positioning, key strengths, and one exploitable weakness.",
        },
        next: "product_spec",
      },
      {
        id: "product_spec",
        type: "llm_call",
        name: "Product Spec",
        config: {
          agent: "Aria-CTO",
          prompt:
            "Draft a one-page MVP product spec: 5 must-have features, the technical architecture sketch, and 2 explicit non-goals to keep scope tight.",
        },
        next: "pricing_strategy",
      },
      {
        id: "pricing_strategy",
        type: "llm_call",
        name: "Pricing Strategy",
        config: {
          agent: "Ledger-Fin",
          prompt:
            "Recommend a 3-tier pricing model (free / pro / enterprise). Justify each price point against competitor pricing and the customer willingness-to-pay data.",
        },
        next: "landing_page_copy",
      },
      {
        id: "landing_page_copy",
        type: "tool_call",
        name: "Landing Page Copy",
        config: {
          tool: "send_email",
          params: { template: "landing_page_copy", deliverable: "Hero, features, CTA, FAQ" },
        },
        next: "launch_announcement",
      },
      {
        id: "launch_announcement",
        type: "notification",
        name: "Launch Announcement",
        config: {
          channel: "telegram",
          template: "product_launch_announcement",
        },
        next: "metrics_tracking",
      },
      {
        id: "metrics_tracking",
        type: "data_fetch",
        name: "Metrics Tracking",
        config: {
          query: "revenue_summary",
          tracking_window: "first_30_days",
        },
        next: "end",
      },
      {
        id: "end",
        type: "end",
        name: "Complete",
        config: {},
      },
    ],
  },

  // 2. Onboard New Client ───────────────────────────────────────────
  {
    id: "wf-onboard-client",
    name: "Onboard New Client",
    description:
      "Welcome email → kickoff prep → account setup → resource allocation → first deliverable → satisfaction check → handoff to customer success",
    trigger: "event",
    status: "active",
    steps: [
      {
        id: "welcome_email",
        type: "notification",
        name: "Welcome Email",
        config: {
          channel: "telegram",
          template: "client_welcome_email",
        },
        next: "kickoff_meeting_prep",
      },
      {
        id: "kickoff_meeting_prep",
        type: "llm_call",
        name: "Kickoff Meeting Prep",
        config: {
          agent: "Vector-Sales",
          prompt:
            "Draft a kickoff meeting agenda covering: project scope, success criteria, communication cadence, key contacts, and a risk register. Include 3 clarifying questions for the client.",
        },
        next: "account_setup",
      },
      {
        id: "account_setup",
        type: "tool_call",
        name: "Account Setup",
        config: {
          tool: "send_email",
          params: { action: "create_client_workspace", provision: ["slack_channel", "drive_folder"] },
        },
        next: "resource_allocation",
      },
      {
        id: "resource_allocation",
        type: "llm_call",
        name: "Resource Allocation",
        config: {
          agent: "Aria-CEO",
          prompt:
            "Given the client's stated goals + the kickoff agenda, propose a 3-person delivery team (roles only, not names) and a weekly time allocation per role.",
        },
        next: "first_deliverable",
      },
      {
        id: "first_deliverable",
        type: "tool_call",
        name: "First Deliverable",
        config: {
          tool: "send_email",
          params: { deliverable: "quick_win", due_in_days: 7 },
        },
        next: "satisfaction_check",
      },
      {
        id: "satisfaction_check",
        type: "approval",
        name: "Satisfaction Check",
        config: {
          risk: "medium",
          title: "Client Onboarding Satisfaction Check",
        },
        next: "handoff_to_success",
      },
      {
        id: "handoff_to_success",
        type: "notification",
        name: "Handoff to Customer Success",
        config: {
          channel: "telegram",
          template: "client_handoff_to_cs",
        },
        next: "end",
      },
      {
        id: "end",
        type: "end",
        name: "Complete",
        config: {},
      },
    ],
  },

  // 3. Run Marketing Campaign ───────────────────────────────────────
  {
    id: "wf-marketing-campaign",
    name: "Run Marketing Campaign",
    description:
      "Audience research → message crafting → channel selection → content creation → schedule deployment → performance tracking → optimization report",
    trigger: "schedule",
    status: "active",
    steps: [
      {
        id: "audience_research",
        type: "data_fetch",
        name: "Audience Research",
        config: {
          query: "recent_agent_logs",
          target: "icp_segments",
          limit: 10,
        },
        next: "message_crafting",
      },
      {
        id: "message_crafting",
        type: "llm_call",
        name: "Message Crafting",
        config: {
          agent: "Nova-Marketing",
          prompt:
            "Craft 3 distinct message angles for the target audience. Each angle must hook a different emotional driver (fear, aspiration, social proof). 80 words max per angle.",
        },
        next: "channel_selection",
      },
      {
        id: "channel_selection",
        type: "llm_call",
        name: "Channel Selection",
        config: {
          agent: "Nova-Marketing",
          prompt:
            "For each message angle, recommend the best 2 channels (email / paid social / SEO / partnerships / communities) with budget split rationale.",
        },
        next: "content_creation",
      },
      {
        id: "content_creation",
        type: "tool_call",
        name: "Content Creation",
        config: {
          tool: "send_email",
          params: { deliverable: "creative_assets", assets: ["hero_image", "3_ad_variants", "landing_page"] },
        },
        next: "schedule_deployment",
      },
      {
        id: "schedule_deployment",
        type: "notification",
        name: "Schedule Deployment",
        config: {
          channel: "telegram",
          template: "campaign_deployment_schedule",
        },
        next: "performance_tracking",
      },
      {
        id: "performance_tracking",
        type: "data_fetch",
        name: "Performance Tracking",
        config: {
          query: "revenue_summary",
          tracking_window: "campaign_runtime",
        },
        next: "optimization_report",
      },
      {
        id: "optimization_report",
        type: "llm_call",
        name: "Optimization Report",
        config: {
          agent: "Nova-Marketing",
          prompt:
            "Analyze campaign performance data. Identify the winning message angle, the underperforming channel, and 3 concrete optimizations for the next sprint.",
        },
        next: "end",
      },
      {
        id: "end",
        type: "end",
        name: "Complete",
        config: {},
      },
    ],
  },

  // 4. Handle Support Ticket ────────────────────────────────────────
  {
    id: "wf-support-ticket",
    name: "Handle Support Ticket",
    description:
      "Ticket triage → root cause analysis → resolution draft → customer communication → resolution apply → follow-up schedule → CSAT measurement",
    trigger: "event",
    status: "active",
    steps: [
      {
        id: "ticket_triage",
        type: "llm_call",
        name: "Ticket Triage",
        config: {
          agent: "Sage-Support",
          prompt:
            "Classify this support ticket: priority (P0/P1/P2/P3), category (bug / billing / how-to / feature-request), severity, and assign a target first-response SLA in minutes.",
        },
        next: "root_cause_analysis",
      },
      {
        id: "root_cause_analysis",
        type: "llm_call",
        name: "Root Cause Analysis",
        config: {
          agent: "Aria-CTO",
          prompt:
            "Investigate the reported issue. Identify the most likely root cause (with confidence %), the affected system component, and a hypothesis on when it was introduced.",
        },
        next: "resolution_draft",
      },
      {
        id: "resolution_draft",
        type: "llm_call",
        name: "Resolution Draft",
        config: {
          agent: "Sage-Support",
          prompt:
            "Draft a 3-step resolution procedure for the customer. If a workaround exists, lead with it. If a code fix is required, draft the engineer handoff brief.",
        },
        next: "customer_communication",
      },
      {
        id: "customer_communication",
        type: "notification",
        name: "Customer Communication",
        config: {
          channel: "telegram",
          template: "support_customer_update",
        },
        next: "resolution_apply",
      },
      {
        id: "resolution_apply",
        type: "tool_call",
        name: "Resolution Apply",
        config: {
          tool: "send_email",
          params: { action: "apply_resolution", require_confirmation: true },
        },
        next: "followup_schedule",
      },
      {
        id: "followup_schedule",
        type: "notification",
        name: "Follow-up Schedule",
        config: {
          channel: "log",
          template: "support_followup_scheduled",
          delay_hours: 48,
        },
        next: "csat_measurement",
      },
      {
        id: "csat_measurement",
        type: "approval",
        name: "CSAT Measurement",
        config: {
          risk: "low",
          title: "Customer Satisfaction Survey",
        },
        next: "end",
      },
      {
        id: "end",
        type: "end",
        name: "Complete",
        config: {},
      },
    ],
  },

  // 5. Monthly Close Books ──────────────────────────────────────────
  {
    id: "wf-monthly-close",
    name: "Monthly Close Books",
    description:
      "Revenue reconciliation → expense categorization → invoice generation → payment verification → financial statements → tax review → archive records",
    trigger: "schedule",
    status: "active",
    steps: [
      {
        id: "revenue_reconciliation",
        type: "data_fetch",
        name: "Revenue Reconciliation",
        config: {
          query: "revenue_summary",
          period: "last_month",
        },
        next: "expense_categorization",
      },
      {
        id: "expense_categorization",
        type: "llm_call",
        name: "Expense Categorization",
        config: {
          agent: "Ledger-Fin",
          prompt:
            "Categorize last month's expenses into 6 standard buckets (COGS, payroll, marketing, infrastructure, ops, other). Flag any uncategorized or anomalous line items.",
        },
        next: "invoice_generation",
      },
      {
        id: "invoice_generation",
        type: "tool_call",
        name: "Invoice Generation",
        config: {
          tool: "send_email",
          params: { action: "generate_outstanding_invoices", due_in_days: 15 },
        },
        next: "payment_verification",
      },
      {
        id: "payment_verification",
        type: "data_fetch",
        name: "Payment Verification",
        config: {
          query: "recent_agent_logs",
          target: "verified_payments",
          limit: 50,
        },
        next: "financial_statements",
      },
      {
        id: "financial_statements",
        type: "llm_call",
        name: "Financial Statements",
        config: {
          agent: "Ledger-Fin",
          prompt:
            "Generate the 3 standard financial statements (P&L, balance sheet, cash flow) from the reconciled data. Summarize 3 key takeaways per statement.",
        },
        next: "tax_review",
      },
      {
        id: "tax_review",
        type: "approval",
        name: "Tax Review",
        config: {
          risk: "high",
          title: "Monthly Tax Review & Filing Approval",
        },
        next: "archive_records",
      },
      {
        id: "archive_records",
        type: "tool_call",
        name: "Archive Records",
        config: {
          tool: "send_email",
          params: { action: "archive_monthly_close", retention_years: 7 },
        },
        next: "end",
      },
      {
        id: "end",
        type: "end",
        name: "Complete",
        config: {},
      },
    ],
  },
];

// ─── Combinator ────────────────────────────────────────────────────

/**
 * Return every available workflow template — the 3 existing ones from
 * workflow-engine.ts plus the 5 new cross-functional templates defined
 * in this file. The dashboard lists these together.
 */
export function getAllWorkflowTemplates(): Workflow[] {
  // De-dup by id in case CROSS_FUNCTIONAL_WORKFLOWS ever collides with
  // WORKFLOW_TEMPLATES — the canonical list wins.
  const seen = new Set<string>();
  const out: Workflow[] = [];
  for (const wf of [...WORKFLOW_TEMPLATES, ...CROSS_FUNCTIONAL_WORKFLOWS]) {
    if (seen.has(wf.id)) continue;
    seen.add(wf.id);
    out.push(wf);
  }
  return out;
}

// Re-export the step type so callers can construct ad-hoc templates.
export type { Workflow, WorkflowStep };
