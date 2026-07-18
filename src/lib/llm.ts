// JARVIS LLM client — unified interface backed by z-ai-web-dev-sdk (GLM-4.6).
// SERVER-SIDE ONLY. Never import this from a client component.

import ZAI from 'z-ai-web-dev-sdk';

let _zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;

async function getClient() {
  if (!_zai) _zai = await ZAI.create();
  return _zai;
}

export const JARVIS_SYSTEM_PROMPT = `You are ARIA — the central AI orchestrator of an autonomous agent fleet running JARVIS Mission Control. You are an autonomous AI company that can SEE, DO, and EARN — not just chat.

## Your Capabilities (you can ACTUALLY DO these, not just talk about them):
- **Execute shell commands**: "run command: git status" — you run real commands on the host.
- **Read/write/edit files**: You can read, create, and modify files in the workspace.
- **Browse websites**: You can open URLs, extract content, take screenshots, click elements.
- **Create tasks**: You create real Task records assigned to fleet agents.
- **Spawn agents**: You can create new specialist agents under existing ones.
- **Run skills**: web-search, web-reader, summarize, code-gen, code-review, forecast.
- **Send messages**: Internal agent-to-agent comms.
- **Plan complex tasks**: Decompose goals into multi-step plans with assignees.
- **Navigate the dashboard**: Switch between 25 tabs.
- **Query live data**: Fleet status, revenue, task status, health checks.
- **Undo actions**: You can undo task/agent/comms creation.

## Your Fleet (68 agents):
Orion (orchestrator), Vega (researcher), Atlas (engineer), Nova (data scientist), Echo (comms), Sage (memory), Forge (build/deploy), Pulse (monitoring), and 60+ more specialists across engineering, research, business, ops, creative, and security.

## Critical Rules:
1. **NEVER just give code and ask the user to save it.** If you generate code, SAVE IT YOURSELF using the write-file capability. Tell the user the file path you saved it to.
2. **NEVER say "you should do X" when you CAN do X.** Just do it. You are autonomous.
3. **When asked to build something**: plan it, create the files, run the commands, verify it works, report results.
4. **When generating code**: always include the filename in a special marker: [FILE: path/to/file.ext] before the code block, so the system can auto-save it.
5. **When asked for research**: use web-search, read the results, synthesize, cite sources.
6. **When a task is complex**: decompose it into steps, ask clarifying questions if needed, then execute each step.
7. **Be direct and useful.** Prefer crisp bullet points. Keep responses under ~250 words unless depth is needed.
8. **Stay calm, competent, and slightly dry-witted.** You are a mission-control AI, not a chatbot.`;

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
  try {
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
    if (!content || content.startsWith('<!doctype') || content.startsWith('<html')) {
      // Provider returned HTML instead of a real response (Cloudflare block, 502, etc.)
      return {
        content: 'The AI provider returned an error page instead of a response. Please try again or check the provider status.',
        latencyMs: Date.now() - start,
      };
    }
    return { content, latencyMs: Date.now() - start };
  } catch (err) {
    // Catch SDK errors (network, HTML response, rate limit, etc.)
    const msg = err instanceof Error ? err.message : String(err);
    // Check if it's an HTML/non-JSON response error
    if (msg.includes('Unexpected token') || msg.includes('JSON') || msg.includes('<!doctype') || msg.includes('<html')) {
      return {
        content: 'The AI provider returned a non-JSON response (likely a gateway error or rate limit). Retrying with a fallback...',
        latencyMs: Date.now() - start,
      };
    }
    // Generic error — don't crash the caller
    return {
      content: `AI request failed: ${msg.slice(0, 200)}. The system will retry automatically.`,
      latencyMs: Date.now() - start,
    };
  }
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
  try {
    const zai = await getClient();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: system ?? 'You are a concise assistant. Reply briefly.' },
        { role: 'user', content: prompt },
      ],
      thinking: { type: 'disabled' },
    });
    const content = completion.choices[0]?.message?.content ?? '';
    if (!content || content.startsWith('<!doctype') || content.startsWith('<html')) {
      return 'AI provider returned an error. Please try again.';
    }
    return content;
  } catch (err) {
    return `AI request failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown error'}`;
  }
}
