import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { chat } from '@/lib/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { goal, description } = await req.json().catch(() => ({})) as { goal?: string; description?: string };
  if (!goal) return NextResponse.json({ error: 'goal required' }, { status: 400 });

  // Use LLM to decompose the goal into steps
  const prompt = `You are ARIA, an autonomous task planner. Decompose this goal into 3-7 concrete steps.

GOAL: ${goal}
${description ? `CONTEXT: ${description}` : ''}

Available step actions:
- create-task: Create a task for an agent
- run-command: Execute a shell command
- run-skill: Run a skill (web-search, summarize, etc.)
- send-comms: Send a message to an agent
- browse: Open a website
- read-file: Read a file
- write-file: Write a file

Respond in JSON:
{
  "title": "plan title",
  "steps": [
    {"stepNumber": 1, "title": "step title", "action": "create-task", "params": {"title": "task title", "assignee": "ATLAS"}, "dependsOn": [], "requiresApproval": false}
  ]
}`;

  const { content } = await chat(prompt, []);
  
  let planData;
  try {
    const match = content.match(/\{[\s\S]*\}/);
    planData = match ? JSON.parse(match[0]) : { title: goal, steps: [] };
  } catch {
    planData = { title: goal, steps: [] };
  }

  // Create the plan + steps in DB
  const plan = await db.plan.create({
    data: {
      title: planData.title || goal,
      description: description || '',
      goal,
      status: 'draft',
    },
  });

  const steps = [];
  for (const step of (planData.steps || [])) {
    const created = await db.planStep.create({
      data: {
        planId: plan.id,
        stepNumber: step.stepNumber || steps.length + 1,
        title: step.title || `Step ${steps.length + 1}`,
        description: step.description || '',
        action: step.action || 'create-task',
        params: JSON.stringify(step.params || {}),
        dependsOn: JSON.stringify(step.dependsOn || []),
        assignee: step.assignee || null,
        requiresApproval: step.requiresApproval || false,
      },
    });
    steps.push(created);
  }

  return NextResponse.json({ ok: true, plan, steps, stepCount: steps.length });
}
