import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/workforce — returns departments + workforce agents.
export async function GET() {
  const [departments, agents] = await Promise.all([
    db.department.findMany({ orderBy: { name: 'asc' } }),
    db.workforceAgent.findMany({ orderBy: { codename: 'asc' } }),
  ]);
  return NextResponse.json({ departments, agents });
}
