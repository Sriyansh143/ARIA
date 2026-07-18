// =====================================================================
// verification.ts — No-Assumption Rule enforcement layer
// =====================================================================
// USER RULE (non-negotiable):
//   "without proof never accept anything even research and analysis and
//    plans can be questioned and improvised"
//
// This module guarantees that every claim, research result, analysis, plan,
// forecast, or recommendation produced by an agent (or the operator) is:
//   1. Logged as a VerificationRecord with its evidence.
//   2. Verifiable — the system can independently cross-check the claim
//      against web-search results or known facts.
//   3. Questionable — any record can be challenged, and an improved version
//      can be recorded.
//
// No agent output is "trusted" until it carries a VerificationRecord with
// verificationStatus in { verified, partial } AND confidenceScore >= 50.
// Outputs that are `unverified` are flagged in the UI with a warning badge.
// =====================================================================

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { quickChat } from '@/lib/llm';

export type ClaimType =
  | 'research'
  | 'analysis'
  | 'plan'
  | 'fact'
  | 'forecast'
  | 'recommendation';

export type VerificationStatus =
  | 'unverified'
  | 'verified'
  | 'disputed'
  | 'partial'
  | 'false';

export type VerifierMethod =
  | 'web-search'
  | 'cross-check'
  | 'source-read'
  | 'expert-review'
  | 'automated-test'
  | 'llm-cross-check';

export interface Evidence {
  type: 'url' | 'quote' | 'screenshot' | 'data-point' | 'document' | 'test-result';
  url?: string;
  quote?: string;
  capturedAt?: string;
  source?: string;
}

export interface VerificationInput {
  claimType: ClaimType;
  claimText: string;
  claimSource?: string;
  evidence?: Evidence[];
  linkedTaskId?: string;
}

export interface VerificationResult {
  id: string;
  status: VerificationStatus;
  confidenceScore: number;
  verifierNote: string;
}

const MIN_CONFIDENCE = 50;

/**
 * Log a claim as a VerificationRecord. Every agent output that makes a
 * factual assertion MUST go through this function. Returns the record id
 * so callers can reference it.
 */
export async function logClaim(input: VerificationInput): Promise<string> {
  try {
    const row = await db.verificationRecord.create({
      data: {
        claimType: input.claimType,
        claimText: input.claimText.slice(0, 5000),
        claimSource: input.claimSource ?? null,
        evidence: JSON.stringify(input.evidence ?? []),
        verificationStatus: 'unverified',
        confidenceScore: 0,
        linkedTaskId: input.linkedTaskId ?? null,
      },
    });
    return row.id;
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'verification: failed to log claim',
    );
    return '';
  }
}

/**
 * Cross-check a claim using an LLM that acts as a skeptical fact-checker.
 * The LLM is given the claim + any provided evidence and asked to:
 *   - Identify what evidence supports/refutes the claim
 *   - Assign a confidence score (0-100)
 *   - Flag if the claim is disputed or false
 *
 * This is the "no-assumption" gate: the LLM MUST NOT accept the claim on
 * faith — it must justify its verdict.
 */
export async function verifyWithLLM(
  claimText: string,
  evidence: Evidence[] = [],
): Promise<{ status: VerificationStatus; confidence: number; note: string }> {
  const evidenceBlock =
    evidence.length > 0
      ? evidence
          .map(
            (e, i) =>
              `  ${i + 1}. [${e.type}]${e.url ? ` ${e.url}` : ''}${e.quote ? ` — "${e.quote.slice(0, 300)}"` : ''}`,
          )
          .join('\n')
      : '  (no evidence provided)';

  const system = `You are a strict fact-checker for an autonomous AI system. Your job is to VERIFY or REFUTE claims — NEVER accept a claim on faith.

Rules:
- If the claim makes a factual assertion, it MUST be backed by evidence or general knowledge.
- If you are not certain, mark it "partial" or "disputed" — do NOT default to "verified".
- Assign a confidence score 0-100 (0 = certainly false, 100 = certainly true).
- Be skeptical of vague language ("probably", "likely", "experts say") — reduce confidence.
- If evidence is provided but doesn't actually support the claim, mark "disputed".
- Output STRICT JSON: {"status":"verified|partial|disputed|false","confidence":N,"note":"one sentence justification"}
- The "note" must explain WHY you chose that status — not just restate it.`;

  const user = `Claim: "${claimText}"

Evidence:
${evidenceBlock}

Verify this claim. Do NOT assume it is true.`;

  try {
    const raw = await quickChat(user.slice(0, 3000), system);
    // Try to parse JSON
    const m = raw.match(/\{[^{}]*\}/s);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]) as {
          status?: string;
          confidence?: number;
          note?: string;
        };
        const status = (['verified', 'partial', 'disputed', 'false'].includes(
          parsed.status ?? '',
        )
          ? parsed.status
          : 'unverified') as VerificationStatus;
        const confidence =
          typeof parsed.confidence === 'number'
            ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
            : 0;
        return {
          status,
          confidence,
          note: (parsed.note ?? 'No justification provided').slice(0, 500),
        };
      } catch {
        // fall through
      }
    }
    return {
      status: 'unverified',
      confidence: 0,
      note: 'LLM response could not be parsed as JSON.',
    };
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'verification: LLM cross-check failed',
    );
    return {
      status: 'unverified',
      confidence: 0,
      note: `Verification failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    };
  }
}

/**
 * Full verification pipeline: log the claim, cross-check with LLM, update
 * the record with the verdict. Returns the verification result.
 */
export async function verifyClaim(
  input: VerificationInput,
  options: { crossCheck?: boolean } = {},
): Promise<VerificationResult> {
  const id = await logClaim(input);
  if (!id) {
    return {
      id: '',
      status: 'unverified',
      confidenceScore: 0,
      verifierNote: 'Failed to log claim',
    };
  }

  let status: VerificationStatus = 'unverified';
  let confidence = 0;
  let note = 'Not yet verified';
  let method: VerifierMethod | undefined;

  if (options.crossCheck !== false) {
    const result = await verifyWithLLM(input.claimText, input.evidence ?? []);
    status = result.status;
    confidence = result.confidence;
    note = result.note;
    method = 'llm-cross-check';
  }

  try {
    await db.verificationRecord.update({
      where: { id },
      data: {
        verificationStatus: status,
        confidenceScore: confidence,
        verifierMethod: method ?? null,
        verifierNote: note,
      },
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'verification: failed to update record',
    );
  }

  return { id, status, confidenceScore: confidence, verifierNote: note };
}

/**
 * Question a previously-verified claim. This implements the user's rule
 * that "plans can be questioned and improvised". The question + an
 * improved version of the claim are recorded.
 */
export async function questionClaim(
  id: string,
  questionNote: string,
  improvedVersion?: string,
): Promise<{ ok: boolean }> {
  try {
    await db.verificationRecord.update({
      where: { id },
      data: {
        questioned: true,
        questionNote: questionNote.slice(0, 2000),
        improvedVersion: improvedVersion?.slice(0, 5000) ?? null,
        // Re-flag as disputed so it shows up for re-verification
        verificationStatus: 'disputed',
      },
    });
    return { ok: true };
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'verification: failed to question claim',
    );
    return { ok: false };
  }
}

/**
 * Check whether a claim is "trusted" — i.e. safe to act on.
 * A claim is trusted only if:
 *   - It has a VerificationRecord
 *   - verificationStatus is 'verified' or 'partial'
 *   - confidenceScore >= MIN_CONFIDENCE
 *   - It has not been questioned (or has been re-verified after questioning)
 */
export async function isClaimTrusted(id: string): Promise<boolean> {
  if (!id) return false;
  try {
    const row = await db.verificationRecord.findUnique({ where: { id } });
    if (!row) return false;
    if (!['verified', 'partial'].includes(row.verificationStatus)) return false;
    if (row.confidenceScore < MIN_CONFIDENCE) return false;
    if (row.questioned && !row.improvedVersion) return false;
    return true;
  } catch {
    return false;
  }
}

export interface VerificationListFilter {
  claimType?: ClaimType;
  status?: VerificationStatus;
  questioned?: boolean;
  limit?: number;
  offset?: number;
}

export async function listVerifications(
  filter: VerificationListFilter = {},
): Promise<{ records: unknown[]; total: number }> {
  const where: Record<string, unknown> = {};
  if (filter.claimType) where.claimType = filter.claimType;
  if (filter.status) where.verificationStatus = filter.status;
  if (filter.questioned !== undefined) where.questioned = filter.questioned;

  const limit = Math.min(filter.limit ?? 50, 200);
  const offset = filter.offset ?? 0;

  const [records, total] = await Promise.all([
    db.verificationRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.verificationRecord.count({ where }),
  ]);

  return { records, total };
}

export async function getVerificationStats(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  questioned: number;
  avgConfidence: number;
  trustedCount: number;
}> {
  const [total, byStatusRows, byTypeRows, questioned, avgAgg, trustedCount] = await Promise.all([
    db.verificationRecord.count(),
    db.verificationRecord.groupBy({ by: ['verificationStatus'], _count: true }),
    db.verificationRecord.groupBy({ by: ['claimType'], _count: true }),
    db.verificationRecord.count({ where: { questioned: true } }),
    db.verificationRecord.aggregate({ _avg: { confidenceScore: true } }),
    db.verificationRecord.count({
      where: {
        verificationStatus: { in: ['verified', 'partial'] },
        confidenceScore: { gte: MIN_CONFIDENCE },
      },
    }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const r of byStatusRows) byStatus[r.verificationStatus] = r._count;
  const byType: Record<string, number> = {};
  for (const r of byTypeRows) byType[r.claimType] = r._count;

  return {
    total,
    byStatus,
    byType,
    questioned,
    avgConfidence: Math.round(avgAgg._avg.confidenceScore ?? 0),
    trustedCount,
  };
}
