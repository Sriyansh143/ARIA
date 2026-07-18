import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ZAI from 'z-ai-web-dev-sdk';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // allow up to 60s for skill execution

let _zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;
async function getClient() {
  if (!_zai) _zai = await ZAI.create();
  return _zai;
}

// POST — execute a skill for real.
// Body: { skillKey, input }
//   skillKey: 'web-search' | 'web-reader' | 'summarize' | 'code-gen' | 'code-review'
//   input: search query | URL | text/prompt
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { skillKey, input } = body as { skillKey?: string; input?: string };
  if (!skillKey || !input || !input.trim()) {
    return NextResponse.json({ error: 'skillKey and input required' }, { status: 400 });
  }

  const start = Date.now();
  let output: unknown;
  let tokens = 0;
  let status = 'success';

  try {
    const zai = await getClient();

    if (skillKey === 'web-search') {
      const results = await zai.functions.invoke('web_search', { query: input, num: 8 });
      output = results;
    } else if (skillKey === 'web-reader') {
      // Validate URL
      let url = input.trim();
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      const result = await zai.functions.invoke('page_reader', { url });
      output = result;
      tokens = (result as { data?: { usage?: { tokens?: number } } })?.data?.usage?.tokens ?? 0;
    } else if (skillKey === 'summarize') {
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: 'You are JARVIS. Summarize the following text into 5 crisp bullet points. Be concise and information-dense.' },
          { role: 'user', content: input },
        ],
        thinking: { type: 'disabled' },
      });
      output = { summary: completion.choices[0]?.message?.content ?? '' };
    } else if (skillKey === 'code-gen') {
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: 'You are JARVIS, an expert engineer. Generate clean, production-ready, well-commented code for the request. Return only the code in a fenced block with the language tag.' },
          { role: 'user', content: input },
        ],
        thinking: { type: 'disabled' },
      });
      output = { code: completion.choices[0]?.message?.content ?? '' };
    } else if (skillKey === 'code-review') {
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: 'You are JARVIS, an expert code reviewer. Review the provided code for bugs, security issues, performance, and style. Return a short structured review with sections: Bugs, Security, Performance, Suggestions. Be specific.' },
          { role: 'user', content: input },
        ],
        thinking: { type: 'disabled' },
      });
      output = { review: completion.choices[0]?.message?.content ?? '' };
    } else if (skillKey === 'forecast') {
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: 'You are JARVIS, a data scientist. Given the data, produce a short forecast with key trends and a 3-point prediction. Reply in markdown with a brief table if useful.' },
          { role: 'user', content: input },
        ],
        thinking: { type: 'disabled' },
      });
      output = { forecast: completion.choices[0]?.message?.content ?? '' };
    } else {
      // Generic fallback: treat as an LLM prompt.
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: `You are JARVIS executing the "${skillKey}" skill. Respond helpfully and concisely.` },
          { role: 'user', content: input },
        ],
        thinking: { type: 'disabled' },
      });
      output = { result: completion.choices[0]?.message?.content ?? '' };
    }
  } catch (err) {
    status = 'error';
    output = { error: err instanceof Error ? err.message : 'skill execution failed' };
  }

  const latencyMs = Date.now() - start;

  // Persist the run in history.
  const run = await db.skillRun.create({
    data: {
      skillKey,
      input: input.slice(0, 2000),
      output: JSON.stringify(output).slice(0, 20000),
      status,
      latencyMs,
      tokens,
    },
  });

  // Bump the skill's run counter.
  try {
    await db.skill.update({ where: { key: skillKey }, data: { runs: { increment: 1 } } });
  } catch {
    // skill key may not exist in DB — ignore
  }

  return NextResponse.json({ run, output, latencyMs, status });
}
