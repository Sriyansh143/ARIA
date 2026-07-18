import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { chat } from '@/lib/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/earning-methods/[id]/approve
// Body: { action: 'request-approval' | 'ask-question' | 'answer-question' | 'approve' | 'reject', question?: string, answer?: string }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { action, question, answer } = body as { action?: string; question?: string; answer?: string };

  const method = await db.earningMethod.findUnique({ where: { id } });
  if (!method) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const questions = JSON.parse(method.approvalQuestions || '[]') as Array<{ q: string; a?: string; at: string }>;

  switch (action) {
    case 'request-approval': {
      // CEO prepares the method for owner review: generates a summary + expected questions
      const summary = await chat(`You are the CEO presenting an earning method for owner approval.

Method: ${method.name}
Description: ${method.description}
Category: ${method.category}
Earning Potential: ${method.earningPotential}
Risk Level: ${method.riskLevel}
Simulation Results: ${method.simulationResults || 'N/A'}
Workflow Steps: ${method.workflowSteps || 'N/A'}

Write a concise summary for the owner explaining:
1. What this method is and how it works
2. Expected monthly earnings
3. Risks and mitigations
4. What resources/agents are needed
5. Timeline to first revenue

Keep it under 300 words. Be honest about risks.`);

      await db.earningMethod.update({
        where: { id },
        data: { approvalStatus: 'pending_approval' },
      });

      // Create approval notification
      await db.notification.create({
        data: {
          type: 'warn',
          title: `Approval Required: ${method.name}`,
          message: summary.content.slice(0, 500),
        },
      });

      return NextResponse.json({ ok: true, summary: summary.content, approvalStatus: 'pending_approval' });
    }

    case 'ask-question': {
      // Owner asks a question about the method
      if (!question) return NextResponse.json({ error: 'question required' }, { status: 400 });
      questions.push({ q: question, at: new Date().toISOString() });
      await db.earningMethod.update({
        where: { id },
        data: { approvalQuestions: JSON.stringify(questions) },
      });

      // CEO answers the question
      const answerResult = await chat(`You are the CEO answering the owner's question about an earning method.

Method: ${method.name}
Description: ${method.description}
Simulation: ${method.simulationResults || 'N/A'}

Owner's question: ${question}

Answer honestly and concisely (under 150 words). If you don't know, say so.`);

      // Update the question with the answer
      questions[questions.length - 1].a = answerResult.content;
      await db.earningMethod.update({
        where: { id },
        data: { approvalQuestions: JSON.stringify(questions) },
      });

      return NextResponse.json({ ok: true, question, answer: answerResult.content, allQuestions: questions });
    }

    case 'approve': {
      await db.earningMethod.update({
        where: { id },
        data: { approved: true, enabled: true, approvalStatus: 'approved' },
      });
      await db.notification.create({
        data: {
          type: 'success',
          title: `Earning Method Approved: ${method.name}`,
          message: 'Owner approved. Ready for deployment.',
        },
      });
      return NextResponse.json({ ok: true, approvalStatus: 'approved' });
    }

    case 'reject': {
      await db.earningMethod.update({
        where: { id },
        data: { approved: false, approvalStatus: 'rejected' },
      });
      await db.notification.create({
        data: {
          type: 'warn',
          title: `Earning Method Rejected: ${method.name}`,
          message: 'Owner rejected this method. CEO will research alternatives.',
        },
      });
      return NextResponse.json({ ok: true, approvalStatus: 'rejected' });
    }

    default:
      return NextResponse.json({ error: 'invalid action' }, { status: 400 });
  }
}
