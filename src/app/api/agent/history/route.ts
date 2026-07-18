import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — list autonomy run history (with parsed trace + task titles).
export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 30);
  const runs = await db.autonomyRun.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(limit, 100) });
  return NextResponse.json({
    runs: runs.map((r) => ({
      ...r,
      trace: JSON.parse(r.traceJson),
      taskTitles: JSON.parse(r.taskTitles),
    })),
  });
}

// DELETE — clear all history (or by id via ?id=).
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (id) {
    await db.autonomyRun.delete({ where: { id } });
  } else {
    await db.autonomyRun.deleteMany();
  }
  return NextResponse.json({ ok: true });
}
