import { NextRequest, NextResponse } from 'next/server';
import { searchInFiles } from '@/lib/ide';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as {
      projectId?: string; query?: string; useRegex?: boolean;
      caseSensitive?: boolean; filePattern?: string;
    };
    if (!body.projectId || !body.query) {
      return NextResponse.json({ error: 'projectId + query required' }, { status: 400 });
    }
    const results = await searchInFiles(body.projectId, body.query, {
      useRegex: body.useRegex,
      caseSensitive: body.caseSensitive,
      filePattern: body.filePattern,
    });
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'search failed' }, { status: 500 });
  }
}
