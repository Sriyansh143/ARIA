import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Agent configuration templates — pre-built agent presets that can be spawned
 * with one click. Templates are defined in-code (not in DB) for simplicity.
 */

interface AgentTemplate {
  key: string;
  name: string;
  codename: string;
  role: string;
  skills: string[];
  model: string;
  description: string;
  category: 'engineering' | 'research' | 'business' | 'ops' | 'creative' | 'security';
  accent: string;
}

const TEMPLATES: AgentTemplate[] = [
  {
    key: 'research-analyst',
    name: 'Research Analyst',
    codename: 'SAGE',
    role: 'Research Analyst',
    skills: ['research', 'summarize', 'cite', 'web-search', 'analyze'],
    model: 'glm-4.6',
    description: 'Deep research agent that gathers, synthesizes, and cites information from the web.',
    category: 'research',
    accent: '#7DD3FC',
  },
  {
    key: 'code-reviewer',
    name: 'Code Reviewer',
    codename: 'INSPECTOR',
    role: 'Code Reviewer',
    skills: ['code-review', 'analyze', 'audit', 'security-check', 'lint'],
    model: 'glm-4.6',
    description: 'Reviews code for bugs, security issues, style violations, and best practices.',
    category: 'engineering',
    accent: '#A78BFA',
  },
  {
    key: 'content-writer',
    name: 'Content Writer',
    codename: 'SCRIBE',
    role: 'Content Writer',
    skills: ['write', 'blog', 'seo', 'edit', 'summarize'],
    model: 'glm-4.6',
    description: 'Creates blog posts, marketing copy, documentation, and SEO-optimized content.',
    category: 'creative',
    accent: '#FBBF24',
  },
  {
    key: 'data-analyst',
    name: 'Data Analyst',
    codename: 'METRIC',
    role: 'Data Analyst',
    skills: ['analyze', 'forecast', 'chart', 'sql', 'statistics'],
    model: 'glm-4.6',
    description: 'Analyzes datasets, builds forecasts, creates visualizations and reports.',
    category: 'research',
    accent: '#34D399',
  },
  {
    key: 'customer-support',
    name: 'Customer Support',
    codename: 'HELPER',
    role: 'Customer Support Agent',
    skills: ['support', 'respond', 'faq', 'troubleshoot', 'empathy'],
    model: 'glm-4.6',
    description: 'Handles customer inquiries, resolves issues, escalates complex cases.',
    category: 'business',
    accent: '#F472B6',
  },
  {
    key: 'security-scanner',
    name: 'Security Scanner',
    codename: 'SENTINEL',
    role: 'Security Scanner',
    skills: ['security-check', 'audit', 'vuln-scan', 'compliance', 'report'],
    model: 'glm-4.6',
    description: 'Scans code and infrastructure for vulnerabilities and compliance issues.',
    category: 'security',
    accent: '#F87171',
  },
  {
    key: 'devops-engineer',
    name: 'DevOps Engineer',
    codename: 'DEPLOY',
    role: 'DevOps Engineer',
    skills: ['deploy', 'monitor', 'ci-cd', 'infra', 'automate'],
    model: 'glm-4.6',
    description: 'Manages deployments, CI/CD pipelines, infrastructure, and monitoring.',
    category: 'ops',
    accent: '#60A5FA',
  },
  {
    key: 'sales-rep',
    name: 'Sales Representative',
    codename: 'CLOSER',
    role: 'Sales Representative',
    skills: ['outreach', 'negotiation', 'crm', 'demo', 'closing'],
    model: 'glm-4.6',
    description: 'Manages sales pipeline, conducts outreach, demos, and closes deals.',
    category: 'business',
    accent: '#FBBF24',
  },
  {
    key: 'qa-tester',
    name: 'QA Tester',
    codename: 'VERIFY',
    role: 'QA Tester',
    skills: ['test', 'qa', 'bug-report', 'regression', 'automation'],
    model: 'glm-4.6',
    description: 'Writes and runs tests, reports bugs, performs regression testing.',
    category: 'engineering',
    accent: '#A78BFA',
  },
  {
    key: 'social-media-manager',
    name: 'Social Media Manager',
    codename: 'BUZZ',
    role: 'Social Media Manager',
    skills: ['social', 'content', 'schedule', 'engage', 'analytics'],
    model: 'glm-4.6',
    description: 'Manages social media accounts, creates content calendars, tracks engagement.',
    category: 'creative',
    accent: '#FBBF24',
  },
];

/**
 * GET /api/agents/templates
 * Returns all available agent templates grouped by category.
 */
export async function GET() {
  const byCategory: Record<string, AgentTemplate[]> = {};
  for (const t of TEMPLATES) {
    (byCategory[t.category] ??= []).push(t);
  }
  return NextResponse.json({
    templates: TEMPLATES,
    byCategory,
    count: TEMPLATES.length,
  });
}

/**
 * POST /api/agents/templates
 * Spawns an agent from a template by key.
 * Body: { templateKey: string, customCodename?: string }
 * If customCodename is provided, uses it instead of the template's codename
 * (useful for spawning multiple agents from the same template).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { templateKey, customCodename } = body as { templateKey?: string; customCodename?: string };
  if (!templateKey) {
    return NextResponse.json({ error: 'templateKey required' }, { status: 400 });
  }
  const template = TEMPLATES.find((t) => t.key === templateKey);
  if (!template) {
    return NextResponse.json({ error: `Template "${templateKey}" not found` }, { status: 404 });
  }

  const codename = (customCodename || template.codename).toUpperCase();

  // Check for codename collision — if customCodename not provided and exists, append a suffix
  let finalCodename = codename;
  if (!customCodename) {
    const existing = await db.agent.findFirst({ where: { codename } });
    if (existing) {
      const suffix = Math.floor(Math.random() * 9000) + 1000;
      finalCodename = `${codename}-${suffix}`;
    }
  } else {
    const existing = await db.agent.findFirst({ where: { codename: finalCodename } });
    if (existing) {
      return NextResponse.json({ error: `Codename "${finalCodename}" already in use` }, { status: 409 });
    }
  }

  const agent = await db.agent.create({
    data: {
      name: template.name,
      codename: finalCodename,
      role: template.role,
      skills: JSON.stringify(template.skills),
      model: template.model,
      status: 'idle',
    },
  });

  return NextResponse.json({ agent, template });
}
