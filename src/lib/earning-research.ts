// =====================================================================
// earning-research.ts — LLM-powered discovery of new earning methods.
// =====================================================================
// Used by:
//   • The daily cron job `earning-methods-research` (cron-dispatcher.ts)
//   • The POST /api/earning-methods/research endpoint (manual trigger)
//
// Strategy:
//   1. Ask GLM-4.6 (via chat()) for 3-5 brand-new non-investment earning
//      method ideas, returned as strict JSON.
//   2. Validate each candidate (legal, non-risky, inflow-only, one of the
//      9 supported categories).
//   3. Upsert into db.earningMethod — skip duplicates by slug key.
//   4. Return the freshly-discovered Prisma EarningMethod rows.
//
// HARD RULES (enforced in the prompt AND in validation):
//   • Non-investment only — inflow, no outflow. No stocks, crypto, forex,
//     betting, or "pay-to-join" schemes.
//   • Legal, non-risky, corporate-expertise-friendly.
//   • Only the 9 supported categories.
// =====================================================================

import { chat, extractJson } from '@/lib/llm';
import { db } from '@/lib/db';
import type { EarningMethod } from '@prisma/client';

// ─── Types ────────────────────────────────────────────────────────────
export type EarningCategory =
  | 'freelance'
  | 'content'
  | 'saas'
  | 'consulting'
  | 'automation'
  | 'data'
  | 'creative'
  | 'support'
  | 'affiliate';

export const EARNING_CATEGORIES: EarningCategory[] = [
  'freelance', 'content', 'saas', 'consulting',
  'automation', 'data', 'creative', 'support', 'affiliate',
];

export interface DiscoveredMethod {
  name: string;
  description: string;
  category: string;
  method: string;             // step-by-step
  estimatedMonthly: number;   // INR
  skillsRequired: string[];
  earningPotential: string;   // low | medium | high
  riskLevel: string;          // none | low | medium | high
}

export interface ResearchResult {
  /** Number of brand-new methods created this run. */
  discovered: number;
  /** Prisma rows for the freshly-created methods. */
  methods: EarningMethod[];
  /** Number of LLM suggestions that collided with existing keys. */
  skipped: number;
  /** Reasons each candidate was rejected during validation. */
  rejected: string[];
  /** Total wall-clock latency in ms. */
  latencyMs: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Slugify a method name into a stable key. */
export function methodKeyFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const VALID_POTENTIAL = new Set(['low', 'medium', 'high']);
const VALID_RISK = new Set(['none', 'low', 'medium', 'high']);
const VALID_CATEGORIES = new Set<string>(EARNING_CATEGORIES);

/** Reject anything that smells like an investment / outflow scheme. */
const INVESTMENT_RED_FLAGS = [
  /\bstock\b/i, /\bshares?\b/i, /\bcrypto\b/i, /\bbitcoin\b/i,
  /\bforex\b/i, /\btrading\b/i, /\boption\b/i, /\bmutual fund\b/i,
  /\blottery\b/i, /\bgambl/i, /\bbet\b/i, /\bponzi\b/i,
  /\bmlm\b/i, /\bpyramid\b/i, /\bpay[- ]?to[- ]?join\b/i,
  /\binvest \$?\d/i, /\binvest rs\.?\d/i, /\bupfront fee\b/i,
];

function looksLikeInvestment(text: string): boolean {
  return INVESTMENT_RED_FLAGS.some((re) => re.test(text));
}

interface CandidateValidation {
  ok: boolean;
  reason?: string;
  cleaned?: DiscoveredMethod;
}

function validateCandidate(raw: unknown): CandidateValidation {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
  const c = raw as Record<string, unknown>;

  const name = typeof c.name === 'string' ? c.name.trim() : '';
  if (!name || name.length < 4) return { ok: false, reason: `name too short: "${name}"` };

  const description = typeof c.description === 'string' ? c.description.trim() : '';
  if (!description || description.length < 20) {
    return { ok: false, reason: `description too short for "${name}"` };
  }

  const category = typeof c.category === 'string' ? c.category.trim().toLowerCase() : '';
  if (!VALID_CATEGORIES.has(category)) {
    return { ok: false, reason: `invalid category "${category}" for "${name}"` };
  }

  const method = typeof c.method === 'string' ? c.method.trim() : '';
  if (!method || method.length < 30) {
    return { ok: false, reason: `method too short for "${name}"` };
  }

  const skillsRequired = Array.isArray(c.skillsRequired)
    ? (c.skillsRequired as unknown[])
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  if (skillsRequired.length === 0) {
    return { ok: false, reason: `no skillsRequired for "${name}"` };
  }

  const earningPotential = typeof c.earningPotential === 'string'
    ? c.earningPotential.trim().toLowerCase()
    : '';
  if (!VALID_POTENTIAL.has(earningPotential)) {
    return { ok: false, reason: `invalid earningPotential "${earningPotential}" for "${name}"` };
  }

  const riskLevel = typeof c.riskLevel === 'string'
    ? c.riskLevel.trim().toLowerCase()
    : '';
  if (!VALID_RISK.has(riskLevel)) {
    return { ok: false, reason: `invalid riskLevel "${riskLevel}" for "${name}"` };
  }

  // HARD RULE: non-investment only.
  const combined = `${name} ${description} ${method}`;
  if (looksLikeInvestment(combined)) {
    return { ok: false, reason: `investment red-flag in "${name}"` };
  }

  // HARD RULE: high-risk methods are rejected (non-risky only).
  if (riskLevel === 'high') {
    return { ok: false, reason: `riskLevel high rejected for "${name}"` };
  }

  const estimatedMonthly = typeof c.estimatedMonthly === 'number'
    ? c.estimatedMonthly
    : parseInt(String(c.estimatedMonthly ?? '0'), 10);

  return {
    ok: true,
    cleaned: {
      name,
      description,
      category,
      method,
      estimatedMonthly,
      skillsRequired,
      earningPotential,
      riskLevel,
    },
  };
}

function coerceEstimatedMonthly(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  // Cap at a sane ceiling to avoid LLM hallucinations (₹10L/mo).
  return Math.min(Math.floor(n), 1_000_000);
}

// ─── Prompt ───────────────────────────────────────────────────────────

function buildPrompt(existingNames: string[]): string {
  const existingList = existingNames.length
    ? existingNames.map((n) => `- ${n}`).join('\n')
    : '(none yet)';

  return `You are JARVIS — a non-investment earning-methods research engine.

HARD RULES (non-negotiable):
1. NON-INVESTMENT ONLY. Inflow, no outflow. The method must earn money by selling a service, skill, content, automation, or product — never by investing capital.
2. NO stocks, crypto, forex, options, mutual funds, lottery, gambling, MLM, ponzi, pyramid, pay-to-join, or upfront-fee schemes.
3. Legal, non-risky, and achievable with corporate-grade expertise (engineering, design, writing, data, AI).
4. Each method must fit ONE of these 9 categories (use the exact lowercase word):
   freelance, content, saas, consulting, automation, data, creative, support, affiliate
5. riskLevel must be "none", "low", or "medium" — NEVER "high".
6. Methods must be CONCRETE and ACTIONABLE — include a numbered step-by-step "method" field (at least 5 steps).

ALREADY-KNOWN METHODS (do NOT duplicate these — pick genuinely different ideas):
${existingList}

OUTPUT FORMAT (strict JSON, no prose, no markdown fences):
{
  "methods": [
    {
      "name": "<short, specific name>",
      "description": "<2-3 sentence explanation of what it is and who pays for it>",
      "category": "<one of the 9 categories>",
      "method": "<5+ numbered steps, newline-separated, e.g. '1. ...\\n2. ...\\n3. ...'>",
      "estimatedMonthly": <integer INR amount, e.g. 45000>,
      "skillsRequired": ["<skill1>", "<skill2>", "<skill3>"],
      "earningPotential": "<low|medium|high>",
      "riskLevel": "<none|low|medium>"
    }
  ]
}

Generate 3 to 5 brand-new, genuinely different earning method ideas. Focus on 2024-2025 trends: AI tooling, LLM wrappers, dev-tools, creator economy, automation-as-a-service, data labeling, podcasts, newsletters, technical writing, API testing services, and similar skill-based inflows. Return ONLY the JSON object.`;
}

// ─── Main entrypoint ──────────────────────────────────────────────────

export async function researchNewEarningMethods(): Promise<ResearchResult> {
  const start = Date.now();

  // Pull existing names so the LLM avoids duplicates.
  const existing = await db.earningMethod.findMany({
    select: { key: true, name: true },
    orderBy: { createdAt: 'desc' },
  });
  const existingNames = existing.map((m) => m.name);
  const existingKeys = new Set(existing.map((m) => m.key));

  // Call the LLM.
  let raw = '';
  try {
    const { content } = await chat(
      buildPrompt(existingNames),
      [],
      'You are a JSON-only research engine. Output ONLY valid JSON — no prose, no markdown fences.',
    );
    raw = content;
  } catch (err) {
    return {
      discovered: 0,
      methods: [],
      skipped: 0,
      rejected: [`LLM call failed: ${err instanceof Error ? err.message : String(err)}`],
      latencyMs: Date.now() - start,
    };
  }

  // Parse the JSON envelope.
  const parsed = extractJson<{ methods?: unknown[] }>(raw);
  if (!parsed || !Array.isArray(parsed.methods)) {
    return {
      discovered: 0,
      methods: [],
      skipped: 0,
      rejected: [`LLM response was not valid JSON: ${raw.slice(0, 200)}`],
      latencyMs: Date.now() - start,
    };
  }

  const rejected: string[] = [];
  const created: EarningMethod[] = [];
  let skipped = 0;

  for (const candidate of parsed.methods) {
    const v = validateCandidate(candidate);
    if (!v.ok || !v.cleaned) {
      rejected.push(v.reason || 'invalid candidate');
      continue;
    }

    const c = v.cleaned;
    const key = methodKeyFromName(c.name);

    // Skip if a method with this exact key already exists.
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }

    // Create the new method (unapproved + disabled — human review required).
    const row = await db.earningMethod.create({
      data: {
        key,
        name: c.name,
        description: c.description,
        category: c.category,
        method: c.method,
        estimatedMonthly: coerceEstimatedMonthly(c.estimatedMonthly),
        skillsRequired: JSON.stringify(c.skillsRequired),
        earningPotential: c.earningPotential,
        riskLevel: c.riskLevel,
        tags: JSON.stringify(['researched', 'llm-discovered']),
        approved: false,
        enabled: false,
        autoExecute: false,
        lastResearched: new Date(),
      },
    });

    existingKeys.add(key);
    created.push(row);
  }

  return {
    discovered: created.length,
    methods: created,
    skipped,
    rejected,
    latencyMs: Date.now() - start,
  };
}
