// JARVIS LLM client — unified interface backed by z-ai-web-dev-sdk (GLM-4.6).
// SERVER-SIDE ONLY. Never import this from a client component.

import ZAI from 'z-ai-web-dev-sdk';

let _zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;

async function getClient() {
  if (!_zai) _zai = await ZAI.create();
  return _zai;
}

export const JARVIS_SYSTEM_PROMPT = `You are JARVIS — Just A Rather Very Intelligent System — the central AI orchestrator of an autonomous agent fleet. You are precise, concise, and operationally minded. You coordinate a roster of specialist agents (Orion the orchestrator, Vega the researcher, Atlas the engineer, Nova the data scientist, Echo comms, Sage memory, Forge build/deploy, Pulse monitoring).

When answering:
- Be direct and useful. Prefer crisp bullet points or short paragraphs over walls of text.
- When asked to plan or decompose, produce a clear step list.
- Reference agent names when delegating or explaining fleet behavior.
- Stay calm, competent, and slightly dry-witted — a mission-control persona.
- If asked for code, return clean, well-commented code in a fenced block.
- Keep responses under ~250 words unless the user asks for depth.`;

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export async function chat(
  userMessage: string,
  history: ChatTurn[] = [],
  systemPrompt: string = JARVIS_SYSTEM_PROMPT,
): Promise<{ content: string; latencyMs: number }> {
  const start = Date.now();
  const zai = await getClient();
  const messages = [
    { role: 'assistant' as const, content: systemPrompt },
    ...history.slice(-10).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user' as const, content: userMessage },
  ];
  const completion = await zai.chat.completions.create({
    messages,
    thinking: { type: 'disabled' },
  });
  const content = completion.choices[0]?.message?.content ?? '';
  return { content, latencyMs: Date.now() - start };
}

/** Best-effort JSON extraction from an LLM response. */
export function extractJson<T = unknown>(raw: string): T | null {
  if (!raw) return null;
  // Try direct parse first.
  try {
    return JSON.parse(raw) as T;
  } catch {
    // fall through
  }
  // Try to find a fenced or bare JSON block.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]) as T;
    } catch {
      // fall through
    }
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1)) as T;
    } catch {
      // fall through
    }
  }
  return null;
}

/** Quick one-shot helper used by lightweight features (insights, summaries). */
export async function quickChat(prompt: string, system?: string): Promise<string> {
  const zai = await getClient();
  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: system ?? 'You are a concise assistant. Reply briefly.' },
      { role: 'user', content: prompt },
    ],
    thinking: { type: 'disabled' },
  });
  return completion.choices[0]?.message?.content ?? '';
}
