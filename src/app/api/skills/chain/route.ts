import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ZAI from 'z-ai-web-dev-sdk';
import { JARVIS_SYSTEM_PROMPT } from '@/lib/llm';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // pipelines can take a while

let _zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;
async function getClient() {
  if (!_zai) _zai = await ZAI.create();
  return _zai;
}

interface PipelineStep {
  skillKey: string; // web-search | web-reader | summarize | code-gen | ...
  input?: string; // explicit input; if omitted, uses previous step's output
  label?: string;
}

interface StepResult {
  step: number;
  skillKey: string;
  label?: string;
  input: string;
  output: unknown;
  outputSummary: string; // short text extract for display
  latencyMs: number;
  status: string;
}

// POST — execute a skill pipeline. Body: { pipeline: PipelineStep[] }
// Each step's output feeds the next step's input (unless explicitly set).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const pipeline = body.pipeline as PipelineStep[] | undefined;
  if (!pipeline || !Array.isArray(pipeline) || pipeline.length === 0) {
    return NextResponse.json({ error: 'pipeline (non-empty array) required' }, { status: 400 });
  }

  const zai = await getClient();
  const results: StepResult[] = [];
  let prevOutput = '';

  for (let i = 0; i < pipeline.length; i++) {
    const step = pipeline[i];
    const input = step.input ?? prevOutput;
    if (!input || !input.trim()) {
      results.push({ step: i + 1, skillKey: step.skillKey, label: step.label, input: '', output: { error: 'no input' }, outputSummary: 'no input', latencyMs: 0, status: 'error' });
      break;
    }
    const start = Date.now();
    let output: unknown;
    let outputSummary = '';
    let status = 'success';

    try {
      if (step.skillKey === 'web-search') {
        const r = await zai.functions.invoke('web_search', { query: input, num: 5 });
        output = r;
        outputSummary = `${Array.isArray(r) ? r.length : 0} results: ${(Array.isArray(r) ? r.slice(0, 3).map((x: { name?: string }) => x.name).join('; ') : '')}`;
        prevOutput = Array.isArray(r) ? r.map((x: { name?: string; snippet?: string; url?: string }) => `${x.name}\n${x.url}\n${x.snippet}`).join('\n\n') : JSON.stringify(r);
      } else if (step.skillKey === 'web-reader') {
        let url = input.trim();
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
        const r = await zai.functions.invoke('page_reader', { url });
        output = r;
        const html = (r as { data?: { html?: string; title?: string } })?.data?.html ?? '';
        const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        outputSummary = `Read: ${(r as { data?: { title?: string } })?.data?.title ?? url}`;
        prevOutput = text.slice(0, 8000);
      } else if (step.skillKey === 'summarize') {
        const c = await zai.chat.completions.create({
          messages: [
            { role: 'assistant', content: 'You are JARVIS. Summarize the following into 5 crisp bullet points.' },
            { role: 'user', content: input.slice(0, 8000) },
          ],
          thinking: { type: 'disabled' },
        });
        const text = c.choices[0]?.message?.content ?? '';
        output = { summary: text };
        outputSummary = text.slice(0, 160);
        prevOutput = text;
      } else if (step.skillKey === 'code-gen') {
        const c = await zai.chat.completions.create({
          messages: [
            { role: 'assistant', content: 'You are JARVIS, an expert engineer. Generate clean, production-ready, well-commented code. Return only the code in a fenced block.' },
            { role: 'user', content: input },
          ],
          thinking: { type: 'disabled' },
        });
        const text = c.choices[0]?.message?.content ?? '';
        output = { code: text };
        outputSummary = text.slice(0, 160);
        prevOutput = text;
      } else if (step.skillKey === 'code-review') {
        const c = await zai.chat.completions.create({
          messages: [
            { role: 'assistant', content: 'You are JARVIS, an expert code reviewer. Review for bugs, security, performance, style. Be specific and concise.' },
            { role: 'user', content: input },
          ],
          thinking: { type: 'disabled' },
        });
        const text = c.choices[0]?.message?.content ?? '';
        output = { review: text };
        outputSummary = text.slice(0, 160);
        prevOutput = text;
      } else if (step.skillKey === 'forecast') {
        const c = await zai.chat.completions.create({
          messages: [
            { role: 'assistant', content: 'You are JARVIS, a data scientist. Given the data, produce a short forecast with key trends and a 3-point prediction.' },
            { role: 'user', content: input },
          ],
          thinking: { type: 'disabled' },
        });
        const text = c.choices[0]?.message?.content ?? '';
        output = { forecast: text };
        outputSummary = text.slice(0, 160);
        prevOutput = text;
      } else if (step.skillKey === 'llm') {
        const c = await zai.chat.completions.create({
          messages: [
            { role: 'assistant', content: JARVIS_SYSTEM_PROMPT },
            { role: 'user', content: input },
          ],
          thinking: { type: 'disabled' },
        });
        const text = c.choices[0]?.message?.content ?? '';
        output = { result: text };
        outputSummary = text.slice(0, 160);
        prevOutput = text;
      } else {
        output = { error: `unknown skill: ${step.skillKey}` };
        outputSummary = `unknown skill: ${step.skillKey}`;
        status = 'error';
      }
    } catch (err) {
      output = { error: err instanceof Error ? err.message : 'step failed' };
      outputSummary = String((output as { error: string }).error).slice(0, 160);
      status = 'error';
    }

    const latencyMs = Date.now() - start;
    const sr: StepResult = { step: i + 1, skillKey: step.skillKey, label: step.label, input: input.slice(0, 300), output, outputSummary, latencyMs, status };
    results.push(sr);

    // Persist each step as a SkillRun.
    try {
      await db.skillRun.create({
        data: { skillKey: step.skillKey, input: input.slice(0, 2000), output: JSON.stringify(output).slice(0, 20000), status, latencyMs, tokens: 0 },
      });
    } catch { /* ignore */ }

    if (status === 'error') break;
  }

  return NextResponse.json({ results, totalLatency: results.reduce((s, r) => s + r.latencyMs, 0) });
}

// Preset pipelines for the UI.
export const PIPELINE_PRESETS: Array<{ key: string; name: string; description: string; pipeline: PipelineStep[] }> = [
  {
    key: 'research',
    name: 'Research Pipeline',
    description: 'Search the web → read the top result → summarize into bullets.',
    pipeline: [
      { skillKey: 'web-search', label: 'Search', input: '' },
      { skillKey: 'web-reader', label: 'Read top result' },
      { skillKey: 'summarize', label: 'Summarize' },
    ],
  },
  {
    key: 'deep-dive',
    name: 'Deep Dive',
    description: 'Search → read → review as code (for technical articles).',
    pipeline: [
      { skillKey: 'web-search', label: 'Search', input: '' },
      { skillKey: 'web-reader', label: 'Read article' },
      { skillKey: 'summarize', label: 'Key takeaways' },
    ],
  },
];
