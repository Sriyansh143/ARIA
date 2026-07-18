import { NextResponse } from 'next/server';
import { ceoSweep } from '@/lib/ceo-agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST — run a CEO sweep across all tabs
export async function POST() {
  const result = await ceoSweep();
  return NextResponse.json(result);
}
