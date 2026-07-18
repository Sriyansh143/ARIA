'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Search, BookOpen, FileText, Code2, ShieldCheck, TrendingUp, Sparkles,
  Loader2, ExternalLink, Clock, ChevronRight, Trash2, Terminal,
} from 'lucide-react';
import { useApi, postJson } from '@/lib/hooks/use-api';
import { JARVIS, timeAgo } from '@/lib/config';
import { SectionTitle, StatCard, Pill, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import ReactMarkdown from 'react-markdown';

interface SkillDef {
  key: string;
  label: string;
  icon: typeof Search;
  color: string;
  placeholder: string;
  hint: string;
  resultType: 'search' | 'reader' | 'text' | 'markdown';
}

const SKILLS: SkillDef[] = [
  { key: 'web-search', label: 'Web Search', icon: Search, color: JARVIS.colors.cyan, placeholder: 'e.g. latest Next.js 16 features', hint: 'Search the live web for current info', resultType: 'search' },
  { key: 'web-reader', label: 'Web Reader', icon: BookOpen, color: JARVIS.colors.green, placeholder: 'e.g. https://nextjs.org/blog', hint: 'Extract clean article content from a URL', resultType: 'reader' },
  { key: 'summarize', label: 'Summarize', icon: FileText, color: JARVIS.colors.violet, placeholder: 'Paste text to summarize into 5 bullet points…', hint: 'Condense long text into crisp bullets', resultType: 'markdown' },
  { key: 'code-gen', label: 'Code Gen', icon: Code2, color: JARVIS.colors.amber, placeholder: 'e.g. a debounce hook in TypeScript', hint: 'Generate production-ready code', resultType: 'markdown' },
  { key: 'code-review', label: 'Code Review', icon: ShieldCheck, color: JARVIS.colors.red, placeholder: 'Paste code to review for bugs/security/perf…', hint: 'Analyze code for issues', resultType: 'markdown' },
  { key: 'forecast', label: 'Forecast', icon: TrendingUp, color: JARVIS.colors.green, placeholder: 'e.g. Q3 revenue trend based on: 12k, 15k, 18k, 22k', hint: 'Predict trends from data', resultType: 'markdown' },
];

interface SkillRun {
  id: string; skillKey: string; input: string; output: string; status: string;
  latencyMs: number; tokens: number; createdAt: string;
}

export default function SkillRunnerTab() {
  const [activeKey, setActiveKey] = useState<string>('web-search');
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ output: unknown; latencyMs: number; status: string } | null>(null);
  const { toast } = useToast();
  const { data: histData, refresh } = useApi<{ runs: SkillRun[] }>('/api/skills/history?limit=8', 15000);

  const active = SKILLS.find((s) => s.key === activeKey)!;

  const run = async () => {
    if (!input.trim() || running) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await postJson<{ output: unknown; latencyMs: number; status: string }>('/api/skills/run', { skillKey: activeKey, input });
      setResult({ output: res.output, latencyMs: res.latencyMs, status: res.status });
      if (res.status === 'error') toast({ title: 'Skill failed', variant: 'destructive' });
      else toast({ title: `${active.label} complete`, description: `${res.latencyMs}ms` });
      refresh();
    } catch (e) {
      toast({ title: 'Request failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle title="Skill Runner" icon={Terminal} accent={JARVIS.colors.cyan} action={<Pill color={JARVIS.colors.green}>live · z-ai SDK</Pill>} />

      {/* Skill selector */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {SKILLS.map((s) => {
          const Icon = s.icon;
          const isActive = activeKey === s.key;
          return (
            <button
              key={s.key}
              onClick={() => { setActiveKey(s.key); setResult(null); setInput(''); }}
              className={`jarvis-panel p-3 text-center transition-all ${isActive ? 'jarvis-card-hover' : 'opacity-70 hover:opacity-100'}`}
              style={isActive ? { borderColor: s.color, boxShadow: `0 0 0 1px ${s.color}55, 0 0 20px -8px ${s.color}66` } : undefined}
            >
              <div className="flex h-9 w-9 mx-auto items-center justify-center rounded-lg mb-1.5" style={{ background: `${s.color}1a`, border: `1px solid ${s.color}33`, color: s.color }}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="text-xs text-[var(--j-text)]">{s.label}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Input panel */}
        <div className="lg:col-span-1 jarvis-panel p-4 flex flex-col">
          <SectionTitle title={active.label} icon={active.icon} accent={active.color} />
          <p className="text-xs text-[var(--j-text-dim)] mb-3">{active.hint}</p>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); } }}
            placeholder={active.placeholder}
            className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[180px] flex-1 resize-none text-sm"
          />
          <div className="flex items-center justify-between mt-3">
            <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">⌘+⏎ to run</span>
            <Button onClick={run} disabled={running || !input.trim()} className="jarvis-btn-accent border-0">
              {running ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Running…</> : <><Play className="h-3.5 w-3.5 mr-1.5" /> Run Skill</>}
            </Button>
          </div>

          {/* Recent runs */}
          <div className="mt-4 pt-3 border-t border-[var(--j-border-soft)]">
            <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-2">Recent Runs</div>
            <div className="space-y-1 max-h-40 overflow-y-auto jarvis-scroll">
              {histData?.runs?.length ? histData.runs.slice(0, 6).map((r) => {
                const sk = SKILLS.find((s) => s.key === r.skillKey);
                const color = sk?.color ?? JARVIS.colors.textDim;
                return (
                  <button
                    key={r.id}
                    onClick={() => { setActiveKey(r.skillKey); setInput(r.input); setResult({ output: JSON.parse(r.output), latencyMs: r.latencyMs, status: r.status }); }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--j-panel-soft)] text-left"
                  >
                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: r.status === 'error' ? JARVIS.colors.red : color }} />
                    <span className="jarvis-mono text-[10px] text-[var(--j-text-dim)] truncate flex-1">{r.input.slice(0, 40)}</span>
                    <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] shrink-0">{timeAgo(r.createdAt)}</span>
                  </button>
                );
              }) : <div className="text-[10px] text-[var(--j-text-mute)] px-2 py-2">No runs yet</div>}
            </div>
          </div>
        </div>

        {/* Result panel */}
        <div className="lg:col-span-2 jarvis-panel p-0 overflow-hidden flex flex-col min-h-[400px]">
          <div className="px-4 py-2.5 border-b border-[var(--j-border)] flex items-center justify-between bg-[var(--j-panel-soft)]/40">
            <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Result</span>
            {result && (
              <div className="flex items-center gap-2">
                <Pill color={result.status === 'error' ? JARVIS.colors.red : JARVIS.colors.green}>{result.status}</Pill>
                <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)] flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{result.latencyMs}ms</span>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto jarvis-scroll p-4">
            <AnimatePresence mode="wait">
              {running ? (
                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin mb-3" style={{ color: active.color }} />
                  <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Executing {active.label}…</div>
                </motion.div>
              ) : result ? (
                <motion.div key="result" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <ResultRenderer type={active.resultType} output={result.output} />
                </motion.div>
              ) : (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl mb-3" style={{ background: `${active.color}1a`, border: `1px solid ${active.color}33`, color: active.color }}>
                    <active.icon className="h-7 w-7" />
                  </div>
                  <div className="text-sm text-[var(--j-text-dim)]">Run {active.label} to see results</div>
                  <div className="jarvis-mono text-[10px] text-[var(--j-text-mute)] mt-1">Enter input on the left and press Run</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Result renderer ---------- */
function ResultRenderer({ type, output }: { type: SkillDef['resultType']; output: unknown }) {
  if (!output) return <div className="text-sm text-[var(--j-text-mute)]">No output</div>;

  // Error case
  if (typeof output === 'object' && output !== null && 'error' in output) {
    return (
      <div className="p-3 rounded-lg border border-[var(--j-red)]/40 bg-[var(--j-red)]/5">
        <div className="jarvis-mono text-[10px] uppercase text-[var(--j-red)] mb-1">Error</div>
        <div className="text-sm text-[var(--j-text-dim)]">{(output as { error: string }).error}</div>
      </div>
    );
  }

  if (type === 'search') {
    const results = output as Array<{ name?: string; url?: string; snippet?: string; host_name?: string; date?: string }>;
    if (!Array.isArray(results)) return <div className="text-sm text-[var(--j-text-mute)]">Unexpected response format</div>;
    return (
      <div className="space-y-2">
        <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-2">{results.length} results</div>
        {results.map((r, i) => (
          <motion.a
            key={i}
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            className="block p-3 rounded-lg border border-[var(--j-border)] bg-[var(--j-panel-soft)]/40 hover:border-[var(--j-cyan)]/50 transition-colors group"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="jarvis-mono text-[10px] text-[var(--j-cyan)]">{r.host_name}</span>
              {r.date && <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">{r.date}</span>}
              <ExternalLink className="h-3 w-3 text-[var(--j-text-mute)] ml-auto group-hover:text-[var(--j-cyan)]" />
            </div>
            <div className="text-sm text-[var(--j-text)] mb-1 group-hover:text-[var(--j-cyan)]">{r.name}</div>
            <div className="text-xs text-[var(--j-text-dim)] line-clamp-2">{r.snippet}</div>
          </motion.a>
        ))}
      </div>
    );
  }

  if (type === 'reader') {
    const data = output as { data?: { title?: string; url?: string; html?: string; publishedTime?: string; content?: string }; title?: string; url?: string; html?: string; text?: string };
    const d = data.data ?? data;
    const title = d.title ?? 'Untitled';
    const html = d.html ?? d.content ?? d.text ?? '';
    const plain = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return (
      <div>
        <div className="flex items-center gap-2 mb-3 pb-3 border-b border-[var(--j-border-soft)]">
          <BookOpen className="h-4 w-4 text-[var(--j-green)] shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--j-text)] truncate">{title}</div>
            {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" className="jarvis-mono text-[10px] text-[var(--j-cyan)] hover:underline truncate block">{d.url}</a>}
          </div>
          {d.publishedTime && <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] ml-auto shrink-0">{new Date(d.publishedTime).toLocaleDateString()}</span>}
        </div>
        <div className="text-sm text-[var(--j-text-dim)] leading-relaxed whitespace-pre-wrap line-clamp-[20]">{plain.slice(0, 4000)}{plain.length > 4000 ? '…' : ''}</div>
      </div>
    );
  }

  // markdown / text result
  const obj = output as { summary?: string; code?: string; review?: string; forecast?: string; result?: string };
  const text = obj.summary ?? obj.code ?? obj.review ?? obj.forecast ?? obj.result ?? (typeof output === 'string' ? output : JSON.stringify(output, null, 2));
  return (
    <div className="prose-chat text-sm">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}
