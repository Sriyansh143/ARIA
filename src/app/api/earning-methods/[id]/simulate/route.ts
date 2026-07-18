import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { chat } from '@/lib/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/earning-methods/[id]/simulate
// Runs a simulation of the earning method: market test, cost analysis, timeline
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const method = await db.earningMethod.findUnique({ where: { id } });
  if (!method) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await db.earningMethod.update({
    where: { id },
    data: { approvalStatus: 'simulating' },
  });

  const simulationPrompt = `You are the CEO running a simulation for an earning method.

Method: ${method.name}
Description: ${method.description}
Category: ${method.category}
Skills Required: ${method.skillsRequired}

Run a thorough simulation:
1. **Market Test**: Who would buy this? What's the demand? Price range?
2. **Cost Analysis**: What resources/agents/tools are needed? What's the cost per delivery?
3. **Timeline**: How long from start to first payment? How long per delivery?
4. **Sample Deliverable**: Create a sample output (e.g., if it's content writing, write a sample blog post; if it's app development, describe a sample app architecture).
5. **Risk Assessment**: What could go wrong? Mitigations?
6. **Workflow Steps**: Step-by-step process from client inquiry to payment receipt.

Respond in JSON:
{
  "marketTest": "analysis",
  "costAnalysis": "breakdown",
  "timeline": "timeline",
  "sampleDeliverable": "sample output",
  "riskAssessment": "risks + mitigations",
  "workflowSteps": ["step 1", "step 2", ...]
}`;

  const { content } = await chat(simulationPrompt, []);

  // Try to parse as JSON, fallback to raw text
  let simulation;
  try {
    const match = content.match(/\{[\s\S]*\}/);
    simulation = match ? JSON.parse(match[0]) : { raw: content };
  } catch {
    simulation = { raw: content };
  }

  // Generate workflow steps as JSON array
  let workflowSteps = [];
  if (simulation.workflowSteps) {
    workflowSteps = simulation.workflowSteps;
  }

  await db.earningMethod.update({
    where: { id },
    data: {
      simulationResults: JSON.stringify(simulation).slice(0, 10000),
      workflowSteps: JSON.stringify(workflowSteps).slice(0, 5000),
      approvalStatus: 'ready',
      lastResearched: new Date(),
    },
  });

  // Create notification
  await db.notification.create({
    data: {
      type: 'success',
      title: `Simulation Complete: ${method.name}`,
      message: `Simulation done. Workflow with ${workflowSteps.length} steps ready. Awaiting owner review.`,
    },
  });

  return NextResponse.json({
    ok: true,
    simulation,
    workflowSteps,
    approvalStatus: 'ready',
  });
}
