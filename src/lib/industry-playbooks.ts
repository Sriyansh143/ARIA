/**
 * src/lib/industry-playbooks.ts — 12 industry playbooks.
 *
 * Server-only. Defines the canonical set of industry playbooks the
 * autonomous business engine operates against. Each playbook captures
 * the revenue models, KPI targets, risk factors, compliance needs,
 * department focus, and an LLM-ready operational prompt that the
 * engine feeds to routeLLM when generating opportunities/plans.
 *
 * The playbooks are deliberately concrete — every `operationalPlaybook`
 * is 3-5 sentences describing the primary revenue streams, customer
 * acquisition strategy, operational priorities, key risks, and
 * compliance needs for that industry.
 */

export interface RevenueModelEntry {
  name: string;
  description: string;
  margin: number; // 0-1 gross margin estimate
}

export interface KeyMetricEntry {
  name: string;
  target: string;
  unit: string;
}

export interface IndustryPlaybook {
  id: string;
  name: string;
  icon: string; // lucide icon string key (resolved by the dashboard)
  revenueModels: RevenueModelEntry[];
  keyMetrics: KeyMetricEntry[];
  riskFactors: string[];
  complianceRequirements: string[];
  agentFocus: string[]; // department names from DEPARTMENTS union
  operationalPlaybook: string;
}

// ─── 12 industries ──────────────────────────────────────────────────

export const INDUSTRY_PLAYBOOKS: IndustryPlaybook[] = [
  {
    id: "technology-saas",
    name: "Technology / SaaS",
    icon: "Cloud",
    revenueModels: [
      { name: "Subscription MRR", description: "Tiered monthly seats with usage caps", margin: 0.82 },
      { name: "Usage-based API", description: "Metered calls priced per 1k requests", margin: 0.74 },
      { name: "Professional services", description: "Onboarding + custom integrations", margin: 0.45 },
    ],
    keyMetrics: [
      { name: "Net MRR growth", target: "≥8%", unit: "% MoM" },
      { name: "Net revenue retention", target: "≥110%", unit: "%" },
      { name: "Gross margin", target: "≥75%", unit: "%" },
      { name: "CAC payback", target: "≤12", unit: "months" },
    ],
    riskFactors: [
      "Churn spike from pricing changes",
      "Cloud cost overruns on usage tiers",
      "Downtime SLA breach",
      "Platform risk (AWS/GCP dependency)",
    ],
    complianceRequirements: [
      "SOC 2 Type II",
      "GDPR data subject requests",
      "CCPA opt-out",
      "DPA + sub-processor disclosure",
    ],
    agentFocus: ["Engineering", "Sales", "Marketing", "Finance"],
    operationalPlaybook:
      "Primary revenue comes from tiered SaaS subscriptions plus a metered usage API; the customer acquisition strategy is product-led growth with a free tier that converts via in-app upgrade prompts, supported by targeted outbound to mid-market ICPs. Operational priorities are uptime (99.95% SLA), fast release cadence (weekly deploys behind feature flags), and aggressive monitoring of CAC payback under 12 months. Key risks include churn from pricing changes, cloud cost overruns on high-usage tenants, and platform dependency risk on the underlying cloud. Compliance requires SOC 2 Type II, GDPR/CCPA data subject tooling, and signed DPAs with sub-processor disclosure.",
  },
  {
    id: "e-commerce-retail",
    name: "E-commerce / Retail",
    icon: "ShoppingCart",
    revenueModels: [
      { name: "Direct product sales", description: "Marked-up physical goods", margin: 0.35 },
      { name: "Marketplace fees", description: "3rd-party seller commission", margin: 0.68 },
      { name: "Subscription loyalty", description: "Annual membership perks", margin: 0.55 },
    ],
    keyMetrics: [
      { name: "Conversion rate", target: "≥2.5%", unit: "%" },
      { name: "Average order value", target: "≥$85", unit: "USD" },
      { name: "Repeat purchase rate", target: "≥30%", unit: "%" },
      { name: "Fulfillment SLA", target: "≤48h", unit: "hours" },
    ],
    riskFactors: [
      "Inventory stockouts",
      "Returns fraud",
      "Ad platform CPM spikes",
      "Shipping carrier delays",
    ],
    complianceRequirements: [
      "PCI-DSS for card processing",
      "FTC product labeling",
      "State sales tax remittance",
      "Consumer refund policy",
    ],
    agentFocus: ["Sales", "Marketing", "Operations", "Support"],
    operationalPlaybook:
      "Revenue is anchored on direct product sales with a marketplace seller commission layer and a paid loyalty membership; acquisition runs through paid social ads, retention email/SMS, and SEO content targeting high-intent queries. Operational priorities are inventory turnover optimization, returns logistics, and fulfillment SLAs under 48 hours. Key risks are stockouts, returns fraud, ad-cost spikes eroding contribution margin, and carrier delays during peak season. Compliance requires PCI-DSS for card data, FTC-compliant product labeling, multi-state sales tax remittance, and a published consumer refund policy.",
  },
  {
    id: "finance-fintech",
    name: "Finance / FinTech",
    icon: "Landmark",
    revenueModels: [
      { name: "Transaction fees", description: "Per-payment processing %", margin: 0.62 },
      { name: "Interest margin", description: "Lending spread net of defaults", margin: 0.48 },
      { name: "Premium subscriptions", description: "Tiered financial tooling", margin: 0.78 },
    ],
    keyMetrics: [
      { name: "Active accounts", target: "≥100k", unit: "count" },
      { name: "Net charge-off rate", target: "≤2%", unit: "%" },
      { name: "Cost per funded loan", target: "≤$120", unit: "USD" },
      { name: "Regulatory capital ratio", target: "≥12%", unit: "%" },
    ],
    riskFactors: [
      "Credit portfolio defaults",
      "Regulatory enforcement",
      "AML false-positive overload",
      "Bank partner concentration",
    ],
    complianceRequirements: [
      "Bank Secrecy Act / AML",
      "KYC + KYB verification",
      "PCI-DSS Level 1",
      "State money transmitter licenses",
    ],
    agentFocus: ["Finance", "Compliance", "Engineering", "Sales"],
    operationalPlaybook:
      "Revenue is split between per-transaction fees, lending interest margin net of charge-offs, and a premium subscription for advanced financial tooling; acquisition targets underbanked SMBs and consumers via referral partnerships plus direct paid acquisition. Operational priorities are credit risk modeling, fraud detection latency under 200ms, and capital adequacy. Key risks are portfolio defaults in economic downturns, regulatory enforcement actions, AML false-positive overload, and bank-partner concentration. Compliance requires BSA/AML programs, KYC/KYB onboarding, PCI-DSS Level 1, and state money transmitter licenses.",
  },
  {
    id: "healthcare-biotech",
    name: "Healthcare / Biotech",
    icon: "Stethoscope",
    revenueModels: [
      { name: "Per-patient services", description: "Telehealth + diagnostics", margin: 0.42 },
      { name: "Licensing IP", description: "Patented compound licenses", margin: 0.85 },
      { name: "Device sales", description: "FDA-cleared hardware", margin: 0.55 },
    ],
    keyMetrics: [
      { name: "Patient NPS", target: "≥60", unit: "score" },
      { name: "Clinical trial enrollment", target: "≥95%", unit: "% of plan" },
      { name: "Time-to-FDA clearance", target: "≤18", unit: "months" },
      { name: "Reimbursement rate", target: "≥88%", unit: "%" },
    ],
    riskFactors: [
      "Clinical trial failure",
      "FDA enforcement",
      "Patient data breach",
      "Reimbursement rate cuts",
    ],
    complianceRequirements: [
      "HIPAA Privacy + Security Rule",
      "FDA 21 CFR Part 820 (QSR)",
      "GxP for clinical trials",
      "HITECH breach notification",
    ],
    agentFocus: ["Research", "Compliance", "Operations", "Legal"],
    operationalPlaybook:
      "Revenue comes from per-patient telehealth and diagnostics, IP licensing for patented compounds, and FDA-cleared device sales; acquisition runs through payer relationships, physician referrals, and direct-to-patient marketing where permitted. Operational priorities are clinical trial enrollment cadence, manufacturing quality systems, and reimbursement submission accuracy. Key risks are trial failure, FDA enforcement, patient data breach, and reimbursement rate compression from payers. Compliance requires HIPAA Privacy + Security, FDA 21 CFR Part 820 QSR, GxP trial management, and HITECH breach notification protocols.",
  },
  {
    id: "education-edtech",
    name: "Education / EdTech",
    icon: "GraduationCap",
    revenueModels: [
      { name: "Per-seat licenses", description: "B2B school/district contracts", margin: 0.72 },
      { name: "B2C subscriptions", description: "Direct learner monthly plans", margin: 0.65 },
      { name: "Certification fees", description: "Accredited exam delivery", margin: 0.58 },
    ],
    keyMetrics: [
      { name: "Daily active learners", target: "≥40%", unit: "% of MAU" },
      { name: "Course completion rate", target: "≥55%", unit: "%" },
      { name: "District renewal rate", target: "≥90%", unit: "%" },
      { name: "Cost per enrolled student", target: "≤$24", unit: "USD" },
    ],
    riskFactors: [
      "Seasonal enrollment dips",
      "FERPA data exposure",
      "District procurement cycles",
      "Free OpenEd substitutes",
    ],
    complianceRequirements: [
      "FERPA student records",
      "COPPA under-13 consent",
      "ADA WCAG 2.1 AA accessibility",
      "State curriculum standards",
    ],
    agentFocus: ["Education", "Sales", "Marketing", "Support"],
    operationalPlaybook:
      "Revenue is a mix of B2B per-seat school/district licenses, B2C learner subscriptions, and accredited certification fees; acquisition targets district procurement via RFP responses and direct learner funnel through SEO + free mini-courses. Operational priorities are content quality, accessibility WCAG 2.1 AA compliance, and learning-outcome measurement. Key risks are seasonal enrollment dips, FERPA data exposure, slow district procurement, and free OpenEd substitutes undercutting pricing. Compliance requires FERPA student record handling, COPPA parental consent for under-13, ADA accessibility, and state curriculum standard alignment.",
  },
  {
    id: "media-entertainment",
    name: "Media / Entertainment",
    icon: "Film",
    revenueModels: [
      { name: "Ad inventory CPM", description: "Programmatic + direct sold", margin: 0.6 },
      { name: "Subscription streaming", description: "Monthly SVOD tiers", margin: 0.55 },
      { name: "Licensing syndication", description: "Content rights to platforms", margin: 0.78 },
    ],
    keyMetrics: [
      { name: "Monthly active viewers", target: "≥500k", unit: "count" },
      { name: "Avg watch time / user", target: "≥45", unit: "min/day" },
      { name: "Ad fill rate", target: "≥85%", unit: "%" },
      { name: "Churn rate", target: "≤5%", unit: "% MoM" },
    ],
    riskFactors: [
      "Content licensing cost inflation",
      "Platform algorithm changes",
      "Copyright strikes",
      "Talent defection",
    ],
    complianceRequirements: [
      "DMCA takedown process",
      "FTC sponsored content disclosure",
      "Music sync licensing",
      "COPPA for kids content",
    ],
    agentFocus: ["Marketing", "Communications", "Sales", "Legal"],
    operationalPlaybook:
      "Revenue is driven by programmatic and direct-sold ad inventory, monthly SVOD subscriptions, and content licensing to downstream platforms; acquisition runs through social platform virality, influencer collaborations, and recommendation-algorithm optimization. Operational priorities are watch-time per viewer, ad fill rate, and content release cadence. Key risks are licensing cost inflation, recommendation algorithm shifts, copyright strikes, and talent defection. Compliance requires a DMCA takedown process, FTC sponsored-content disclosure, music sync licensing, and COPPA compliance for kids content.",
  },
  {
    id: "manufacturing",
    name: "Manufacturing",
    icon: "Factory",
    revenueModels: [
      { name: "Contract manufacturing", description: "Per-unit OEM builds", margin: 0.28 },
      { name: "Direct product sales", description: "Branded finished goods", margin: 0.4 },
      { name: "Spare parts + service", description: "Post-warranty support", margin: 0.62 },
    ],
    keyMetrics: [
      { name: "OEE", target: "≥85%", unit: "%" },
      { name: "On-time delivery", target: "≥95%", unit: "%" },
      { name: "Scrap rate", target: "≤2%", unit: "%" },
      { name: "Inventory turns", target: "≥8", unit: "per year" },
    ],
    riskFactors: [
      "Supply chain disruption",
      "Equipment downtime",
      "Raw material price spikes",
      "Workplace safety incidents",
    ],
    complianceRequirements: [
      "ISO 9001 quality",
      "OSHA workplace safety",
      "REACH / RoHS material",
      "EPA emissions",
    ],
    agentFocus: ["Operations", "Engineering", "Finance", "Sales"],
    operationalPlaybook:
      "Revenue combines contract manufacturing for OEMs, branded direct product sales, and a high-margin spare-parts-and-service after-sales business; acquisition targets industrial buyers via trade shows, distributor networks, and RFP responses. Operational priorities are OEE above 85%, on-time delivery above 95%, and lean inventory turns. Key risks are supply chain disruption, equipment downtime, raw material price spikes, and workplace safety incidents. Compliance requires ISO 9001 quality management, OSHA workplace safety, REACH/RoHS material disclosure, and EPA emissions reporting.",
  },
  {
    id: "real-estate",
    name: "Real Estate",
    icon: "Building2",
    revenueModels: [
      { name: "Commission on sales", description: "% of transaction value", margin: 0.7 },
      { name: "Property management fees", description: "Monthly % of rent roll", margin: 0.55 },
      { name: "Appreciation + rent", description: "Owned portfolio yield", margin: 0.5 },
    ],
    keyMetrics: [
      { name: "Days on market", target: "≤30", unit: "days" },
      { name: "Occupancy rate", target: "≥94%", unit: "%" },
      { name: "Rent collection rate", target: "≥98%", unit: "%" },
      { name: "Cap rate", target: "≥6%", unit: "%" },
    ],
    riskFactors: [
      "Interest rate hikes",
      "Local market downturn",
      "Tenant default",
      "Zoning/regulatory shifts",
    ],
    complianceRequirements: [
      "Fair Housing Act",
      "MLS rules + licensing",
      "ADA property accessibility",
      "State landlord-tenant law",
    ],
    agentFocus: ["Sales", "Finance", "Operations", "Legal"],
    operationalPlaybook:
      "Revenue is earned through transaction commissions, recurring property management fees, and yield from an owned rental portfolio; acquisition runs through MLS listings, agent referrals, and digital lead funnels for buyers and renters. Operational priorities are days-on-market compression, occupancy optimization, and rent collection discipline. Key risks are interest rate hikes depressing demand, local market downturns, tenant default, and zoning/regulatory shifts. Compliance requires Fair Housing Act adherence, MLS rules and agent licensing, ADA property accessibility, and state landlord-tenant law.",
  },
  {
    id: "consulting",
    name: "Consulting",
    icon: "Briefcase",
    revenueModels: [
      { name: "Billable hours", description: "Time-and-materials rate cards", margin: 0.55 },
      { name: "Fixed-fee projects", description: "Scoped deliverable contracts", margin: 0.45 },
      { name: "Retainers", description: "Monthly advisory access", margin: 0.7 },
    ],
    keyMetrics: [
      { name: "Utilization rate", target: "≥72%", unit: "%" },
      { name: "Realized rate", target: "≥85%", unit: "% of standard" },
      { name: "Project margin", target: "≥35%", unit: "%" },
      { name: "Client NPS", target: "≥50", unit: "score" },
    ],
    riskFactors: [
      "Key-person dependency",
      "Scope creep on fixed-fee",
      "Talent attrition",
      "Reputational delivery miss",
    ],
    complianceRequirements: [
      "Engagement letter contracts",
      "Conflict-of-interest register",
      "NDAs + confidentiality",
      "Professional liability (E&O) insurance",
    ],
    agentFocus: ["Sales", "Operations", "Finance", "Compliance"],
    operationalPlaybook:
      "Revenue is generated from billable hours at tiered rate cards, fixed-fee scoped projects, and recurring advisory retainers; acquisition runs through partner-led relationships, thought-leadership content, and case-study-driven referrals. Operational priorities are consultant utilization above 72%, project margin discipline, and IP reuse across engagements. Key risks are key-person dependency, scope creep on fixed-fee work, talent attrition, and reputational delivery misses. Compliance requires engagement-letter contracts, a conflict-of-interest register, NDAs with clients, and E&O professional liability insurance.",
  },
  {
    id: "marketing-agency",
    name: "Marketing Agency",
    icon: "Megaphone",
    revenueModels: [
      { name: "Monthly retainers", description: "Always-on service packages", margin: 0.5 },
      { name: "Project-based fees", description: "Campaign + creative deliverables", margin: 0.42 },
      { name: "Performance commission", description: "% of media spend or revenue lift", margin: 0.65 },
    ],
    keyMetrics: [
      { name: "Client retention", target: "≥85%", unit: "% annually" },
      { name: "Net deliverable margin", target: "≥40%", unit: "%" },
      { name: "ROAS for clients", target: "≥4x", unit: "ratio" },
      { name: "Creative throughput", target: "≥120", unit: "assets/mo" },
    ],
    riskFactors: [
      "Client budget cuts",
      "Platform ad-targeting changes",
      "Creative team turnover",
      "Pitch-loss rate spikes",
    ],
    complianceRequirements: [
      "FTC endorsement guides",
      "CAN-SPAM email compliance",
      "GDPR consent for outreach",
      "Brand-safety review process",
    ],
    agentFocus: ["Marketing", "Sales", "Creative", "Operations"],
    operationalPlaybook:
      "Revenue is split between monthly retainers, project-based creative fees, and performance commission tied to client media spend or revenue lift; acquisition runs through agency-of-record pitches, case-study content, and partner referrals. Operational priorities are creative throughput, client ROAS above 4x, and net deliverable margin. Key risks are client budget cuts, ad-platform targeting changes, creative-team turnover, and pitch-loss rate spikes. Compliance requires FTC endorsement guides, CAN-SPAM email rules, GDPR consent for outbound, and a brand-safety review process for placements.",
  },
  {
    id: "logistics-supply-chain",
    name: "Logistics / Supply Chain",
    icon: "Truck",
    revenueModels: [
      { name: "Freight margin", description: "Spread between shipper + carrier", margin: 0.18 },
      { name: "Subscription SaaS", description: "TMS / visibility platform seats", margin: 0.78 },
      { name: "Storage + handling", description: "3PL warehouse fees", margin: 0.35 },
    ],
    keyMetrics: [
      { name: "On-time pickup", target: "≥97%", unit: "%" },
      { name: "Cost per mile", target: "≤$2.10", unit: "USD" },
      { name: "Warehouse utilization", target: "≥80%", unit: "%" },
      { name: "Claims ratio", target: "≤0.5%", unit: "%" },
    ],
    riskFactors: [
      "Carrier capacity crunch",
      "Fuel price volatility",
      "Warehouse labor shortages",
      "Customs/border delays",
    ],
    complianceRequirements: [
      "DOT FMCSA operating authority",
      "Hazmat handling (49 CFR)",
      "Customs Trade Partnership (CTPAT)",
      "OSHA warehouse safety",
    ],
    agentFocus: ["Operations", "Engineering", "Finance", "Sales"],
    operationalPlaybook:
      "Revenue combines freight brokerage margin, a subscription TMS/visibility SaaS, and 3PL warehouse storage/handling fees; acquisition runs through RFP responses from shippers, carrier network growth, and inbound SaaS trials. Operational priorities are on-time pickup, warehouse utilization, and cost-per-mile discipline. Key risks are carrier capacity crunches, fuel-price volatility, warehouse labor shortages, and customs/border delays. Compliance requires DOT FMCSA operating authority, hazmat handling under 49 CFR, CTPAT customs partnership, and OSHA warehouse safety standards.",
  },
  {
    id: "hospitality",
    name: "Hospitality",
    icon: "BedDouble",
    revenueModels: [
      { name: "Room revenue (ADR)", description: "Nightly rate × occupancy", margin: 0.45 },
      { name: "F&B + ancillary", description: "Restaurant, spa, events", margin: 0.55 },
      { name: "Loyalty + packages", description: "Direct booking perks", margin: 0.6 },
    ],
    keyMetrics: [
      { name: "Occupancy rate", target: "≥78%", unit: "%" },
      { name: "ADR", target: "≥$165", unit: "USD" },
      { name: "RevPAR", target: "≥$130", unit: "USD" },
      { name: "Guest NPS", target: "≥55", unit: "score" },
    ],
    riskFactors: [
      "Seasonal demand swings",
      "OTA commission erosion",
      "Health/safety incidents",
      "Brand reputation online",
    ],
    complianceRequirements: [
      "ADA room accessibility",
      "Health department permits",
      "PCI-DSS payment handling",
      "Liquor licensing",
    ],
    agentFocus: ["Operations", "Sales", "Marketing", "Support"],
    operationalPlaybook:
      "Revenue is anchored on nightly room revenue (ADR × occupancy), food-and-beverage plus ancillary services, and direct-booking loyalty packages; acquisition runs through OTA distribution, direct brand.com marketing, and corporate-group sales. Operational priorities are RevPAR growth, labor scheduling efficiency, and guest experience consistency. Key risks are seasonal demand swings, OTA commission erosion, health/safety incidents, and online reputation damage. Compliance requires ADA room accessibility, health-department permits, PCI-DSS payment handling, and liquor licensing.",
  },
];

// ─── Lookup ─────────────────────────────────────────────────────────

export function getPlaybook(id: string): IndustryPlaybook | undefined {
  return INDUSTRY_PLAYBOOKS.find((p) => p.id === id);
}

export type { IndustryPlaybook as default };
