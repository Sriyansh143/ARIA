import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const agents = await db.agent.findMany({ orderBy: { codename: 'asc' } });
  return NextResponse.json({ agents });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { name, codename, role, skills, model, persona, backstory, goal, department, seniority, knowledge, memoryItems, fileContent } = body;
  // Validate name — non-empty string within max length.
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }
  if (name.length > 200) {
    return NextResponse.json({ error: 'name must be 200 characters or fewer' }, { status: 400 });
  }
  // Validate codename — non-empty, max length, uppercase-only letters/numbers.
  if (!codename || typeof codename !== 'string' || codename.trim().length === 0) {
    return NextResponse.json({ error: 'codename required' }, { status: 400 });
  }
  if (codename.length > 64) {
    return NextResponse.json({ error: 'codename must be 64 characters or fewer' }, { status: 400 });
  }
  if (codename !== codename.toUpperCase()) {
    return NextResponse.json({ error: 'codename must be uppercase' }, { status: 400 });
  }

  // Determine best model based on role/skills if not specified
  let agentModel = model || 'glm-4.6';
  if (!model) {
    try {
      const { selectModel } = await import('@/lib/agent-registry');
      const taskKind = /code|develop|engineer|build/.test(role || '') ? 'coding' :
                      /research|analyz|investigat/.test(role || '') ? 'reasoning' :
                      /writ|content|market|creat/.test(role || '') ? 'creative' :
                      'chat';
      agentModel = selectModel(taskKind);
    } catch { /* fallback to glm-4.6 */ }
  }

  const agent = await db.agent.create({
    data: {
      name,
      codename: String(codename).toUpperCase(),
      role: role ?? 'Generalist',
      skills: JSON.stringify(skills ?? []),
      model: agentModel,
      status: 'idle',
    },
  });

  // If persona data provided, store as memory items
  const memoriesToCreate: Array<{ scope: string; key: string; value: string; tags: string; pinned: boolean }> = [];

  if (persona || backstory || goal) {
    memoriesToCreate.push({
      scope: 'semantic',
      key: `persona-${codename.toLowerCase()}`,
      value: JSON.stringify({ persona, backstory, goal, department, seniority }).slice(0, 5000),
      tags: JSON.stringify(['persona', department || 'general', codename.toLowerCase()]),
      pinned: true,
    });
  }

  if (knowledge) {
    memoriesToCreate.push({
      scope: 'semantic',
      key: `knowledge-${codename.toLowerCase()}`,
      value: String(knowledge).slice(0, 10000),
      tags: JSON.stringify(['knowledge', codename.toLowerCase()]),
      pinned: true,
    });
  }

  if (fileContent) {
    memoriesToCreate.push({
      scope: 'semantic',
      key: `uploaded-file-${codename.toLowerCase()}-${Date.now()}`,
      value: String(fileContent).slice(0, 10000),
      tags: JSON.stringify(['uploaded', 'file', codename.toLowerCase()]),
      pinned: false,
    });
  }

  // Add any explicit memory items
  if (Array.isArray(memoryItems)) {
    for (const item of memoryItems) {
      memoriesToCreate.push({
        scope: item.scope || 'semantic',
        key: item.key || `memory-${codename.toLowerCase()}-${Date.now()}`,
        value: String(item.value || '').slice(0, 5000),
        tags: JSON.stringify(['agent-memory', codename.toLowerCase(), ...(item.tags || [])]),
        pinned: item.pinned || false,
      });
    }
  }

  // Create all memory items
  for (const mem of memoriesToCreate) {
    try {
      await db.memoryItem.create({ data: mem });
    } catch { /* best-effort */ }
  }

  // Create notification
  await db.notification.create({
    data: {
      type: 'success',
      title: `Agent Spawned: ${codename}`,
      message: `${name} (${role}) spawned with ${memoriesToCreate.length} memory items. Model: ${agentModel}.`,
    },
  }).catch(() => {});

  return NextResponse.json({
    agent,
    memoriesCreated: memoriesToCreate.length,
    model: agentModel,
  });
}
