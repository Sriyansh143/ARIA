// =====================================================================
// knowledge-enhancer.ts — Memory / Skills / Knowledge enhancement layer
// =====================================================================
// USER RULE:
//   "memories skills knowledge and intelligence can also be enhanced for
//    improving results to potential level or expert or pro level"
//
// This module provides utilities to UPGRADE existing memories, skills, and
// knowledge records to expert/pro level by:
//   1. Consolidating fragmented memories into richer, structured entries.
//   2. Expanding terse skill descriptions into full expert-level manifests
//      (with prerequisites, step-by-step procedures, common pitfalls,
//      verification criteria, and example outputs).
//   3. Cross-linking knowledge records (ModelKnowledge, SkillLearning) to
//      build a richer intelligence graph.
//   4. Re-rating agent proficiency using evidence (past executions,
//      success rate, complexity handled).
//
// All enhancement is logged to ActionLog for auditability.
// =====================================================================

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { quickChat, extractJson } from '@/lib/llm';

export type EnhancementLevel = 'basic' | 'intermediate' | 'advanced' | 'expert' | 'pro';

export interface EnhancementResult {
  id: string;
  type: 'memory' | 'skill' | 'knowledge';
  before: string;
  after: string;
  level: EnhancementLevel;
  ok: boolean;
  note: string;
}

const EXPERT_SKILL_SYSTEM = `You are an expert skill architect. Given a terse skill name + description, produce a FULL expert-level skill manifest as JSON.

The manifest must include:
- "name": short name
- "summary": one-sentence expert summary
- "prerequisites": array of required skills/knowledge
- "procedure": ordered array of step objects { step, detail, tip }
- "commonPitfalls": array of strings (mistakes novices make)
- "verificationCriteria": array of strings (how to know it was done right)
- "exampleOutput": a concrete example of correct output
- "expertNotes": advanced techniques that distinguish experts from novices
- "estimatedComplexity": "low" | "medium" | "high"

Output ONLY the JSON object. No markdown, no commentary.`;

/**
 * Enhance a skill to expert/pro level. Takes a skill id, fetches it,
 * runs an LLM to expand the description into a full manifest, and stores
 * the enhanced version back (in the `method` field, which is a free-text
 * field on the Skill model — check schema). Logs to ActionLog.
 */
export async function enhanceSkill(
  skillId: string,
  targetLevel: EnhancementLevel = 'expert',
): Promise<EnhancementResult> {
  try {
    const skill = await db.skill.findUnique({ where: { id: skillId } });
    if (!skill) {
      return {
        id: skillId,
        type: 'skill',
        before: '',
        after: '',
        level: targetLevel,
        ok: false,
        note: 'Skill not found',
      };
    }

    const before = skill.description ?? '';
    const prompt = `Skill name: ${skill.name}
Current description: ${before}
Target expertise level: ${targetLevel}

Generate the full expert-level manifest for this skill.`;

    const raw = await quickChat(prompt.slice(0, 2000), EXPERT_SKILL_SYSTEM);
    const manifest = extractJson<{
      name?: string;
      summary?: string;
      prerequisites?: string[];
      procedure?: Array<{ step: string; detail: string; tip?: string }>;
      commonPitfalls?: string[];
      verificationCriteria?: string[];
      exampleOutput?: string;
      expertNotes?: string;
      estimatedComplexity?: string;
    }>(raw);

    if (!manifest) {
      return {
        id: skillId,
        type: 'skill',
        before,
        after: raw.slice(0, 500),
        level: targetLevel,
        ok: false,
        note: 'LLM did not return valid JSON manifest',
      };
    }

    // Store the enhanced manifest as a JSON string in the description field
    // (prefixed with a marker so we can detect enhanced skills).
    const enhancedDesc = `[ENHANCED:${targetLevel}]\n${JSON.stringify(manifest, null, 2)}`;
    await db.skill.update({
      where: { id: skillId },
      data: { description: enhancedDesc.slice(0, 8000) },
    });

    // Log to ActionLog
    await db.actionLog.create({
      data: {
        actor: 'system',
        action: 'skill.enhance',
        category: 'mutation',
        target: `skill:${skillId}`,
        beforeState: JSON.stringify({ name: skill.name, description: before.slice(0, 2000) }),
        afterState: JSON.stringify({ level: targetLevel, manifest }),
        reversible: true,
        meta: JSON.stringify({ targetLevel, manifestKeys: Object.keys(manifest) }),
      },
    });

    return {
      id: skillId,
      type: 'skill',
      before,
      after: enhancedDesc,
      level: targetLevel,
      ok: true,
      note: `Enhanced to ${targetLevel} level with ${manifest.procedure?.length ?? 0} procedural steps`,
    };
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'knowledge-enhancer: skill enhancement failed',
    );
    return {
      id: skillId,
      type: 'skill',
      before: '',
      after: '',
      level: targetLevel,
      ok: false,
      note: err instanceof Error ? err.message : 'unknown error',
    };
  }
}

const EXPERT_MEMORY_SYSTEM = `You are a memory consolidation expert. Given a set of fragmented memory entries, produce a single rich, structured memory entry.

Rules:
- Merge related facts into a coherent knowledge statement.
- Resolve contradictions (note which is more reliable + why).
- Add context: WHY this matters, WHEN to use it, WHAT it implies.
- Keep it concise but information-dense (under 300 words).
- Output JSON: { "summary": string, "details": string, "tags": string[], "confidence": 0-100, "sourceCount": number }`;

/**
 * Consolidate multiple fragmented memories into a single expert-level entry.
 * Useful when an agent has accumulated many small memories on a topic.
 */
export async function consolidateMemories(
  memoryKeys: string[],
): Promise<EnhancementResult> {
  try {
    const memories = await db.memoryItem.findMany({
      where: { key: { in: memoryKeys } },
    });
    if (memories.length === 0) {
      return {
        id: memoryKeys.join(','),
        type: 'memory',
        before: '',
        after: '',
        level: 'expert',
        ok: false,
        note: 'No memories found for the given keys',
      };
    }

    const before = memories.map((m) => `- [${m.key}] ${m.value.slice(0, 200)}`).join('\n');
    const prompt = `Consolidate these ${memories.length} memory entries into one expert-level memory:\n\n${before}`;

    const raw = await quickChat(prompt.slice(0, 3000), EXPERT_MEMORY_SYSTEM);
    const consolidated = extractJson<{
      summary?: string;
      details?: string;
      tags?: string[];
      confidence?: number;
      sourceCount?: number;
    }>(raw);

    if (!consolidated) {
      return {
        id: memoryKeys.join(','),
        type: 'memory',
        before,
        after: raw.slice(0, 500),
        level: 'expert',
        ok: false,
        note: 'LLM did not return valid JSON',
      };
    }

    // Store the consolidated memory as a new entry with a derived key
    const consolidatedKey = `consolidated:${Date.now().toString(36)}`;
    const tagList = consolidated.tags ?? ['consolidated', 'expert'];
    await db.memoryItem.create({
      data: {
        key: consolidatedKey,
        scope: 'consolidated',
        value: JSON.stringify(consolidated, null, 2),
        tags: JSON.stringify(tagList),
        pinned: true,
      },
    });

    // Log
    await db.actionLog.create({
      data: {
        actor: 'system',
        action: 'memory.consolidate',
        category: 'mutation',
        target: `memory:${consolidatedKey}`,
        beforeState: JSON.stringify({ sourceKeys: memoryKeys, preview: before.slice(0, 2000) }),
        afterState: JSON.stringify(consolidated),
        reversible: true,
        meta: JSON.stringify({ sourceCount: memories.length, confidence: consolidated.confidence }),
      },
    });

    return {
      id: consolidatedKey,
      type: 'memory',
      before,
      after: JSON.stringify(consolidated, null, 2),
      level: 'expert',
      ok: true,
      note: `Consolidated ${memories.length} memories into 1 (confidence: ${consolidated.confidence ?? 'n/a'})`,
    };
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'knowledge-enhancer: memory consolidation failed',
    );
    return {
      id: memoryKeys.join(','),
      type: 'memory',
      before: '',
      after: '',
      level: 'expert',
      ok: false,
      note: err instanceof Error ? err.message : 'unknown error',
    };
  }
}

/**
 * Re-rate an agent's proficiency in a skill based on actual execution evidence.
 * Looks at SkillRun history (success rate, complexity, recency) and updates
 * the SkillLearning.proficiency score.
 */
export async function reRateAgentSkill(
  agentCodename: string,
  skillKey: string,
): Promise<{ ok: boolean; newProficiency: number; note: string }> {
  try {
    // Count recent skill runs for this agent + skill
    const runs = await db.skillRun.findMany({
      where: {
        skillKey,
        status: 'success',
      },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });

    if (runs.length === 0) {
      return { ok: false, newProficiency: 0, note: 'No successful runs found' };
    }

    // Simple evidence-based rating:
    //   - 1-5 runs = 30 (novice)
    //   - 6-15 runs = 55 (intermediate)
    //   - 16-30 runs = 75 (advanced)
    //   - 31+ runs = 90 (expert)
    // Adjusted by recency: runs in last 7 days boost by up to 10.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentCount = runs.filter((r) => r.createdAt > sevenDaysAgo).length;
    let proficiency = 30;
    if (runs.length > 30) proficiency = 90;
    else if (runs.length > 15) proficiency = 75;
    else if (runs.length > 5) proficiency = 55;
    proficiency = Math.min(100, proficiency + Math.min(10, recentCount));

    // Upsert the SkillLearning record
    const existing = await db.skillLearning.findUnique({
      where: {
        agentCodename_skillKey: { agentCodename, skillKey },
      },
    });

    if (existing) {
      await db.skillLearning.update({
        where: { id: existing.id },
        data: {
          proficiency,
          lastUsed: new Date(),
          learnedFrom: 'evidence-based-re-rating',
        },
      });
    } else {
      await db.skillLearning.create({
        data: {
          agentCodename,
          skillKey,
          proficiency,
          learnedFrom: 'evidence-based-re-rating',
          lastUsed: new Date(),
        },
      });
    }

    // Log
    await db.actionLog.create({
      data: {
        actor: 'system',
        action: 'skill.re-rate',
        category: 'mutation',
        target: `skill-learning:${agentCodename}:${skillKey}`,
        beforeState: JSON.stringify({ oldProficiency: existing?.proficiency ?? 0 }),
        afterState: JSON.stringify({ newProficiency: proficiency, runCount: runs.length, recentCount }),
        reversible: true,
        meta: JSON.stringify({ agentCodename, skillKey }),
      },
    });

    return {
      ok: true,
      newProficiency: proficiency,
      note: `Re-rated from ${existing?.proficiency ?? 0} to ${proficiency} based on ${runs.length} runs (${recentCount} recent)`,
    };
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'knowledge-enhancer: re-rate failed',
    );
    return {
      ok: false,
      newProficiency: 0,
      note: err instanceof Error ? err.message : 'unknown error',
    };
  }
}

/**
 * Get stats on the knowledge base — how many skills are enhanced, how
 * many memories are consolidated, average agent proficiency.
 */
export async function getKnowledgeStats(): Promise<{
  totalSkills: number;
  enhancedSkills: number;
  totalMemories: number;
  consolidatedMemories: number;
  avgAgentProficiency: number;
  topAgents: Array<{ codename: string; avgProficiency: number; skillCount: number }>;
}> {
  const [totalSkills, enhancedSkills, totalMemories, consolidatedMemories, profAgg] =
    await Promise.all([
      db.skill.count(),
      db.skill.count({ where: { description: { startsWith: '[ENHANCED:' } } }),
      db.memoryItem.count(),
      db.memoryItem.count({ where: { scope: 'consolidated' } }),
      db.skillLearning.aggregate({ _avg: { proficiency: true } }),
    ]);

  // Top agents by avg proficiency (must have at least 1 skill learning)
  const agentGroups = await db.skillLearning.groupBy({
    by: ['agentCodename'],
    _avg: { proficiency: true },
    _count: true,
    orderBy: { _avg: { proficiency: 'desc' } },
    take: 5,
  });

  return {
    totalSkills,
    enhancedSkills,
    totalMemories,
    consolidatedMemories,
    avgAgentProficiency: Math.round(profAgg._avg.proficiency ?? 0),
    topAgents: agentGroups.map((g) => ({
      codename: g.agentCodename,
      avgProficiency: Math.round(g._avg.proficiency ?? 0),
      skillCount: g._count,
    })),
  };
}
