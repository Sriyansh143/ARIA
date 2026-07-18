import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { quickChat } from '@/lib/llm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Compare 2 stored reports (episodic memory items tagged 'report') via GLM-4.6.
// GET /api/reports/diff?a=<memoryId>&b=<memoryId>
// If no ids provided, returns the list of available reports to pick from.
export async function GET(req: NextRequest) {
  const a = req.nextUrl.searchParams.get('a');
  const b = req.nextUrl.searchParams.get('b');

  // If no ids, return available reports (memory items tagged with 'report').
  if (!a || !b) {
    const reports = await db.memoryItem.findMany({
      where: { OR: [{ tags: { contains: 'report' } }, { key: { contains: 'report' } }, { key: { contains: 'daily-report' } }] },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { id: true, key: true, value: true, updatedAt: true },
    });
    return NextResponse.json({
      reports: reports.map((r) => ({ id: r.id, key: r.key, preview: r.value.slice(0, 120), updatedAt: r.updatedAt })),
    });
  }

  const [repA, repB] = await Promise.all([
    db.memoryItem.findUnique({ where: { id: a } }),
    db.memoryItem.findUnique({ where: { id: b } }),
  ]);
  if (!repA || !repB) return NextResponse.json({ error: 'one or both reports not found' }, { status: 404 });

  const prompt = `You are JARVIS. Compare these two fleet reports and produce a concise day-over-day (or run-over-run) diff in markdown.

Report A (${repA.key}, ${new Date(repA.updatedAt).toLocaleString()}):
${repA.value.slice(0, 3000)}

---

Report B (${repB.key}, ${new Date(repB.updatedAt).toLocaleString()}):
${repB.value.slice(0, 3000)}

---

Format:
## Report Diff

### What Changed
- (key differences: metrics that moved, new issues, resolved issues)

### Improved
- (things that got better)

### Regressed
- (things that got worse)

### Net Assessment
(1-2 sentence summary of the trajectory)

Keep it under 200 words. Be specific with numbers where possible.`;

  let diff: string;
  try {
    diff = await quickChat(prompt, 'You are JARVIS generating a report diff. Be concise and specific.');
  } catch (e) {
    diff = `## Report Diff\n\n*(GLM-4.6 diff failed: ${e instanceof Error ? e.message : 'unknown'})*\n\nReport A: ${repA.key}\nReport B: ${repB.key}`;
  }

  // Persist the diff to history.
  try {
    await db.reportDiff.create({
      data: { reportAKey: repA.key, reportBKey: repB.key, diff },
    });
  } catch { /* ignore */ }

  return NextResponse.json({
    diff,
    a: { id: repA.id, key: repA.key, updatedAt: repA.updatedAt, preview: repA.value.slice(0, 200) },
    b: { id: repB.id, key: repB.key, updatedAt: repB.updatedAt, preview: repB.value.slice(0, 200) },
    generatedAt: new Date().toISOString(),
  });
}
