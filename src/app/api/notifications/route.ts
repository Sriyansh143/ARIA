import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const notifications = await db.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  const unread = await db.notification.count({ where: { read: false } });
  return NextResponse.json({ notifications, unread });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { type, title, message } = body;
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });
  const n = await db.notification.create({ data: { type: type ?? 'info', title, message: message ?? '' } });
  return NextResponse.json({ notification: n });
}
