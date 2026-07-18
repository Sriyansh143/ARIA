import { NextResponse } from 'next/server';
import { getKnowledgeStats } from '@/lib/knowledge-enhancer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const stats = await getKnowledgeStats();
  return NextResponse.json(stats);
}
