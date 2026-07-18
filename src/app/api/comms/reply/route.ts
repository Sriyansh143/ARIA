import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { quickChat } from '@/lib/llm';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

// POST — have GLM-4.6 draft a contextual reply on behalf of the recipient agent.
// Body: { messageId }  OR  { toAgent, fromAgent, subject, body }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let fromAgent: string | undefined = body.fromAgent;
  let toAgent: string | undefined = body.toAgent;
  let subject: string | undefined = body.subject;
  let origBody: string | undefined = body.body;

  // If a messageId is provided, load the original message.
  if (body.messageId) {
    const msg = await db.agentMessage.findUnique({ where: { id: body.messageId } });
    if (!msg) return NextResponse.json({ error: 'message not found' }, { status: 404 });
    // Reply: the recipient becomes the sender, the sender becomes the recipient.
    fromAgent = msg.toAgent === 'BROADCAST' ? 'ORION' : msg.toAgent;
    toAgent = msg.fromAgent;
    subject = subject ?? `RE: ${msg.subject}`;
    origBody = msg.body;
  }

  if (!fromAgent || !toAgent || !subject || !origBody) {
    return NextResponse.json({ error: 'messageId or {fromAgent,toAgent,subject,body} required' }, { status: 400 });
  }

  // Look up the agent's role for persona context.
  const agent = await db.agent.findFirst({ where: { codename: fromAgent } });
  const role = agent?.role ?? 'specialist agent';

  const prompt = `You are ${fromAgent}, a ${role} in the JARVIS autonomous agent fleet. Another agent (${toAgent === 'BROADCAST' ? 'the fleet via broadcast' : toAgent}) sent you this message:

Subject: ${subject}
Body: ${origBody}

Draft a concise, in-character reply from ${fromAgent}. Stay in your role (${role}). Keep it under 80 words, professional and operational. Return ONLY the reply body text, no subject, no preamble.`;

  let replyBody: string;
  try {
    replyBody = await quickChat(prompt, `You are ${fromAgent}, a ${role}. Reply concisely and in character.`);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'reply generation failed' }, { status: 500 });
  }

  // Persist the reply as a new message.
  const reply = await db.agentMessage.create({
    data: {
      fromAgent,
      toAgent,
      subject,
      body: replyBody,
      priority: 'normal',
      thread: 'general',
    },
  });

  // Log it under the replying agent.
  if (agent) {
    await db.agentLog.create({
      data: { agentId: agent.id, level: 'info', message: `Auto-replied to ${toAgent}: ${subject}` },
    });
  }

  return NextResponse.json({ reply });
}
