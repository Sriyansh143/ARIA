import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET — list all saved report diffs (most recent first).
export async function GET() {
  const diffs = await db.reportDiff.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
  return NextResponse.json({ diffs });
}

// DELETE — clear all report diffs (or by id via ?id=).
export async function DELETE(_req: Request) {
  const url = new URL(_req.url);
  const id = url.searchParams.get('id');
  if (id) {
    await db.reportDiff.delete({ where: { id } });
  } else {
    await db.reportDiff.deleteMany();
  }
  return NextResponse.json({ ok: true });
}
