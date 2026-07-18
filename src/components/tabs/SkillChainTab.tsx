'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Workflow, Play, Loader2, Plus, X, ChevronRight, Search, BookOpen,
  FileText, Code2, ShieldCheck, TrendingUp, Sparkles, CheckCircle2, XCircle,
  Save, Bookmark, Trash2, Share2,
} from 'lucide-react';
import { useApi, postJson, patchJson, deleteJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, Pill, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import ReactMarkdown from 'react-markdown';

interface StepDef {
  skillKey: string;
  label: string;
  input?: string;
}

interface StepResult {
  step: number;
  skillKey: string;
  label?: string;
  input: string;
  output: unknown;
  outputSummary: string;
  latencyMs: number;
  status: string;
}

const SKILL_OPTIONS = [
  { key: 'web-search', label: 'Web Search', icon: Search, color: JARVIS.colors.cyan, hint: 'query' },
  { key: 'web-reader', label: 'Web Reader', icon: BookOpen, color: JARVIS.colors.green, hint: 'URL' },
  { key: 'summarize', label: 'Summarize', icon: FileText, color: JARVIS.colors.violet, hint: 'text' },
  { key: 'code-gen', label: 'Code Gen', icon: Code2, color: JARVIS.colors.amber, hint: 'prompt' },
  { key: 'code-review', label: 'Code Review', icon: ShieldCheck, color: JARVIS.colors.red, hint: 'code' },
  { key: 'forecast', label: 'Forecast', icon: TrendingUp, color: JARVIS.colors.green, hint: 'data' },
  { key: 'llm', label: 'LLM', icon: Sparkles, color: JARVIS.colors.cyan, hint: 'prompt' },
];

const PRESETS: Array<{ key: string; name: string; description: string; pipeline: StepDef[]; initialInput: string; initialLabel: string }> = [
  {
    key: 'research',
    name: 'Research Pipeline',
    description: 'Search the web → read the top result → summarize into bullets',
    initialInput: 'Next.js 16 caching strategies',
    initialLabel: 'Search query',
    pipeline: [
      { skillKey: 'web-search', label: 'Search' },
      { skillKey: 'web-reader', label: 'Read top result' },
      { skillKey: 'summarize', label: 'Summarize' },
    ],
  },
  {
    key: 'code-analysis',
    name: 'Code Analysis',
    description: 'Generate code → review it for issues',
    initialInput: 'A TypeScript debounce hook with cancel',
    initialLabel: 'Code request',
    pipeline: [
      { skillKey: 'code-gen', label: 'Generate' },
      { skillKey: 'code-review', label: 'Review' },
    ],
  },
  {
    key: 'deep-research',
    name: 'Deep Research',
    description: 'Search → read → forecast implications',
    initialInput: 'AI agent frameworks 2026',
    initialLabel: 'Research topic',
    pipeline: [
      { skillKey: 'web-search', label: 'Search' },
      { skillKey: 'web-reader', label: 'Read article' },
      { skillKey: 'forecast', label: 'Forecast trends' },
    ],
  },
];

function skillMeta(key: string) {
  return SKILL_OPTIONS.find((s) => s.key === key) ?? SKILL_OPTIONS[SKILL_OPTIONS.length - 1];
}

export default function SkillChainTab() {
  const { toast } = useToast();
  const [pipeline, setPipeline] = useState<StepDef[]>(PRESETS[0].pipeline);
  const [initialInput, setInitialInput] = useState(PRESETS[0].initialInput);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<StepResult[] | null>(null);
  const [activePreset, setActivePreset] = useState(PRESETS[0].key);
  const [saveOpen, setSaveOpen] = useState(false);
  const { data: tplData, refresh: refreshTpls } = useApi<{ pipelines: Array<{ id: string; name: string; description?: string; steps: StepDef[]; owner: string; runs: number; shared?: boolean; sharedWith?: string[]; updatedAt: string }> }>('/api/pipelines', 0);
  const { data: communityData } = useApi<{ pipelines: Array<{ id: string; name: string; description?: string; steps: StepDef[]; owner: string; runs: number; updatedAt: string }> }>('/api/pipelines?community=true', 15000);

  const applyPreset = (p: typeof PRESETS[number]) => {
    setActivePreset(p.key);
    setPipeline(p.pipeline);
    setInitialInput(p.initialInput);
    setResults(null);
  };

  const addStep = () => {
    setPipeline([...pipeline, { skillKey: 'summarize', label: 'Summarize' }]);
    setResults(null);
  };
  const removeStep = (i: number) => {
    setPipeline(pipeline.filter((_, idx) => idx !== i));
    setResults(null);
  };
  const updateStep = (i: number, skillKey: string) => {
    const m = skillMeta(skillKey);
    setPipeline(pipeline.map((s, idx) => idx === i ? { skillKey, label: m.label } : s));
    setResults(null);
  };
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= pipeline.length) return;
    const next = [...pipeline];
    [next[i], next[j]] = [next[j], next[i]];
    setPipeline(next);
    setResults(null);
  };

  const loadTemplate = (tpl: { name: string; steps: StepDef[] }) => {
    setActivePreset('');
    setPipeline(tpl.steps);
    setResults(null);
    toast({ title: `Loaded "${tpl.name}"` });
  };
  const deleteTemplate = async (id: string, name: string) => {
    await deleteJson(`/api/pipelines/${id}`);
    toast({ title: `Deleted "${name}"` });
    refreshTpls();
  };
  const toggleShare = async (id: string, shared: boolean) => {
    await patchJson('/api/pipelines', { id, shared });
    toast({ title: shared ? 'Shared to community' : 'Unshared' });
    refreshTpls();
  };

  const run = async () => {
    if (!initialInput.trim() || running) return;
    setRunning(true);
    setResults(null);
    try {
      const built = pipeline.map((s, i) => i === 0 ? { ...s, input: initialInput } : s);
      const res = await postJson<{ results: StepResult[]; totalLatency: number }>('/api/skills/chain', { pipeline: built });
      setResults(res.results);
      if (res.results.some((r) => r.status === 'error')) {
        toast({ title: 'Pipeline completed with errors', variant: 'destructive' });
      } else {
        toast({ title: 'Pipeline complete', description: `${res.totalLatency}ms · ${res.results.length} steps` });
      }
    } catch (e) {
      toast({ title: 'Pipeline failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle title="Skill Pipeline" icon={Workflow} accent={JARVIS.colors.green} action={<Pill color={JARVIS.colors.violet}>chain skills</Pill>} />

      {/* Presets */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {PRESETS.map((p) => {
          const isActive = activePreset === p.key;
          return (
            <button
              key={p.key}
              onClick={() => applyPreset(p)}
              className={`jarvis-panel p-3 text-left transition-all ${isActive ? 'jarvis-card-hover' : 'opacity-70 hover:opacity-100'}`}
              style={isActive ? { borderColor: JARVIS.colors.green, boxShadow: `0 0 0 1px ${JARVIS.colors.green}55` } : undefined}
            >
              <div className="flex items-center gap-2 mb-1">
                <Workflow className="h-4 w-4" style={{ color: JARVIS.colors.green }} />
                <span className="text-sm font-medium text-[var(--j-text)]">{p.name}</span>
              </div>
              <p className="text-[11px] text-[var(--j-text-dim)] mb-2">{p.description}</p>
              <div className="flex items-center gap-1 flex-wrap">
                {p.pipeline.map((s, i) => (
                  <span key={i} className="flex items-center gap-0.5">
                    <span className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] border border-[var(--j-border-soft)]">{s.label}</span>
                    {i < p.pipeline.length - 1 && <ChevronRight className="h-2.5 w-2.5 text-[var(--j-text-mute)]" />}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Saved templates */}
      {tplData?.pipelines && tplData.pipelines.length > 0 && (
        <div className="jarvis-panel p-4">
          <SectionTitle title="Saved Templates" icon={Bookmark} accent={JARVIS.colors.violet} action={<span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{tplData.pipelines.length} saved</span>} />
          <div className="space-y-2">
            {tplData.pipelines.map((tpl) => (
              <motion.div key={tpl.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className={`flex items-center gap-3 p-2.5 rounded-lg border bg-[var(--j-panel-soft)]/40 group ${tpl.shared ? 'border-[var(--j-green)]/40' : 'border-[var(--j-border)]'}`}>
                <Bookmark className="h-3.5 w-3.5 text-[var(--j-violet)] shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--j-text)] truncate">{tpl.name}</span>
                    <span className="jarvis-mono text-[9px] text-[var(--j-cyan)]">{tpl.owner}</span>
                    <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">{tpl.runs} runs</span>
                    {tpl.shared && <span className="jarvis-mono text-[9px] uppercase px-1 py-0.5 rounded" style={{ color: JARVIS.colors.green, background: `${JARVIS.colors.green}1a` }}>shared</span>}
                  </div>
                  {tpl.description && <div className="text-[10px] text-[var(--j-text-dim)] truncate">{tpl.description}</div>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => loadTemplate(tpl)} className="jarvis-mono text-[9px] uppercase px-2 py-1 rounded jarvis-btn-accent border-0">Load</button>
                  <button onClick={() => toggleShare(tpl.id, !tpl.shared)} className={`h-7 w-7 flex items-center justify-center rounded ${tpl.shared ? 'text-[var(--j-green)]' : 'text-[var(--j-text-mute)] hover:text-[var(--j-green)]'}`} title={tpl.shared ? 'Unshare' : 'Share to community'}>
                    <Share2 className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => deleteTemplate(tpl.id, tpl.name)} className="h-7 w-7 flex items-center justify-center rounded text-[var(--j-text-mute)] hover:text-[var(--j-red)]" title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Community shared pipelines */}
      {communityData?.pipelines && communityData.pipelines.length > 0 && (
        <div className="jarvis-panel p-4">
          <SectionTitle title="Community Pipelines" icon={Share2} accent={JARVIS.colors.green} action={<span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{communityData.pipelines.length} shared</span>} />
          <div className="space-y-2">
            {communityData.pipelines.map((tpl, i) => (
              <motion.div key={tpl.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="flex items-center gap-3 p-2.5 rounded-lg border border-[var(--j-green)]/30 bg-[var(--j-green)]/5 group">
                <Share2 className="h-3.5 w-3.5 text-[var(--j-green)] shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--j-text)] truncate">{tpl.name}</span>
                    <span className="jarvis-mono text-[9px] text-[var(--j-cyan)]">by {tpl.owner}</span>
                    <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">{tpl.runs} runs</span>
                  </div>
                  {tpl.description && <div className="text-[10px] text-[var(--j-text-dim)] truncate">{tpl.description}</div>}
                </div>
                <button onClick={() => loadTemplate(tpl)} className="jarvis-mono text-[9px] uppercase px-2 py-1 rounded jarvis-btn-accent border-0 shrink-0">Use</button>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Pipeline builder */}
      <div className="jarvis-panel p-4">
        <SectionTitle title="Pipeline Builder" icon={Workflow} accent={JARVIS.colors.amber} action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setSaveOpen(true)} className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)]">
              <Save className="h-3.5 w-3.5 mr-1" /> Save as Template
            </Button>
            <Button size="sm" variant="outline" onClick={addStep} className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)]">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Step
            </Button>
          </div>
        } />

        {/* Initial input */}
        <div className="mb-4">
          <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1.5 block">
            {pipeline[0] ? `${skillMeta(pipeline[0].skillKey).label} input (${skillMeta(pipeline[0].skillKey).hint})` : 'Initial input'}
          </label>
          <Textarea
            value={initialInput}
            onChange={(e) => setInitialInput(e.target.value)}
            placeholder="Enter the initial input for the first step…"
            className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[60px] resize-none text-sm"
          />
        </div>

        {/* Steps */}
        <div className="space-y-2">
          {pipeline.map((s, i) => {
            const m = skillMeta(s.skillKey);
            const Icon = m.icon;
            const stepResult = results?.[i];
            return (
              <motion.div
                key={i}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-3 p-3 rounded-lg border border-[var(--j-border)] bg-[var(--j-panel-soft)]/40"
              >
                <div className="flex flex-col items-center gap-0.5 shrink-0">
                  <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)]">{i + 1}</span>
                  {stepResult && (
                    stepResult.status === 'success'
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--j-green)]" />
                      : <XCircle className="h-3.5 w-3.5 text-[var(--j-red)]" />
                  )}
                  {running && !stepResult && i === (results?.length ?? 0) && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--j-cyan)]" />}
                </div>

                <div className="flex h-8 w-8 items-center justify-center rounded-md shrink-0" style={{ background: `${m.color}1a`, border: `1px solid ${m.color}33`, color: m.color }}>
                  <Icon className="h-4 w-4" />
                </div>

                <select
                  value={s.skillKey}
                  onChange={(e) => updateStep(i, e.target.value)}
                  className="jarvis-mono text-xs px-2 py-1.5 rounded-md border border-[var(--j-border)] bg-[var(--j-bg)] text-[var(--j-text)] outline-none focus:border-[var(--j-cyan)]"
                >
                  {SKILL_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>

                <span className="text-[10px] text-[var(--j-text-mute)] hidden sm:inline truncate flex-1">
                  {i === 0 ? 'uses initial input' : 'uses previous output'}
                  {stepResult && ` · ${stepResult.latencyMs}ms`}
                </span>

                <div className="flex items-center gap-0.5 ml-auto shrink-0">
                  <button onClick={() => moveStep(i, -1)} disabled={i === 0} className="h-6 w-6 flex items-center justify-center rounded text-[var(--j-text-mute)] hover:text-[var(--j-cyan)] disabled:opacity-30" title="Move up">↑</button>
                  <button onClick={() => moveStep(i, 1)} disabled={i === pipeline.length - 1} className="h-6 w-6 flex items-center justify-center rounded text-[var(--j-text-mute)] hover:text-[var(--j-cyan)] disabled:opacity-30" title="Move down">↓</button>
                  <button onClick={() => removeStep(i)} disabled={pipeline.length <= 1} className="h-6 w-6 flex items-center justify-center rounded text-[var(--j-red)] hover:bg-[var(--j-red)]/10 disabled:opacity-30" title="Remove">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>

        <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--j-border-soft)]">
          <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{pipeline.length} step{pipeline.length !== 1 ? 's' : ''} · output chains to next</span>
          <Button onClick={run} disabled={running || !initialInput.trim()} className="jarvis-btn-accent border-0">
            {running ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Running pipeline…</> : <><Play className="h-3.5 w-3.5 mr-1.5" /> Run Pipeline</>}
          </Button>
        </div>
      </div>

      {/* Results */}
      <AnimatePresence>
        {results && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="jarvis-panel p-4">
            <SectionTitle title="Pipeline Results" icon={FileText} accent={JARVIS.colors.cyan} action={
              <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">total {results.reduce((s, r) => s + r.latencyMs, 0)}ms</span>
            } />
            <div className="space-y-3">
              {results.map((r, i) => {
                const m = skillMeta(r.skillKey);
                const Icon = m.icon;
                return (
                  <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="rounded-lg border border-[var(--j-border)] bg-[var(--j-panel-soft)]/40 overflow-hidden">
                    <div className="flex items-center gap-3 px-3 py-2 border-b border-[var(--j-border-soft)]">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md" style={{ background: `${m.color}1a`, border: `1px solid ${m.color}33`, color: m.color }}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <span className="jarvis-mono text-xs text-[var(--j-text)]">Step {r.step}: {r.label ?? m.label}</span>
                      <Pill color={r.status === 'success' ? JARVIS.colors.green : JARVIS.colors.red}>{r.status}</Pill>
                      <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] ml-auto">{r.latencyMs}ms</span>
                    </div>
                    <div className="px-3 py-3">
                      {r.status === 'error' ? (
                        <div className="text-sm text-[var(--j-red)]">{(r.output as { error?: string })?.error ?? 'failed'}</div>
                      ) : r.skillKey === 'web-search' ? (
                        <div className="space-y-1">
                          <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1">{Array.isArray(r.output) ? `${r.output.length} results` : 'results'}</div>
                          {Array.isArray(r.output) && r.output.slice(0, 4).map((res: { name?: string; url?: string; snippet?: string; host_name?: string }, j: number) => (
                            <div key={j} className="text-xs">
                              <a href={res.url} target="_blank" rel="noopener noreferrer" className="text-[var(--j-cyan)] hover:underline">{res.name}</a>
                              <span className="text-[var(--j-text-mute)] ml-1.5 jarvis-mono text-[9px]">{res.host_name}</span>
                              <div className="text-[var(--j-text-dim)] text-[11px]">{res.snippet}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="prose-chat text-sm max-h-48 overflow-y-auto jarvis-scroll">
                          <ReactMarkdown>{r.outputSummary}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {saveOpen && (
          <SaveTemplateModal
            pipeline={pipeline}
            initialInput={initialInput}
            onClose={() => setSaveOpen(false)}
            onSaved={() => { setSaveOpen(false); refreshTpls(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function SaveTemplateModal({ pipeline, initialInput, onClose, onSaved }: { pipeline: StepDef[]; initialInput: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast({ title: 'Name required', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      const steps = pipeline.map((s, i) => i === 0 && initialInput.trim() ? { ...s, input: initialInput } : s);
      await postJson('/api/pipelines', { name: name.trim(), description: description.trim(), steps });
      toast({ title: 'Template saved' });
      onSaved();
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} className="relative w-full max-w-md jarvis-panel p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="jarvis-mono text-sm uppercase text-[var(--j-green)]">Save as Template</h3>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Template Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Competitor Analysis"
              className="w-full bg-[var(--j-panel-soft)] border border-[var(--j-border)] rounded-md px-3 py-2 text-sm text-[var(--j-text)] placeholder:text-[var(--j-text-mute)] outline-none focus:border-[var(--j-green)]"
            />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Description (optional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this pipeline do?"
              className="w-full bg-[var(--j-panel-soft)] border border-[var(--j-border)] rounded-md px-3 py-2 text-sm text-[var(--j-text)] placeholder:text-[var(--j-text-mute)] outline-none focus:border-[var(--j-green)]"
            />
          </div>
          <div className="p-3 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]/40">
            <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1.5">{pipeline.length} steps</div>
            <div className="flex items-center gap-1 flex-wrap">
              {pipeline.map((s, i) => (
                <span key={i} className="flex items-center gap-0.5">
                  <span className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-[var(--j-bg)] text-[var(--j-text-dim)] border border-[var(--j-border-soft)]">{s.label}</span>
                  {i < pipeline.length - 1 && <ChevronRight className="h-2.5 w-2.5 text-[var(--j-text-mute)]" />}
                </span>
              ))}
            </div>
          </div>
          <Button onClick={submit} disabled={busy} className="w-full jarvis-btn-accent border-0">
            {busy ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Saving…</> : <><Save className="h-3.5 w-3.5 mr-1.5" /> Save Template</>}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
