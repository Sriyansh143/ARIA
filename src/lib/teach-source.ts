// Teach-Source — ingest knowledge from text / URL / video / document / audio
// / zip into the memory layer. Stores entries as MemoryItem(scope=targetSection)
// and bumps skill proficiency via a separate MemoryItem(scope=targetSection,
// key=`skill-proficiency:${skillKey}`).
//
// The target section (skill / plugin / memory / knowledge / intelligence /
// learning) is either supplied by the caller or auto-suggested by
// `autoCategorize()` (see ./categorize.ts).

import { db } from '@/lib/db';
import {
  autoCategorize,
  type TargetSection,
  type AutoCategorizeResult,
} from '@/lib/categorize';

export type TeachSourceType =
  | 'text'
  | 'url'
  | 'video'
  | 'zip'
  | 'document'
  | 'audio';

export type { TargetSection, AutoCategorizeResult } from '@/lib/categorize';
export { TARGET_SECTIONS, TARGET_SECTION_LABELS } from '@/lib/categorize';
export { autoCategorize, getCategoryRules } from '@/lib/categorize';

export interface IngestSourceInput {
  type: TeachSourceType;
  content: string;
  agentCodename?: string;
  skillKey?: string;
  /** Where to store the resulting MemoryItem rows.
   *  If omitted, autoCategorize(content) picks one. */
  targetSection?: TargetSection;
  meta?: Record<string, unknown>;
}

export interface IngestSourceResult {
  ok: boolean;
  chunksStored: number;
  proficiencyDelta: number;
  newProficiency: number;
  memoryIds: string[];
  skillKey?: string;
  /** The section actually used for storage. */
  targetSection?: TargetSection;
  /** What autoCategorize suggested (may differ from targetSection when caller forced one). */
  suggestedSection?: TargetSection;
  /** autoCategorize confidence 0..1 */
  confidence?: number;
  /** autoCategorize reason */
  reason?: string;
  error?: string;
}

const CHUNK_SIZE = 500; // chars per chunk for text/URL ingestion

const PROFICIENCY_PER_TYPE: Record<TeachSourceType, number> = {
  text: 5,
  url: 5,
  video: 3,
  zip: 8,
  document: 6,
  audio: 4,
};

function chunkText(input: string, size: number): string[] {
  const clean = input.replace(/\r\n/g, '\n').trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const out: string[] = [];
  let i = 0;
  while (i < clean.length) {
    // Try to break on a whitespace boundary near the limit.
    let end = Math.min(i + size, clean.length);
    if (end < clean.length) {
      const lastSpace = clean.lastIndexOf(' ', end);
      if (lastSpace > i + Math.floor(size / 2)) end = lastSpace;
    }
    out.push(clean.slice(i, end).trim());
    i = end;
    // Skip a single whitespace so we don't start the next chunk with a space.
    if (clean[i] === ' ') i += 1;
  }
  return out.filter(Boolean);
}

/** Bump (or initialize) skill proficiency for a given skillKey.
 *  Stored as MemoryItem(scope=`scope`, key=`skill-proficiency:${skillKey}`). */
async function bumpSkillProficiency(
  skillKey: string,
  delta: number,
  scope: TargetSection = 'learning',
): Promise<number> {
  const profKey = `skill-proficiency:${skillKey}`;
  const existing = await db.memoryItem.findUnique({
    where: { key_scope: { key: profKey, scope } },
  });
  const current = existing ? Number.parseFloat(existing.value || '0') || 0 : 0;
  const next = Math.max(0, Math.min(100, current + delta));
  await db.memoryItem.upsert({
    where: { key_scope: { key: profKey, scope } },
    update: { value: String(next), tags: JSON.stringify(['proficiency', 'skill', skillKey]) },
    create: {
      key: profKey,
      scope,
      value: String(next),
      tags: JSON.stringify(['proficiency', 'skill', skillKey]),
    },
  });
  return next;
}

/** Main entry — ingests a learning source and returns a summary. */
export async function ingestSource(input: IngestSourceInput): Promise<IngestSourceResult> {
  const { type, content, agentCodename, skillKey, meta } = input;

  // Determine target section (auto-categorize if not provided).
  const suggestion: AutoCategorizeResult = autoCategorize(content || '');
  const targetSection: TargetSection = input.targetSection ?? suggestion.suggestedSection;

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return {
      ok: false,
      chunksStored: 0,
      proficiencyDelta: 0,
      newProficiency: 0,
      memoryIds: [],
      skillKey,
      targetSection,
      suggestedSection: suggestion.suggestedSection,
      confidence: suggestion.confidence,
      reason: suggestion.reason,
      error: 'empty content',
    };
  }

  const delta = PROFICIENCY_PER_TYPE[type] ?? 0;
  const memoryIds: string[] = [];

  try {
    if (type === 'text' || type === 'url' || type === 'document' || type === 'audio') {
      // Chunked text-like ingestion — applies to text / url / document /
      // audio (after transcription). Each chunk becomes its own MemoryItem,
      // with a paired `__meta` row carrying structured metadata.
      const chunks = chunkText(content, CHUNK_SIZE);
      const baseTags = ['teach', type];
      if (skillKey) baseTags.push(skillKey);
      if (agentCodename) baseTags.push(`agent:${agentCodename}`);
      baseTags.push(`section:${targetSection}`);

      const stemBase = `teach-${type}-${Date.now()}`;
      for (let i = 0; i < chunks.length; i++) {
        const key = `${stemBase}-${i}`;
        const metaJson = JSON.stringify({
          ...(meta ?? {}),
          source: type,
          chunkIndex: i,
          totalChunks: chunks.length,
          agentCodename: agentCodename ?? null,
          skillKey: skillKey ?? null,
          contentLength: chunks[i].length,
          targetSection,
          suggestedSection: suggestion.suggestedSection,
          autoConfidence: suggestion.confidence,
          autoReason: suggestion.reason,
        });
        const row = await db.memoryItem.create({
          data: {
            key,
            scope: targetSection,
            value: chunks[i],
            tags: JSON.stringify(baseTags),
          },
        });
        await db.memoryItem.create({
          data: {
            key: `${key}__meta`,
            scope: targetSection,
            value: metaJson,
            tags: JSON.stringify(['teach-meta', type]),
          },
        });
        memoryIds.push(row.id);
      }
    } else if (type === 'video' || type === 'zip') {
      // For video / zip — we don't transcribe or extract in-process. We
      // record the metadata + reference so the dashboard can show what was
      // ingested. Video transcription is expected to be done out-of-band
      // via the video-understand skill.
      const baseKey = `teach-${type}-${Date.now()}`;
      const tags = ['teach', type];
      if (skillKey) tags.push(skillKey);
      if (agentCodename) tags.push(`agent:${agentCodename}`);
      tags.push(`section:${targetSection}`);
      const value = JSON.stringify({
        source: type,
        reference: content.slice(0, 2048),
        agentCodename: agentCodename ?? null,
        skillKey: skillKey ?? null,
        targetSection,
        suggestedSection: suggestion.suggestedSection,
        autoConfidence: suggestion.confidence,
        autoReason: suggestion.reason,
        transcriptionPending: type === 'video',
        extractionPending: type === 'zip',
        ...(meta ?? {}),
      });
      const row = await db.memoryItem.create({
        data: {
          key: baseKey,
          scope: targetSection,
          value,
          tags: JSON.stringify(tags),
        },
      });
      memoryIds.push(row.id);
    }

    // Bump proficiency if a skillKey was provided.
    let newProficiency = 0;
    if (skillKey && delta > 0) {
      newProficiency = await bumpSkillProficiency(skillKey, delta, targetSection);
    }

    return {
      ok: true,
      chunksStored: memoryIds.length,
      proficiencyDelta: delta,
      newProficiency,
      memoryIds,
      skillKey,
      targetSection,
      suggestedSection: suggestion.suggestedSection,
      confidence: suggestion.confidence,
      reason: suggestion.reason,
    };
  } catch (e) {
    return {
      ok: false,
      chunksStored: memoryIds.length,
      proficiencyDelta: 0,
      newProficiency: 0,
      memoryIds,
      skillKey,
      targetSection,
      suggestedSection: suggestion.suggestedSection,
      confidence: suggestion.confidence,
      reason: suggestion.reason,
      error: e instanceof Error ? e.message : 'unknown error',
    };
  }
}
