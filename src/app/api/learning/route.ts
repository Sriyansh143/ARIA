import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/learning — returns learning records + aggregate stats.
export async function GET(req: NextRequest) {
  const agentCodename = req.nextUrl.searchParams.get('agent');
  const skillKey = req.nextUrl.searchParams.get('skill');

  const where: Record<string, unknown> = {};
  if (agentCodename) where.agentCodename = agentCodename;
  if (skillKey) where.skillKey = skillKey;

  const records = await db.skillLearning.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 500,
  });

  // Aggregate stats.
  const total = records.length;
  const totalEarnings = records.reduce((s, r) => s + (r.earnings ?? 0), 0);
  const avgProficiency =
    total > 0 ? Math.round(records.reduce((s, r) => s + (r.proficiency ?? 0), 0) / total) : 0;
  const mastered = records.filter((r) => (r.proficiency ?? 0) >= 90).length;

  // By-agent earnings.
  const byAgentMap = new Map<string, number>();
  for (const r of records) {
    byAgentMap.set(r.agentCodename, (byAgentMap.get(r.agentCodename) ?? 0) + (r.earnings ?? 0));
  }
  const earningsByAgent = Array.from(byAgentMap.entries())
    .map(([agent, earnings]) => ({ agent, earnings: Math.round(earnings * 100) / 100 }))
    .sort((a, b) => b.earnings - a.earnings)
    .slice(0, 12);

  // By-skill avg proficiency.
  const bySkillMap = new Map<string, { sum: number; n: number }>();
  for (const r of records) {
    const cur = bySkillMap.get(r.skillKey) ?? { sum: 0, n: 0 };
    cur.sum += r.proficiency ?? 0;
    cur.n += 1;
    bySkillMap.set(r.skillKey, cur);
  }
  const proficiencyBySkill = Array.from(bySkillMap.entries())
    .map(([skill, v]) => ({ skill, proficiency: Math.round(v.sum / v.n) }))
    .sort((a, b) => b.proficiency - a.proficiency)
    .slice(0, 12);

  return NextResponse.json({
    records,
    stats: {
      total,
      totalEarnings: Math.round(totalEarnings * 100) / 100,
      avgProficiency,
      mastered,
    },
    earningsByAgent,
    proficiencyBySkill,
  });
}

// POST /api/learning — upsert a SkillLearning record (teach an agent).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { agentCodename, skillKey, proficiency, earnings, learnedFrom } = body;
  if (!agentCodename || !skillKey) {
    return NextResponse.json({ error: 'agentCodename and skillKey required' }, { status: 400 });
  }
  const record = await db.skillLearning.upsert({
    where: { agentCodename_skillKey: { agentCodename, skillKey } },
    update: {
      proficiency: typeof proficiency === 'number' ? proficiency : { increment: 10 },
      earnings: typeof earnings === 'number' ? { increment: earnings } : undefined,
      learnedFrom: learnedFrom ?? undefined,
      lastUsed: new Date(),
    },
    create: {
      agentCodename,
      skillKey,
      proficiency: typeof proficiency === 'number' ? proficiency : 10,
      earnings: typeof earnings === 'number' ? earnings : 0,
      learnedFrom: learnedFrom ?? null,
      lastUsed: new Date(),
    },
  });
  return NextResponse.json({ record });
}
