import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ingestSource, TeachSourceType } from '@/lib/teach-source';
import { autoCategorize, type TargetSection } from '@/lib/categorize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/learning/teach — list the 30 most recent learning items across
 *  all 6 sections, with a client-friendly `suggestedSection` computed per row
 *  so the UI can show a "suggested" badge without re-running categorization. */
export async function GET() {
  const sections: TargetSection[] = [
    'skill',
    'plugin',
    'memory',
    'knowledge',
    'intelligence',
    'learning',
  ];
  const items = await db.memoryItem.findMany({
    where: { scope: { in: sections } },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  // Skip pure meta rows for display, but include their parent's metadata.
  const visible = items.filter((i) => !i.key.endsWith('__meta'));

  const enriched = visible.map((i) => {
    // For text-like rows the value IS the content; for video/zip rows it's a
    // JSON payload whose `reference` field carries the URL/path.
    let contentForCategorization = i.value;
    if (i.value.startsWith('{')) {
      try {
        const parsed = JSON.parse(i.value);
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
    return {
      ...i,
      suggestedSection: suggestion.suggestedSection,
      confidence: suggestion.confidence,
      reason: suggestion.reason,
    };
  });

  return NextResponse.json({ items: enriched });
}

/** POST /api/learning/teach — ingest a text/url/video/document/audio source.
 *  Zip is rejected with 400 → caller should use /api/upload?scope=learning. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { type, content, agentCodename, skillKey, targetSection, meta } = body as {
    type?: TeachSourceType;
    content?: string;
    agentCodename?: string;
    skillKey?: string;
    targetSection?: TargetSection;
    meta?: Record<string, unknown>;
  };

  if (!type) {
    return NextResponse.json(
      { error: 'type required (text|url|video|document|audio|zip)' },
      { status: 400 },
    );
  }
  if (type === 'zip') {
    return NextResponse.json(
      {
        error: 'zip ingestion must go through /api/upload?scope=learning',
        hint: 'POST a multipart upload with scope=learning, then call this endpoint again with type=document and the extracted content.',
        uploadEndpoint: '/api/upload?scope=learning',
      },
      { status: 400 },
    );
  }
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return NextResponse.json({ error: 'content required' }, { status: 400 });
  }
  if (content.length > 1_000_000) {
    return NextResponse.json({ error: 'content too large (1MB max for inline)' }, { status: 413 });
  }

  // Validate targetSection if provided.
  const validSections: TargetSection[] = [
    'skill',
    'plugin',
    'memory',
    'knowledge',
    'intelligence',
    'learning',
  ];
  if (targetSection && !validSections.includes(targetSection)) {
    return NextResponse.json(
      { error: `invalid targetSection (must be one of: ${validSections.join(', ')})` },
      { status: 400 },
    );
  }

  // Auto-categorize first (so we can always return a suggestion even when
  // caller forced a different targetSection).
  const suggestion = autoCategorize(content);
  const finalTarget: TargetSection = targetSection ?? suggestion.suggestedSection;

  const result = await ingestSource({
    type,
    content,
    agentCodename,
    skillKey,
    targetSection: finalTarget,
    meta,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error ?? 'ingestion failed',
        suggestedSection: suggestion.suggestedSection,
        confidence: suggestion.confidence,
        reason: suggestion.reason,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ...result,
    suggestedSection: suggestion.suggestedSection,
    confidence: suggestion.confidence,
    reason: suggestion.reason,
    autoApplied: !targetSection, // true if caller let us pick the section
  });
}
