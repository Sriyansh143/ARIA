// seed-earning-methods.ts — seeds 15 earning methods across 9 categories.
// Run with: bun run scripts/seed-earning-methods.ts (or bunx tsx scripts/seed-earning-methods.ts)

import { db } from '../src/lib/db';

interface MethodSeed {
  key: string;
  name: string;
  description: string;
  category: string;
  earningPotential: string;
  riskLevel: string;
  skillsRequired: string[];
  method: string;
  estimatedMonthly: number;
  tags: string[];
  approved: boolean;
  enabled: boolean;
}

const SEEDS: MethodSeed[] = [
  {
    key: 'freelance-fullstack-dev',
    name: 'Freelance Full-Stack Development',
    description: 'Take on Next.js / TypeScript / TailwindCSS freelance contracts on Upwork or Toptal. Build SaaS MVPs, dashboards, and internal tools.',
    category: 'freelance',
    earningPotential: 'high',
    riskLevel: 'low',
    skillsRequired: ['next.js', 'typescript', 'tailwindcss', 'prisma', 'shadcn/ui'],
    method: '1. Set up an Upwork profile highlighting Next.js 16 expertise\n2. Apply to 5 SaaS MVP / dashboard gigs daily\n3. Send a Loom walkthrough of a relevant portfolio piece with each proposal\n4. Deliver in 2-week sprints; ask for a 5-star review on completion\n5. After 3 reviews, raise hourly rate by 30%',
    estimatedMonthly: 120000,
    tags: ['remote', 'b2b', 'recurring'],
    approved: true,
    enabled: true,
  },
  {
    key: 'content-technical-blog',
    name: 'Technical Blog on Medium / Dev.to',
    description: 'Write in-depth technical tutorials on Next.js, AI agents, and Prisma. Monetize via Medium Partner Program + sponsorships.',
    category: 'content',
    earningPotential: 'medium',
    riskLevel: 'none',
    skillsRequired: ['writing', 'next.js', 'ai-agents', 'seo'],
    method: '1. Pick one technical topic per week\n2. Write a 2,000-word tutorial with code samples\n3. Cross-post to Medium + Dev.to + Hashnode\n4. Submit to newsletters (Bytes, TLDR, JavaScript Weekly)\n5. After 20 posts, pitch sponsorships to dev-tool companies',
    estimatedMonthly: 35000,
    tags: ['passive', 'content-marketing', 'seo'],
    approved: true,
    enabled: true,
  },
  {
    key: 'saas-micro-tool',
    name: 'Micro-SaaS Tool (Single-Feature)',
    description: 'Ship a single-feature SaaS — e.g. cron-job monitor, invoice PDF generator, or webhook inspector. Charge $9/mo.',
    category: 'saas',
    earningPotential: 'high',
    riskLevel: 'medium',
    skillsRequired: ['next.js', 'stripe', 'prisma', 'product-design'],
    method: '1. Identify a painful, narrow problem from r/SaaS or IndieHackers\n2. Ship an MVP in 2 weeks (Next.js + Stripe + Prisma)\n3. Launch on ProductHunt + 3 niche subreddits\n4. Charge from day 1 — $9/mo, no free tier\n5. Iterate weekly based on customer interviews',
    estimatedMonthly: 80000,
    tags: ['recurring', 'indie', 'b2c', 'b2b'],
    approved: true,
    enabled: false,
  },
  {
    key: 'consulting-ai-architecture',
    name: 'AI Architecture Consulting',
    description: 'Advise startups on LLM stack selection, agent orchestration, and RAG pipeline design. Charge $200/hr.',
    category: 'consulting',
    earningPotential: 'high',
    riskLevel: 'low',
    skillsRequired: ['llm-architecture', 'rag', 'agent-orchestration', 'communication'],
    method: '1. Publish 5 case studies on LinkedIn / X\n2. Optimize LinkedIn profile for "AI consultant" search\n3. Offer free 30-min discovery calls\n4. Convert 1 in 3 calls to $5k+ retainers\n5. Build referral pipeline with dev agencies',
    estimatedMonthly: 200000,
    tags: ['high-ticket', 'b2b', 'retainer'],
    approved: true,
    enabled: true,
  },
  {
    key: 'automation-zapier-templates',
    name: 'Zapier / n8n Workflow Templates',
    description: 'Build and sell automation templates — CRM sync, lead enrichment, social scheduling. Sell on Gumroad.',
    category: 'automation',
    earningPotential: 'medium',
    riskLevel: 'none',
    skillsRequired: ['zapier', 'n8n', 'api-design', 'marketing'],
    method: '1. Identify 10 common SMB workflow pain points\n2. Build a tested Zapier/n8n template for each\n3. Bundle as a $49 Gumroad pack\n4. Create a YouTube short demo per template\n5. Run $5/day YouTube ads on the demos',
    estimatedMonthly: 25000,
    tags: ['passive', 'templates', 'gumroad'],
    approved: true,
    enabled: true,
  },
  {
    key: 'data-scraping-service',
    name: 'Custom Web Scraping Service',
    description: 'Build scraping pipelines for B2B clients — lead lists, price monitoring, market research. Charge per-1k-rows.',
    category: 'data',
    earningPotential: 'medium',
    riskLevel: 'medium',
    skillsRequired: ['python', 'playwright', 'data-pipelines', 'sql'],
    method: '1. Pick a niche (e.g. real-estate listings, e-commerce prices)\n2. Build a robust Playwright scraper with proxies\n3. List on Fiverr + Upwork + cold email 50 prospects\n4. Deliver data weekly in CSV/JSON\n5. Upsell to monthly subscriptions',
    estimatedMonthly: 60000,
    tags: ['b2b', 'recurring', 'data'],
    approved: false,
    enabled: false,
  },
  {
    key: 'creative-ai-art-commissions',
    name: 'AI Art Commissions (Brand Assets)',
    description: 'Generate brand kits, logos, and social media graphics for small businesses using AI image generation.',
    category: 'creative',
    earningPotential: 'low',
    riskLevel: 'none',
    skillsRequired: ['prompt-engineering', 'image-gen', 'branding', 'figma'],
    method: '1. Build a 20-piece portfolio on Behance\n2. List commissions on Fiverr ($50-$200 per pack)\n3. Cold-DM 10 small Instagram businesses daily\n4. Deliver in 48h with 3 revisions\n5. Bundle into $499 brand kits after 10 sales',
    estimatedMonthly: 18000,
    tags: ['creative', 'b2c', 'fiverr'],
    approved: true,
    enabled: true,
  },
  {
    key: 'support-devtools-docs',
    name: 'Dev Tools Documentation Service',
    description: 'Write API docs, SDK guides, and onboarding flows for dev-tool startups. Charge per project.',
    category: 'support',
    earningPotential: 'medium',
    riskLevel: 'none',
    skillsRequired: ['technical-writing', 'api-design', 'markdown', 'developer-experience'],
    method: '1. Audit 5 dev-tool websites for doc gaps\n2. Pitch fixes to their head of DX\n3. Quote $2k-$5k per doc overhaul\n4. Deliver in Notion + Markdown + Mintlify-compatible format\n5. Ask for testimonials + referrals',
    estimatedMonthly: 70000,
    tags: ['b2b', 'high-ticket', 'writing'],
    approved: true,
    enabled: false,
  },
  {
    key: 'affiliate-devtools',
    name: 'Dev-Tool Affiliate Reviews',
    description: 'Review dev tools (Vercel, Supabase, Linear) on a niche blog. Earn affiliate commissions on signups.',
    category: 'affiliate',
    earningPotential: 'low',
    riskLevel: 'none',
    skillsRequired: ['seo', 'writing', 'next.js', 'analytics'],
    method: '1. Pick 20 dev tools with affiliate programs\n2. Write honest 1,500-word reviews with screenshots\n3. Build comparison pages (A vs B)\n4. SEO for "best [tool] alternative" keywords\n5. Pin affiliate links in a weekly newsletter',
    estimatedMonthly: 22000,
    tags: ['passive', 'affiliate', 'seo'],
    approved: true,
    enabled: true,
  },
  {
    key: 'freelance-bug-bounty',
    name: 'Bug Bounty Hunting',
    description: 'Hunt security bugs on HackerOne and Bugcrowd for bounties. Focus on Next.js + Prisma apps.',
    category: 'freelance',
    earningPotential: 'medium',
    riskLevel: 'high',
    skillsRequired: ['security', 'owasp', 'burp-suite', 'next.js'],
    method: '1. Set up HackerOne + Bugcrowd profiles\n2. Read public disclosures daily for new attack vectors\n3. Pick 3 programs with responsive triagers\n4. Submit 1 quality report per week (prefer auth bypass + IDOR)\n5. Reinvest bounties into a Burp Suite Pro license',
    estimatedMonthly: 45000,
    tags: ['security', 'bounty', 'variable'],
    approved: false,
    enabled: false,
  },
  // ── D-1 additions: 5 more methods (total 15). ──
  {
    key: 'data-ai-training-labeling',
    name: 'AI Training Data Labeling',
    description: 'Provide high-quality labeled datasets (RLHF, image segmentation, intent classification) to AI labs and startups. Charge per-1k-labeled-rows with premium pricing for domain expertise (medical, legal, code).',
    category: 'data',
    earningPotential: 'medium',
    riskLevel: 'low',
    skillsRequired: ['data-annotation', 'python', 'domain-expertise', 'quality-assurance'],
    method: '1. Sign up as a contributor on Scale AI, Surge AQ, Toloka, and Invisible Technologies\n2. Build a small labeling pipeline using Label Studio for side projects\n3. Specialize in a domain (code, medical, legal) to command 2-3x base rates\n4. Submit a portfolio of 3 perfectly-labeled batches to land enterprise contracts\n5. Hire 2 vetted reviewers and resell QC\'d batches at a 40% margin',
    estimatedMonthly: 55000,
    tags: ['ai', 'data-labeling', 'remote', 'b2b'],
    approved: true,
    enabled: true,
  },
  {
    key: 'creative-podcast-production',
    name: 'Podcast Production Service',
    description: 'End-to-end podcast production for B2B founders and creators — editing, show notes, clips, distribution. Charge a monthly retainer per show.',
    category: 'creative',
    earningPotential: 'medium',
    riskLevel: 'low',
    skillsRequired: ['audio-editing', 'descript', 'content-marketing', 'show-notes-writing'],
    method: '1. Build a 3-episode demo reel using Descript + Adobe Audition\n2. List on Upwork + Podcasters\' Paradise + cold-DM 30 LinkedIn founders/week\n3. Offer a $499/mo starter tier (edit + show notes + 3 audiograms)\n4. Upsell to $1,499/mo full production (guest outreach + distribution + YouTube repurposing)\n5. After 5 retainers, hire an editor and operate at 60% margin',
    estimatedMonthly: 90000,
    tags: ['retainer', 'b2b', 'creative', 'audio'],
    approved: true,
    enabled: true,
  },
  {
    key: 'content-newsletter-monetization',
    name: 'Newsletter Monetization (Beehiiv/Substack)',
    description: 'Build a niche B2B newsletter (e.g. AI tooling for SMBs, fintech ops) and monetize via paid sponsorships + paid tier. Aim for 5k engaged subscribers in 9 months.',
    category: 'content',
    earningPotential: 'medium',
    riskLevel: 'none',
    skillsRequired: ['writing', 'audience-building', 'beehiiv', 'sponsorship-sales'],
    method: '1. Pick a narrow B2B niche with high advertiser demand (AI tools, dev-tools, fintech)\n2. Set up on Beehiiv with a referral program + welcome sequence\n3. Publish 2 issues/week — 1 deep-dive, 1 curated link list\n4. Cross-promote in 3 niche communities + LinkedIn 3x/week\n5. At 2k subscribers, sell $250 sponsor slots; at 5k, add a $9/mo paid tier',
    estimatedMonthly: 48000,
    tags: ['passive', 'newsletter', 'b2b', 'sponsorship'],
    approved: true,
    enabled: true,
  },
  {
    key: 'support-technical-docs-writing',
    name: 'Technical Documentation Writing',
    description: 'Write developer-facing docs (API references, SDK guides, tutorials, onboarding flows) for dev-tool startups. Charge per-project or monthly retainer.',
    category: 'support',
    earningPotential: 'medium',
    riskLevel: 'none',
    skillsRequired: ['technical-writing', 'markdown', 'api-design', 'mintlify', 'developer-experience'],
    method: '1. Audit 10 dev-tool websites (Vercel, Supabase competitors) for doc gaps\n2. Build a portfolio of 3 sample guides (quickstart, API ref, migration)\n3. Pitch Heads of DX / DevRel on LinkedIn — quote $3k-$8k per doc overhaul\n4. Deliver in Mintlify-compatible Markdown + OpenAPI specs\n5. Bundle into a $2,500/mo retainer: 4 articles + 1 API ref update',
    estimatedMonthly: 95000,
    tags: ['b2b', 'retainer', 'writing', 'dev-tools'],
    approved: true,
    enabled: true,
  },
  {
    key: 'automation-api-testing-service',
    name: 'API Testing Services (QA-as-a-Service)',
    description: 'Offer contract API testing for startups — Postman collections, contract tests, load tests, and CI integration. Charge per-endpoint or monthly retainer.',
    category: 'automation',
    earningPotential: 'medium',
    riskLevel: 'low',
    skillsRequired: ['postman', 'newman', 'k6', 'ci-cd', 'api-design'],
    method: '1. Build 3 reference Postman collections for popular SaaS APIs (Stripe, Supabase, Resend)\n2. List on Upwork + Toptal + cold-email 50 Series A startups/week\n3. Quote $2k for an API test-suite audit + Postman collection delivery\n4. Upsell a $1,500/mo retainer: CI integration via Newman + weekly load tests with k6\n5. Productize as a $99/mo "API QA dashboard" SaaS after 10 retainers',
    estimatedMonthly: 75000,
    tags: ['b2b', 'retainer', 'qa', 'automation'],
    approved: true,
    enabled: true,
  },
];

async function main() {
  console.log('Seeding earning methods…');
  let added = 0;
  let skipped = 0;

  for (const s of SEEDS) {
    const existing = await db.earningMethod.findUnique({ where: { key: s.key } });
    if (existing) {
      console.log(`  [skip] ${s.key} (already exists)`);
      skipped++;
      continue;
    }
    await db.earningMethod.create({
      data: {
        key: s.key,
        name: s.name,
        description: s.description,
        category: s.category,
        earningPotential: s.earningPotential,
        riskLevel: s.riskLevel,
        skillsRequired: JSON.stringify(s.skillsRequired),
        method: s.method,
        estimatedMonthly: s.estimatedMonthly,
        tags: JSON.stringify(s.tags),
        approved: s.approved,
        enabled: s.enabled,
        autoExecute: false,
      },
    });
    console.log(`  [ok]   ${s.key} — ${s.name}`);
    added++;
  }

  console.log('');
  console.log(`Done. Added: ${added}, Skipped: ${skipped}, Total seeds: ${SEEDS.length}`);
}

/**
 * Public entry point — callable from the in-app Demo Data panel
 * (`/api/admin/data` POST `script: 'earning-methods'`). Idempotent —
 * safe to re-run (existing keys are skipped).
 */
export async function seedEarningMethods() {
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
