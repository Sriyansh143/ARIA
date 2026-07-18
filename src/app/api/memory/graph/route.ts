import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Returns graph data: nodes = memory items + tags, edges = item→tag links.
export async function GET() {
  const items = await db.memoryItem.findMany({ orderBy: { updatedAt: 'desc' }, take: 60 });

  const SCOPE_COLORS: Record<string, string> = {
    semantic: '#7DD3FC',
    episodic: '#C4B5FD',
    working: '#FBBF24',
    conversation: '#34D399',
  };

  type Node = { id: string; label: string; type: string; color: string; size: number; meta: Record<string, unknown> };
  type Edge = { source: string; target: string; color: string; width: number; label: string };

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const tagSet = new Map<string, number>(); // tag → count

  // Memory item nodes.
  for (const it of items) {
    const color = SCOPE_COLORS[it.scope] ?? '#94A3B8';
    nodes.push({
      id: `mem-${it.id}`,
      label: it.key,
      type: it.scope,
      color,
      size: it.pinned ? 11 : 8,
      meta: { scope: it.scope, pinned: it.pinned, value: it.value.slice(0, 120) },
    });
    let tags: string[] = [];
    try { tags = JSON.parse(it.tags || '[]'); } catch { /* ignore */ }
    for (const tag of tags) {
      tagSet.set(tag, (tagSet.get(tag) ?? 0) + 1);
      edges.push({ source: `mem-${it.id}`, target: `tag-${tag}`, color: `${color}66`, width: 1, label: `${it.scope} → ${tag}` });
    }
  }

  // Tag nodes (sized by frequency).
  for (const [tag, count] of tagSet) {
    nodes.push({
      id: `tag-${tag}`,
      label: `#${tag}`,
      type: 'tag',
      color: '#38BDF8',
      size: 7 + Math.min(count * 2, 8),
      meta: { count },
    });
  }

  // Co-occurrence: tags that appear together on the same item get a faint edge.
  const coOccur = new Map<string, number>();
  for (const it of items) {
    let tags: string[] = [];
    try { tags = JSON.parse(it.tags || '[]'); } catch { /* ignore */ }
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const key = [tags[i], tags[j]].sort().join('||');
        coOccur.set(key, (coOccur.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [key, count] of coOccur) {
    const [a, b] = key.split('||');
    edges.push({ source: `tag-${a}`, target: `tag-${b}`, color: '#1B2330', width: Math.min(count, 3), label: `co-occur ×${count}` });
  }

  return NextResponse.json({
    nodes,
    edges,
    stats: {
      items: items.length,
      tags: tagSet.size,
      edges: edges.length,
      pinned: items.filter((i) => i.pinned).length,
    },
  });
}
