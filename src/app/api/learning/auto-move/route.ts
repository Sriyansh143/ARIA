import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { autoCategorize, type TargetSection } from '@/lib/categorize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SECTIONS: TargetSection[] = [
  'skill',
  'plugin',
  'memory',
  'knowledge',
  'intelligence',
  'learning',
];

interface MoveDetail {
  id: string;
  key: string;
  from: TargetSection;
  to: TargetSection;
  reason: string;
  confidence: number;
}

/** POST /api/learning/auto-move — scan all MemoryItem rows whose scope is one
 *  of the 6 known sections, run autoCategorize on each row's value, and if
 *  the suggested section differs from the current scope, move the row (and
 *  its paired `__meta` row, if any) to the new scope.
 *
 *  Body options (all optional):
 *    - dryRun: boolean (default false) — if true, only report what would move
 *    - sections: TargetSection[] — restrict scan to given scopes
 *    - limit: number — cap rows scanned (default 500)
 *
 *  Returns { scanned, moved, skipped, details: MoveDetail[] } */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const dryRun = Boolean(body.dryRun);
  const sectionsParam = Array.isArray(body.sections) ? body.sections : SECTIONS;
  const limit = Math.max(1, Math.min(5000, Number(body.limit) || 500));

  const sections = (sectionsParam as string[]).filter((s): s is TargetSection =>
    (SECTIONS as string[]).includes(s),
  );
  if (sections.length === 0) {
    return NextResponse.json(
      { error: 'no valid sections to scan' },
      { status: 400 },
    );
  }

  const items = await db.memoryItem.findMany({
    where: { scope: { in: sections } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const details: MoveDetail[] = [];
  let scanned = 0;
  let moved = 0;
  let skipped = 0;

  for (const item of items) {
    // Skip pure metadata rows — they get moved alongside their parent.
    if (item.key.endsWith('__meta')) {
      continue;
    }
    // Skip skill-proficiency aggregates — they are internal counters and
    // shouldn't be re-categorized by content analysis (a numeric value
    // like "5" would always suggest "learning").
    if (item.key.startsWith('skill-proficiency:')) {
      continue;
    }
    scanned++;

    // For text-like rows the value IS the content; for video/zip rows it's a
    // JSON payload whose `reference` field carries the URL/path.
    let contentForCategorization = item.value;
    if (item.value.startsWith('{')) {
      try {
        const parsed = JSON.parse(item.value);
        if (typeof parsed.reference === 'string') {
          contentForCategorization = parsed.reference;
        } else if (typeof parsed.content === 'string') {
          contentForCategorization = parsed.content;
        }
      } catch {
        // leave as raw value
      }
    }

    const suggestion = autoCategorize(contentForCategorization);
    const currentScope = item.scope as TargetSection;

    if (suggestion.suggestedSection === currentScope) {
      skipped++;
      continue;
    }
    // Don't auto-move if confidence is too low — would be churn.
    if (suggestion.confidence < 0.35) {
      skipped++;
      continue;
    }

    const newScope = suggestion.suggestedSection;

    if (dryRun) {
      details.push({
        id: item.id,
        key: item.key,
        from: currentScope,
        to: newScope,
        reason: suggestion.reason,
        confidence: suggestion.confidence,
      });
      moved++;
      continue;
    }

    try {
      // Check for key conflict at the target scope (unique on [key, scope]).
      const conflict = await db.memoryItem.findUnique({
        where: { key_scope: { key: item.key, scope: newScope } },
      });
      if (conflict) {
        // Merge — append this row's value to the existing target row, then
        // delete the source row. Tags get unioned.
        const mergedValue = `${conflict.value}\n---\n${item.value}`;
        let mergedTags: string[] = [];
        try {
          mergedTags = JSON.parse(conflict.tags) as string[];
        } catch {
          mergedTags = [];
        }
        let srcTags: string[] = [];
        try {
          srcTags = JSON.parse(item.tags) as string[];
        } catch {
          srcTags = [];
        }
        const tagSet = Array.from(new Set([...mergedTags, ...srcTags]));
        await db.memoryItem.update({
          where: { id: conflict.id },
          data: { value: mergedValue, tags: JSON.stringify(tagSet) },
        });
        await db.memoryItem.delete({ where: { id: item.id } });
      } else {
        // No conflict — simply re-scope the row.
        await db.memoryItem.update({
          where: { id: item.id },
          data: { scope: newScope },
        });
      }

      // Move the paired `__meta` row if it exists at the old scope.
      const metaKey = `${item.key}__meta`;
      const metaRow = await db.memoryItem.findUnique({
        where: { key_scope: { key: metaKey, scope: currentScope } },
      });
      if (metaRow) {
        const metaConflict = await db.memoryItem.findUnique({
          where: { key_scope: { key: metaKey, scope: newScope } },
        });
        if (metaConflict) {
          await db.memoryItem.delete({ where: { id: metaRow.id } });
        } else {
          await db.memoryItem.update({
            where: { id: metaRow.id },
            data: { scope: newScope },
          });
        }
      }

      details.push({
        id: item.id,
        key: item.key,
        from: currentScope,
        to: newScope,
        reason: suggestion.reason,
        confidence: suggestion.confidence,
      });
      moved++;
    } catch (e) {
      // Log + continue — one bad row shouldn't abort the whole scan.
      details.push({
        id: item.id,
        key: item.key,
        from: currentScope,
        to: newScope,
        reason: `error: ${e instanceof Error ? e.message : 'unknown'}`,
        confidence: suggestion.confidence,
      });
    }
  }

  return NextResponse.json({
    dryRun,
    scanned,
    moved,
    skipped,
    details,
  });
}

/** GET /api/learning/auto-move — quick status endpoint (no scan). Returns the
 *  list of sections auto-move considers + a small explanation. */
export async function GET() {
  return NextResponse.json({
    sections: SECTIONS,
    description:
      'POST { dryRun?: boolean, sections?: string[], limit?: number } to scan + auto-move MemoryItems to their auto-categorized section.',
    confidenceThreshold: 0.35,
  });
}
