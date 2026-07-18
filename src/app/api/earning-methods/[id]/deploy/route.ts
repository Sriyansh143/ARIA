import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/earning-methods/[id]/deploy
// Deploys an approved earning method: creates tasks for each workflow step
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const method = await db.earningMethod.findUnique({ where: { id } });
  if (!method) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (!method.approved) {
    return NextResponse.json({ error: 'Method must be approved before deployment' }, { status: 400 });
  }

  const workflowSteps = JSON.parse(method.workflowSteps || '[]') as string[];
  if (workflowSteps.length === 0) {
    return NextResponse.json({ error: 'No workflow steps found. Run simulation first.' }, { status: 400 });
  }

  // Create tasks for each workflow step
  const tasksCreated = [];
  for (let i = 0; i < workflowSteps.length; i++) {
    const step = workflowSteps[i];
    const task = await db.task.create({
      data: {
        title: `[${method.name}] Step ${i + 1}: ${step.slice(0, 100)}`,
        description: step,
        priority: 'high',
        tags: JSON.stringify(['earning-method', method.key, 'deployed']),
      },
    });
    tasksCreated.push({ id: task.id, step: i + 1, title: step.slice(0, 80) });
  }

  // Update method status
  await db.earningMethod.update({
    where: { id },
    data: {
      approvalStatus: 'deployed',
      deployedAt: new Date(),
      enabled: true,
    },
  });

  // Create notification
  await db.notification.create({
    data: {
      type: 'success',
      title: `Earning Method Deployed: ${method.name}`,
      message: `${tasksCreated.length} tasks created for the workflow. Agents will start executing.`,
    },
  });

  return NextResponse.json({
    ok: true,
    deployed: true,
    tasksCreated: tasksCreated.length,
    tasks: tasksCreated,
  });
}
