import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plan = await db.plan.findUnique({
    where: { id },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
  });

  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  await db.plan.update({ where: { id }, data: { status: 'executing' } });

  const results = [];
  
  for (const step of plan.steps) {
    // Skip already completed steps
    if (step.status === 'completed') continue;
    
    // Check dependencies
    const deps = JSON.parse(step.dependsOn || '[]');
    const allDepsComplete = deps.every((depId: string) => 
      plan.steps.find(s => s.id === depId)?.status === 'completed'
    );
    if (!allDepsComplete) {
      results.push({ stepId: step.id, status: 'skipped', reason: 'Dependencies not met' });
      continue;
    }

    // If requires approval, skip (will be handled separately)
    if (step.requiresApproval && step.status === 'pending') {
      results.push({ stepId: step.id, status: 'pending_approval', reason: 'Requires owner approval' });
      continue;
    }

    await db.planStep.update({ where: { id: step.id }, data: { status: 'in_progress' } });

    try {
      const stepParams = JSON.parse(step.params || '{}');
      let result = '';

      switch (step.action) {
        case 'create-task': {
          const agent = stepParams.assignee 
            ? await db.agent.findFirst({ where: { codename: stepParams.assignee.toUpperCase() } })
            : null;
          const task = await db.task.create({
            data: {
              title: stepParams.title || step.title,
              description: step.description || '',
              priority: stepParams.priority || 'high',
              assigneeId: agent?.id || null,
              tags: JSON.stringify(['plan', plan.id]),
            },
          });
          result = `Task created: ${task.id}`;
          break;
        }
        case 'run-command': {
          const { executeCommand } = await import('@/lib/os-executor');
          const cmdResult = await executeCommand(stepParams.command || '');
          result = cmdResult.success ? cmdResult.stdout.slice(0, 500) : `Failed: ${cmdResult.stderr.slice(0, 200)}`;
          break;
        }
        case 'run-skill': {
          const res = await fetch('http://localhost:3000/api/skills/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skillKey: stepParams.skillKey, input: stepParams.input || '' }),
          });
          const json = await res.json();
          result = JSON.stringify(json).slice(0, 500);
          break;
        }
        case 'send-comms': {
          await db.agentMessage.create({
            data: {
              fromAgent: stepParams.fromAgent || 'ORION',
              toAgent: stepParams.toAgent || 'BROADCAST',
              subject: stepParams.subject || step.title,
              body: stepParams.body || step.description || '',
              priority: stepParams.priority || 'normal',
              thread: stepParams.thread || 'ops',
            },
          });
          result = 'Message sent';
          break;
        }
        case 'browse': {
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);
          const { stdout } = await execAsync(`agent-browser open ${stepParams.url}`, { timeout: 15000 });
          result = stdout.slice(0, 500);
          break;
        }
        case 'read-file': {
          const { readSandboxed } = await import('@/lib/fs-sandbox');
          const content = await readSandboxed(stepParams.path || '');
          result = content.slice(0, 500);
          break;
        }
        case 'write-file': {
          const { writeSandboxed } = await import('@/lib/fs-sandbox');
          await writeSandboxed(stepParams.path || '', stepParams.content || '');
          result = 'File written';
          break;
        }
        default:
          result = `Unknown action: ${step.action}`;
      }

      await db.planStep.update({
        where: { id: step.id },
        data: { status: 'completed', result, verifiedAt: new Date() },
      });
      results.push({ stepId: step.id, status: 'completed', result: result.slice(0, 200) });

      // Saga checkpoint: save progress after each step so we can resume after crash
      const completedStepIds = results.filter(r => r.status === 'completed').map(r => r.stepId);
      await db.plan.update({
        where: { id },
        data: {
          checkpoint: JSON.stringify({
            completedSteps: completedStepIds,
            currentStep: step.stepNumber,
            totalSteps: plan.steps.length,
            context: { lastResult: result.slice(0, 500) },
            updatedAt: new Date().toISOString(),
          }),
        },
      });
    } catch (e) {
      await db.planStep.update({
        where: { id: step.id },
        data: { status: 'failed', result: e instanceof Error ? e.message : 'unknown error' },
      });
      results.push({ stepId: step.id, status: 'failed', error: e instanceof Error ? e.message : 'unknown' });
    }
  }

  // Update plan status
  const allCompleted = results.every(r => r.status === 'completed');
  await db.plan.update({
    where: { id },
    data: { status: allCompleted ? 'completed' : 'failed' },
  });

  return NextResponse.json({ ok: true, planId: id, results, completed: allCompleted });
}
