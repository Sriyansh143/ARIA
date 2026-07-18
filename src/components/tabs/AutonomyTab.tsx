'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot, Play, Loader2, Sparkles, CheckCircle2, XCircle, ArrowRight,
  Search, BookOpen, Brain, ListTodo, Zap, Radio, Clock, Trash2, Repeat, X, Plus, History, RotateCw, GitCompare, Bookmark,
  GitBranch, Layers, Network,
} from 'lucide-react';
import { useApi, postJson, patchJson, deleteJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, Pill, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface TraceStep {
  step: string;
  status: 'success' | 'error' | 'skipped';
  detail: string;
  latencyMs: number;
}

interface CreatedTask {
  id: string;
  title: string;
  assignee: string;
  priority: string;
}

interface AutonomyResult {
  agent: string;
  topic: string;
  trace: TraceStep[];
  createdTasks: CreatedTask[];
  totalLatencyMs: number;
}

/* ─── Parallel Orchestrator types ─── */
interface ParallelPlanStep {
  id: string;
  title: string;
  description: string;
  dependsOn: string[];
  parallelizable?: boolean;
  estimatedIterations?: number;
  tool?: string;
}

interface ParallelPlan {
  goal: string;
  reasoning: string;
  estimatedTotalIterations: number;
  steps: ParallelPlanStep[];
  source: 'task-decomposer' | 'dag-planner';
}

interface ParallelStepOutcome {
  stepId: string;
  title: string;
  success: boolean;
  result: string;
  durationMs: number;
  executedBy: 'local' | string;
  error?: string;
}

interface ParallelResult {
  runId: string;
  plan: ParallelPlan;
  trace: TraceStep[];
  results: ParallelStepOutcome[];
  orchestration: {
    successCount: number;
    failureCount: number;
    totalDurationMs: number;
    parallelBatches: number;
    batches: ParallelPlanStep[][];
    contextSummary: string;
  };
  totalDurationMs: number;
}

const STEP_ICONS: Record<string, typeof Search> = {
  'web-search': Search,
  'web-reader': BookOpen,
  'glm-plan': Brain,
  'create-tasks': ListTodo,
};

const STEP_LABELS: Record<string, string> = {
  'web-search': 'Web Search',
  'web-reader': 'Read Article',
  'glm-plan': 'AI Planning',
  'create-tasks': 'Create Tasks',
};

const QUICK_TOPICS = [
  'AI agent frameworks 2026',
  'Next.js 16 performance optimization',
  'autonomous systems safety research',
  'vector database comparison 2026',
];

export default function AutonomyTab() {
  const { toast } = useToast();
  const { data: agentsData } = useApi<{ agents: Array<{ id: string; codename: string; name: string; role: string; status: string }> }>('/api/agents', 0);
  const { data: schedData, refresh: refreshSched } = useApi<{ schedules: Array<{ id: string; agentCodename: string; topic: string; intervalMin: number; enabled: boolean; lastRun: string | null; runCount: number; lastResult: string | null }> }>('/api/scheduled-autonomy', 15000);
  const [agentId, setAgentId] = useState('');
  const [topic, setTopic] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AutonomyResult | null>(null);
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedRunning, setSchedRunning] = useState<string | null>(null);
  // Parallel Orchestrator mode toggle (persisted to localStorage).
  const [parallelMode, setParallelMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('jarvis-autonomy-parallel') === 'true';
  });
  const [parallelResult, setParallelResult] = useState<ParallelResult | null>(null);

  const toggleParallelMode = () => {
    const next = !parallelMode;
    setParallelMode(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('jarvis-autonomy-parallel', String(next));
    }
    toast({
      title: next ? 'Parallel Orchestrator enabled' : 'Sequential mode',
      description: next
        ? 'Goals will be decomposed → DAG-planned → executed in parallel batches'
        : 'Goals run via the standard sequential autonomy loop',
    });
    // Clear any stale result from the other mode so the UI doesn't get confused.
    setResult(null);
    setParallelResult(null);
  };

  const selectedAgent = agentsData?.agents.find((a) => a.id === agentId);

  const run = async (overrideTopic?: string) => {
    const t = (overrideTopic ?? topic).trim();
    if (!agentId || !t || running) return;
    setTopic(t);
    setRunning(true);
    setResult(null);
    setParallelResult(null);
    try {
      const agent = agentsData?.agents.find((a) => a.id === agentId);
      if (parallelMode) {
        // Parallel Orchestrator path: POST goal → decompose → DAG plan → parallel exec.
        const res = await postJson<ParallelResult>('/api/orchestrate/parallel', {
          goal: t,
          agentCodename: agent?.codename,
          maxParallel: 4,
        });
        setParallelResult(res);
        toast({
          title: 'Parallel orchestration complete',
          description: `${res.orchestration.successCount}/${res.results.length} steps succeeded in ${res.orchestration.parallelBatches} batches`,
        });
      } else {
        // Sequential autonomy loop (existing behavior).
        const res = await postJson<AutonomyResult>('/api/agent/autonomy', { agentCodename: agent?.codename, topic: t });
        setResult(res);
        if (res.createdTasks.length > 0) {
          toast({ title: 'Autonomy complete', description: `${res.agent} created ${res.createdTasks.length} tasks` });
        } else {
          toast({ title: 'Autonomy complete', description: 'No tasks were created' });
        }
      }
    } catch (e) {
      toast({ title: parallelMode ? 'Parallel orchestration failed' : 'Autonomy failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  const runScheduled = async (id: string) => {
    setSchedRunning(id);
    try {
      await postJson(`/api/scheduled-autonomy/${id}`, {});
      toast({ title: 'Scheduled loop executed' });
      refreshSched();
    } catch (e) {
      toast({ title: 'Run failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setSchedRunning(null);
    }
  };
  const toggleSched = async (id: string, enabled: boolean) => {
    await patchJson(`/api/scheduled-autonomy/${id}`, { enabled: !enabled });
    refreshSched();
  };
  const deleteSched = async (id: string) => {
    await deleteJson(`/api/scheduled-autonomy/${id}`);
    toast({ title: 'Schedule removed' });
    refreshSched();
  };

  return (
    <div className="space-y-4">
      <SectionTitle title="Agent Autonomy" icon={Bot} accent={JARVIS.colors.cyan} action={<Pill color={JARVIS.colors.violet}>AI · auto-research</Pill>} />

      {/* Hero explainer */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="jarvis-panel jarvis-scan p-4 flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg jarvis-btn-accent shrink-0">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="jarvis-mono text-[10px] uppercase text-[var(--j-cyan)] tracking-widest">Autonomous Research Loop</div>
          <p className="text-sm text-[var(--j-text-dim)] mt-0.5">An agent autonomously searches the web, reads the top result, has the AI engine propose actionable tasks, and auto-assigns them to the best-suited agents.</p>
        </div>
      </motion.div>

      {/* Config */}
      <div className="jarvis-panel p-4">
        <SectionTitle title="Configure Loop" icon={Zap} accent={JARVIS.colors.amber} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div className="md:col-span-1">
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1.5 block">Agent</label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue placeholder="Select agent…" /></SelectTrigger>
              <SelectContent>
                {agentsData?.agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="jarvis-mono">{a.codename}</span> · {a.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedAgent && (
              <div className="mt-2 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: JARVIS.colors[selectedAgent.status as keyof typeof JARVIS.colors] ?? JARVIS.colors.textDim }} />
                <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{selectedAgent.status} · {selectedAgent.name}</span>
              </div>
            )}
          </div>
          <div className="md:col-span-2">
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1.5 block">Research Topic</label>
            <Textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. latest advances in autonomous agent orchestration"
              className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[44px] resize-none text-sm"
            />
          </div>
        </div>

        {/* Quick topics */}
        <div className="flex flex-wrap gap-2 mb-3">
          {QUICK_TOPICS.map((q) => (
            <button
              key={q}
              onClick={() => setTopic(q)}
              className="text-xs px-2.5 py-1 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] hover:border-[var(--j-cyan)] hover:text-[var(--j-cyan)] transition-colors"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Parallel Orchestrator mode toggle */}
        <div className="flex items-center gap-3 mb-3 p-3 rounded-lg border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]/40">
          <div className="flex h-8 w-8 items-center justify-center rounded-md shrink-0" style={{ background: `${JARVIS.colors.cyan}1a`, border: `1px solid ${JARVIS.colors.cyan}33`, color: JARVIS.colors.cyan }}>
            <Network className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-[var(--j-text)]">Parallel Orchestrator</span>
              <span className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded" style={{ color: parallelMode ? JARVIS.colors.green : JARVIS.colors.textMute, background: parallelMode ? `${JARVIS.colors.green}1a` : 'var(--j-panel-soft)' }}>
                {parallelMode ? 'ENABLED' : 'OFF'}
              </span>
              {parallelMode && <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] flex items-center gap-1"><GitBranch className="h-2.5 w-2.5" />DAG · <Layers className="h-2.5 w-2.5" />batches · <Zap className="h-2.5 w-2.5" />parallel</span>}
            </div>
            <div className="text-[11px] text-[var(--j-text-dim)] mt-0.5">
              {parallelMode
                ? 'Goals decompose into a DAG and execute in parallel batches with shared blackboard context (state-bus).'
                : 'Sequential autonomy loop: web-search → read → AI plan → create tasks.'}
            </div>
          </div>
          <button
            onClick={toggleParallelMode}
            className={`relative h-6 w-11 rounded-full transition-colors shrink-0 ${parallelMode ? 'bg-[var(--j-cyan)]' : 'bg-[var(--j-border)]'}`}
            role="switch"
            aria-checked={parallelMode}
            aria-label="Toggle parallel orchestrator mode"
            title={parallelMode ? 'Disable parallel orchestrator' : 'Enable parallel orchestrator'}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${parallelMode ? 'translate-x-5' : 'translate-x-0.5'}`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-[var(--j-border-soft)]">
          <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
            {agentId && topic ? (parallelMode ? 'parallel ready' : 'ready') : 'select agent + topic'}
          </span>
          <Button onClick={() => run()} disabled={running || !agentId || !topic.trim()} className="jarvis-btn-accent border-0">
            {running ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Running…</> : <>{parallelMode ? <Network className="h-3.5 w-3.5 mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />} {parallelMode ? 'Run Parallel Orchestration' : 'Run Autonomy Loop'}</>}
          </Button>
        </div>
      </div>

      {/* Result */}
      <AnimatePresence>
        {running && !result && !parallelResult && (
          <motion.div key="running" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="jarvis-panel p-6">
            <div className="flex flex-col items-center justify-center py-8">
              <div className="relative mb-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl jarvis-btn-accent">
                  {parallelMode ? <Network className="h-7 w-7" /> : <Bot className="h-7 w-7" />}
                </div>
                <Loader2 className="absolute -bottom-1 -right-1 h-5 w-5 animate-spin text-[var(--j-cyan)]" />
              </div>
              <div className="jarvis-mono text-[11px] uppercase text-[var(--j-cyan)] tracking-widest">
                {parallelMode ? `${selectedAgent?.codename} is orchestrating…` : `${selectedAgent?.codename} is researching…`}
              </div>
              <div className="jarvis-mono text-[10px] text-[var(--j-text-mute)] mt-1">
                {parallelMode ? 'decomposing · DAG-planning · executing batches' : 'searching · reading · planning · creating tasks'}
              </div>
            </div>
          </motion.div>
        )}
        {result && (
          <motion.div key="result" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Agent" value={result.agent} icon={Bot} accent={JARVIS.colors.cyan} />
              <StatCard label="Steps" value={result.trace.filter((t) => t.status === 'success').length + '/' + result.trace.length} icon={CheckCircle2} accent={JARVIS.colors.green} />
              <StatCard label="Tasks Created" value={result.createdTasks.length} icon={ListTodo} accent={JARVIS.colors.amber} />
              <StatCard label="Total Time" value={`${(result.totalLatencyMs / 1000).toFixed(1)}s`} icon={Zap} accent={JARVIS.colors.violet} />
            </div>

            {/* Trace */}
            <div className="jarvis-panel p-4">
              <SectionTitle title="Execution Trace" icon={Radio} accent={JARVIS.colors.cyan} action={<span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{result.topic}</span>} />
              <div className="relative">
                <div className="absolute left-[19px] top-2 bottom-2 w-px bg-gradient-to-b from-[var(--j-cyan)]/40 via-[var(--j-border)] to-transparent" />
                <div className="space-y-1">
                  {result.trace.map((s, i) => {
                    const Icon = STEP_ICONS[s.step] ?? Zap;
                    const color = s.status === 'success' ? JARVIS.colors.green : s.status === 'error' ? JARVIS.colors.red : JARVIS.colors.textMute;
                    return (
                      <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }} className="relative flex items-start gap-3 pl-1 py-1.5">
                        <div className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full shrink-0" style={{ background: `${color}1a`, border: `1px solid ${color}44`, color }}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0 pt-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text)]">{STEP_LABELS[s.step] ?? s.step}</span>
                            {s.status === 'success' ? <CheckCircle2 className="h-3 w-3 text-[var(--j-green)]" /> : s.status === 'error' ? <XCircle className="h-3 w-3 text-[var(--j-red)]" /> : null}
                            <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] ml-auto">{s.latencyMs}ms</span>
                          </div>
                          <div className="text-[11px] text-[var(--j-text-dim)] mt-0.5">{s.detail}</div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Created tasks */}
            {result.createdTasks.length > 0 && (
              <div className="jarvis-panel p-4">
                <SectionTitle title="Auto-Created Tasks" icon={ListTodo} accent={JARVIS.colors.amber} action={<Pill color={JARVIS.colors.green}>{result.createdTasks.length} new</Pill>} />
                <div className="space-y-2">
                  {result.createdTasks.map((t, i) => (
                    <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="flex items-center gap-3 p-3 rounded-lg border border-[var(--j-border)] bg-[var(--j-panel-soft)]/40">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md shrink-0" style={{ background: `${JARVIS.colors.amber}1a`, border: `1px solid ${JARVIS.colors.amber}33`, color: JARVIS.colors.amber }}>
                        <ListTodo className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-[var(--j-text)]">{t.title}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <ArrowRight className="h-2.5 w-2.5 text-[var(--j-text-mute)]" />
                          <span className="jarvis-mono text-[10px] text-[var(--j-cyan)]">{t.assignee}</span>
                          <span className="jarvis-mono text-[9px] uppercase px-1 py-0.5 rounded" style={{ color: JARVIS.colors[t.priority as keyof typeof JARVIS.colors] ?? JARVIS.colors.textDim, background: `${JARVIS.colors[t.priority as keyof typeof JARVIS.colors] ?? JARVIS.colors.textDim}1a` }}>{t.priority}</span>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
        {parallelResult && (
          <motion.div key="parallel-result" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
            <ParallelResultView result={parallelResult} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scheduled autonomy loops */}
      <div className="jarvis-panel p-4">
        <SectionTitle
          title="Scheduled Loops"
          icon={Repeat}
          accent={JARVIS.colors.violet}
          action={
            <Button size="sm" variant="outline" className="jarvis-btn-accent border-0" onClick={() => setSchedOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Schedule
            </Button>
          }
        />
        <div className="space-y-2">
          {schedData?.schedules && schedData.schedules.length > 0 ? (
            schedData.schedules.map((s, i) => (
              <motion.div key={s.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className={`flex items-center gap-3 p-3 rounded-lg border border-[var(--j-border)] bg-[var(--j-panel-soft)]/40 ${s.enabled ? '' : 'opacity-60'}`}>
                <div className="flex h-8 w-8 items-center justify-center rounded-md shrink-0" style={{ background: `${JARVIS.colors.violet}1a`, border: `1px solid ${JARVIS.colors.violet}33`, color: JARVIS.colors.violet }}>
                  <Repeat className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="jarvis-mono text-xs text-[var(--j-cyan)]">{s.agentCodename}</span>
                    <span className="text-xs text-[var(--j-text)] truncate">{s.topic}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{s.intervalMin}min</span>
                    <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">{s.runCount} runs</span>
                    {s.lastRun && <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">last: {new Date(s.lastRun).toLocaleTimeString('en-US', { hour12: false })}</span>}
                    {s.lastResult && <span className="jarvis-mono text-[9px] truncate" style={{ color: s.lastResult.startsWith('error') ? JARVIS.colors.red : JARVIS.colors.green }}>{s.lastResult.slice(0, 60)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => runScheduled(s.id)} disabled={schedRunning === s.id || !s.enabled} className="jarvis-mono text-[9px] uppercase px-2 py-1 rounded jarvis-btn-accent border-0 disabled:opacity-40 flex items-center gap-1">
                    {schedRunning === s.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Play className="h-2.5 w-2.5" />} run
                  </button>
                  <button onClick={() => toggleSched(s.id, s.enabled)} className={`h-7 w-7 flex items-center justify-center rounded ${s.enabled ? 'text-[var(--j-green)]' : 'text-[var(--j-text-mute)]'}`} title={s.enabled ? 'Disable' : 'Enable'}>
                    <span className="h-2 w-2 rounded-full" style={{ background: s.enabled ? JARVIS.colors.green : JARVIS.colors.textMute }} />
                  </button>
                  <button onClick={() => deleteSched(s.id)} className="h-7 w-7 flex items-center justify-center rounded text-[var(--j-text-mute)] hover:text-[var(--j-red)]" title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            ))
          ) : (
            <div className="text-center py-6">
              <Repeat className="h-8 w-8 mx-auto mb-2 text-[var(--j-text-mute)] opacity-40" />
              <div className="text-xs text-[var(--j-text-mute)]">No scheduled loops</div>
              <div className="jarvis-mono text-[10px] text-[var(--j-text-mute)] mt-1">click "Schedule" to create a recurring research loop</div>
            </div>
          )}
        </div>
      </div>

      {/* Autonomy run history */}
      <AutonomyHistory agentCodename={selectedAgent?.codename} />

      {/* Autonomy templates */}
      <AutonomyTemplates agents={agentsData?.agents ?? []} selectedAgent={selectedAgent?.codename} onUseTemplate={(codename, topic) => { setAgentId(agentsData?.agents.find((a) => a.codename === codename)?.id ?? ''); setTopic(topic); }} />

      <AnimatePresence>
        {schedOpen && <ScheduleModal agents={agentsData?.agents ?? []} defaultAgent={selectedAgent?.codename} defaultTopic={topic} onClose={() => setSchedOpen(false)} onCreated={() => { setSchedOpen(false); refreshSched(); }} />}
      </AnimatePresence>
    </div>
  );
}

/* ---------- Autonomy run history ---------- */
interface HistoryRun {
  id: string;
  agentCodename: string;
  topic: string;
  source: string;
  status: string;
  trace: Array<{ step: string; status: string; detail: string; latencyMs: number }>;
  tasksCreated: number;
  taskTitles: string[];
  latencyMs: number;
  createdAt: string;
}

function AutonomyHistory({ agentCodename }: { agentCodename?: string }) {
  const { data, loading, refresh } = useApi<{ runs: HistoryRun[] }>('/api/agent/history?limit=15', 15000);
  const { toast } = useToast();
  const runs = (data?.runs ?? []).filter((r) => !agentCodename || r.agentCodename === agentCodename);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const rerun = async (r: HistoryRun) => {
    try {
      await postJson('/api/agent/autonomy', { agentCodename: r.agentCodename, topic: r.topic });
      toast({ title: 'Re-run started', description: `${r.agentCodename} → "${r.topic}"` });
      refresh();
    } catch (e) {
      toast({ title: 'Re-run failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  };
  const clearHistory = async () => {
    await fetch('/api/agent/history', { method: 'DELETE' });
    toast({ title: 'History cleared' });
    refresh();
  };
  const toggleCompareSelect = (id: string) => {
    setSelectedForCompare((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  return (
    <div className="jarvis-panel p-4">
      <SectionTitle title="Run History" icon={History} accent={JARVIS.colors.amber} action={
        <div className="flex items-center gap-2">
          {selectedForCompare.length === 2 && (
            <button onClick={() => setCompareOpen(true)} className="jarvis-mono text-[9px] uppercase px-2 py-1 rounded jarvis-btn-accent border-0 flex items-center gap-1">
              <GitCompare className="h-3 w-3" /> Compare
            </button>
          )}
          {data && data.runs.length > 0 && (
            <button onClick={clearHistory} className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] hover:text-[var(--j-red)]">clear all</button>
          )}
        </div>
      } />
      {loading && !data ? (
        <div className="h-20 flex items-center justify-center jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] animate-pulse">loading history…</div>
      ) : runs.length > 0 ? (
        <div className="space-y-1.5 max-h-80 overflow-y-auto jarvis-scroll">
          {runs.map((r, i) => {
            const isOpen = expanded === r.id;
            const color = r.status === 'success' ? JARVIS.colors.green : JARVIS.colors.red;
            return (
              <motion.div key={r.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.02, 0.3) }} className={`rounded-md border bg-[var(--j-panel-soft)]/40 overflow-hidden ${selectedForCompare.includes(r.id) ? 'border-[var(--j-cyan)]' : 'border-[var(--j-border-soft)]'}`}>
                <div className="flex items-center">
                  <button onClick={(e) => { e.stopPropagation(); toggleCompareSelect(r.id); }} className="flex h-5 w-5 items-center justify-center m-2.5 mr-0 shrink-0 rounded border transition-colors" style={{ borderColor: selectedForCompare.includes(r.id) ? JARVIS.colors.cyan : 'var(--j-border)', background: selectedForCompare.includes(r.id) ? JARVIS.colors.cyan : 'transparent', color: selectedForCompare.includes(r.id) ? '#05070A' : 'transparent' }} title="Select for compare">
                    <CheckCircle2 className="h-3 w-3" />
                  </button>
                  <button onClick={() => setExpanded(isOpen ? null : r.id)} className="flex-1 flex items-center gap-3 p-2.5 pl-2 text-left hover:bg-[var(--j-panel-soft)]/60">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                    <span className="jarvis-mono text-[10px] text-[var(--j-cyan)] shrink-0">{r.agentCodename}</span>
                    <span className="text-xs text-[var(--j-text)] truncate flex-1">{r.topic}</span>
                    <span className="jarvis-mono text-[9px] uppercase px-1 py-0.5 rounded" style={{ color: r.source === 'scheduled' ? JARVIS.colors.violet : JARVIS.colors.textDim, background: r.source === 'scheduled' ? `${JARVIS.colors.violet}1a` : 'var(--j-panel-soft)' }}>{r.source}</span>
                    <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] shrink-0">{r.tasksCreated} tasks</span>
                    <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] shrink-0">{(r.latencyMs / 1000).toFixed(1)}s</span>
                  </button>
                </div>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-[var(--j-border-soft)] px-3 py-2.5">
                      {/* Trace */}
                      <div className="space-y-1 mb-2">
                        {r.trace.map((t, j) => (
                          <div key={j} className="flex items-center gap-2 text-[11px]">
                            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: t.status === 'success' ? JARVIS.colors.green : t.status === 'error' ? JARVIS.colors.red : JARVIS.colors.textMute }} />
                            <span className="jarvis-mono text-[var(--j-text-dim)] w-28 shrink-0">{t.step}</span>
                            <span className="text-[var(--j-text-mute)] truncate flex-1">{t.detail}</span>
                            <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] shrink-0">{t.latencyMs}ms</span>
                          </div>
                        ))}
                      </div>
                      {/* Created tasks */}
                      {r.taskTitles.length > 0 && (
                        <div className="mb-2">
                          <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1">created tasks</div>
                          <div className="flex flex-wrap gap-1">
                            {r.taskTitles.map((t, j) => <span key={j} className="jarvis-mono text-[9px] px-1.5 py-0.5 rounded bg-[var(--j-panel-soft)] text-[var(--j-amber)] border border-[var(--j-border-soft)]">{t.slice(0, 50)}</span>)}
                          </div>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">{new Date(r.createdAt).toLocaleString()}</span>
                        <button onClick={() => rerun(r)} className="jarvis-mono text-[9px] uppercase px-2 py-1 rounded jarvis-btn-accent border-0 flex items-center gap-1">
                          <RotateCw className="h-2.5 w-2.5" /> re-run
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-6">
          <History className="h-8 w-8 mx-auto mb-2 text-[var(--j-text-mute)] opacity-40" />
          <div className="text-xs text-[var(--j-text-mute)]">No autonomy runs yet</div>
          <div className="jarvis-mono text-[10px] text-[var(--j-text-mute)] mt-1">run an autonomy loop to build history</div>
        </div>
      )}
      <AnimatePresence>
        {compareOpen && selectedForCompare.length === 2 && (
          <CompareModal aId={selectedForCompare[0]} bId={selectedForCompare[1]} onClose={() => { setCompareOpen(false); setSelectedForCompare([]); }} />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------- Compare modal ---------- */
function CompareModal({ aId, bId, onClose }: { aId: string; bId: string; onClose: () => void }) {
  const { data, loading } = useApi<{ comparison: { a: { agent: string; topic: string; status: string; tasksCreated: number; latencyMs: number; createdAt: string; taskTitles: string[] }; b: { agent: string; topic: string; status: string; tasksCreated: number; latencyMs: number; createdAt: string; taskTitles: string[] }; deltas: { latencyMs: number; tasksCreated: number; faster: boolean }; stepDiff: Array<{ step: string; aStatus: string; bStatus: string; aLatency: number; bLatency: number; latencyDelta: number; aDetail: string; bDetail: string }> } }>(`/api/agent/compare?a=${aId}&b=${bId}`, 0);

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} className="relative w-full max-w-3xl jarvis-panel p-0 overflow-hidden max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--j-border)]">
          <div className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-[var(--j-cyan)]" />
            <h3 className="jarvis-mono text-sm uppercase text-[var(--j-cyan)]">Run Comparison</h3>
          </div>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto jarvis-scroll p-5">
          {loading || !data ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin mb-3 text-[var(--j-cyan)]" />
              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">comparing runs…</div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Side-by-side summary */}
              <div className="grid grid-cols-2 gap-3">
                {(['a', 'b'] as const).map((side) => {
                  const r = data.comparison[side];
                  const color = r.status === 'success' ? JARVIS.colors.green : JARVIS.colors.red;
                  return (
                    <div key={side} className="p-3 rounded-lg border border-[var(--j-border)] bg-[var(--j-panel-soft)]/40">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="jarvis-mono text-[10px] uppercase" style={{ color: side === 'a' ? JARVIS.colors.amber : JARVIS.colors.cyan }}>Run {side.toUpperCase()}</span>
                        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                      </div>
                      <div className="jarvis-mono text-sm text-[var(--j-cyan)]">{r.agent}</div>
                      <div className="text-xs text-[var(--j-text)] truncate mb-2">{r.topic}</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div><div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">latency</div><div className="jarvis-mono" style={{ color }}>{(r.latencyMs / 1000).toFixed(1)}s</div></div>
                        <div><div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">tasks</div><div className="jarvis-mono" style={{ color }}>{r.tasksCreated}</div></div>
                      </div>
                      <div className="jarvis-mono text-[9px] text-[var(--j-text-mute)] mt-2">{new Date(r.createdAt).toLocaleString()}</div>
                    </div>
                  );
                })}
              </div>

              {/* Deltas */}
              <div className="flex items-center justify-center gap-6 p-3 rounded-lg border border-[var(--j-border-soft)] bg-[var(--j-bg-soft)]">
                <div className="text-center">
                  <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">latency delta</div>
                  <div className="text-lg font-semibold" style={{ color: data.comparison.deltas.faster ? JARVIS.colors.green : JARVIS.colors.red }}>
                    {data.comparison.deltas.latencyMs > 0 ? '+' : ''}{(data.comparison.deltas.latencyMs / 1000).toFixed(1)}s
                  </div>
                  <div className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">{data.comparison.deltas.faster ? 'B faster' : 'B slower'}</div>
                </div>
                <div className="text-center">
                  <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">task delta</div>
                  <div className="text-lg font-semibold" style={{ color: data.comparison.deltas.tasksCreated > 0 ? JARVIS.colors.green : data.comparison.deltas.tasksCreated < 0 ? JARVIS.colors.red : JARVIS.colors.textDim }}>
                    {data.comparison.deltas.tasksCreated > 0 ? '+' : ''}{data.comparison.deltas.tasksCreated}
                  </div>
                  <div className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">B vs A</div>
                </div>
              </div>

              {/* Step diff */}
              <div>
                <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-2">Step-by-step diff</div>
                <div className="space-y-1">
                  {data.comparison.stepDiff.map((s, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center py-1.5 px-2 rounded border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]/30 text-xs">
                      <span className="col-span-3 jarvis-mono text-[var(--j-cyan)]">{s.step}</span>
                      <span className="col-span-2 jarvis-mono" style={{ color: s.aStatus === 'success' ? JARVIS.colors.green : s.aStatus === 'error' ? JARVIS.colors.red : JARVIS.colors.textMute }}>{s.aStatus}</span>
                      <span className="col-span-2 jarvis-mono" style={{ color: s.bStatus === 'success' ? JARVIS.colors.green : s.bStatus === 'error' ? JARVIS.colors.red : JARVIS.colors.textMute }}>{s.bStatus}</span>
                      <span className="col-span-2 jarvis-mono text-[var(--j-text-mute)] text-right">{s.aLatency}ms</span>
                      <span className="col-span-2 jarvis-mono text-[var(--j-text-mute)] text-right">{s.bLatency}ms</span>
                      <span className="col-span-1 jarvis-mono text-right" style={{ color: s.latencyDelta < 0 ? JARVIS.colors.green : s.latencyDelta > 0 ? JARVIS.colors.red : JARVIS.colors.textMute }}>{s.latencyDelta > 0 ? '+' : ''}{s.latencyDelta}ms</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function ScheduleModal({ agents, defaultAgent, defaultTopic, onClose, onCreated }: {
  agents: Array<{ id: string; codename: string; name: string; role: string }>;
  defaultAgent?: string;
  defaultTopic?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [agentId, setAgentId] = useState(agents.find((a) => a.codename === defaultAgent)?.id ?? '');
  const [topic, setTopic] = useState(defaultTopic ?? '');
  const [intervalMin, setIntervalMin] = useState(60);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent || !topic.trim()) { toast({ title: 'Agent and topic required', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      await postJson('/api/scheduled-autonomy', { agentCodename: agent.codename, topic: topic.trim(), intervalMin });
      toast({ title: 'Schedule created', description: `${agent.codename} → every ${intervalMin}min` });
      onCreated();
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
          <h3 className="jarvis-mono text-sm uppercase text-[var(--j-violet)]">Schedule Autonomy Loop</h3>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Agent</label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue placeholder="Select agent…" /></SelectTrigger>
              <SelectContent>{agents.map((a) => <SelectItem key={a.id} value={a.id}><span className="jarvis-mono">{a.codename}</span> · {a.role}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Research Topic</label>
            <Textarea value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. AI industry news this week" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[60px] resize-none text-sm" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Interval (minutes)</label>
            <div className="flex gap-2">
              {[15, 30, 60, 120, 360].map((m) => (
                <button key={m} onClick={() => setIntervalMin(m)} className={`jarvis-mono text-[10px] uppercase px-2.5 py-1.5 rounded-md border transition-colors ${intervalMin === m ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'}`}>
                  {m < 60 ? `${m}m` : `${m / 60}h`}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={submit} disabled={busy} className="w-full jarvis-btn-accent border-0">
            {busy ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Creating…</> : <><Repeat className="h-3.5 w-3.5 mr-1.5" /> Create Schedule</>}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ---------- Autonomy templates ---------- */
interface Template {
  id: string; name: string; agentCodename: string; topic: string; intervalMin: number; tags: string[]; updatedAt: string;
}

function AutonomyTemplates({ agents, selectedAgent, onUseTemplate }: { agents: Array<{ id: string; codename: string; name: string; role: string }>; selectedAgent?: string; onUseTemplate: (codename: string, topic: string) => void }) {
  const { data, loading, refresh } = useApi<{ templates: Template[] }>('/api/autonomy-templates', 15000);
  const { toast } = useToast();
  const [saveOpen, setSaveOpen] = useState(false);

  const applyTpl = (t: Template) => {
    onUseTemplate(t.agentCodename, t.topic);
    toast({ title: `Loaded "${t.name}"`, description: `${t.agentCodename} → "${t.topic}"` });
  };
  const deleteTpl = async (id: string) => {
    await deleteJson(`/api/autonomy-templates/${id}`);
    toast({ title: 'Template deleted' });
    refresh();
  };

  return (
    <div className="jarvis-panel p-4">
      <SectionTitle title="Autonomy Templates" icon={Bookmark} accent={JARVIS.colors.green} action={
        <Button size="sm" variant="outline" onClick={() => setSaveOpen(true)} className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)]">
          <Plus className="h-3.5 w-3.5 mr-1" /> Save
        </Button>
      } />
      {loading && !data ? (
        <div className="h-16 flex items-center justify-center jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] animate-pulse">loading templates…</div>
      ) : data && data.templates.length > 0 ? (
        <div className="space-y-1.5">
          {data.templates.map((t, i) => (
            <motion.div key={t.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }} className="flex items-center gap-3 p-2.5 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]/40 group">
              <Bookmark className="h-3.5 w-3.5 text-[var(--j-green)] shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-[var(--j-text)] truncate">{t.name}</span>
                  <span className="jarvis-mono text-[9px] text-[var(--j-cyan)]">{t.agentCodename}</span>
                  <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">{t.intervalMin}min</span>
                </div>
                <div className="text-[11px] text-[var(--j-text-dim)] truncate">{t.topic}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => applyTpl(t)} className="jarvis-mono text-[9px] uppercase px-2 py-1 rounded jarvis-btn-accent border-0">Use</button>
                <button onClick={() => deleteTpl(t.id)} className="h-7 w-7 flex items-center justify-center rounded text-[var(--j-text-mute)] hover:text-[var(--j-red)]"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="text-center py-5">
          <Bookmark className="h-8 w-8 mx-auto mb-2 text-[var(--j-text-mute)] opacity-40" />
          <div className="text-xs text-[var(--j-text-mute)]">No templates saved</div>
          <div className="jarvis-mono text-[10px] text-[var(--j-text-mute)] mt-1">save reusable agent+topic configs</div>
        </div>
      )}
      <AnimatePresence>
        {saveOpen && <SaveTemplateModal agents={agents} defaultAgent={selectedAgent} onClose={() => setSaveOpen(false)} onSaved={() => { setSaveOpen(false); refresh(); }} />}
      </AnimatePresence>
    </div>
  );
}

function SaveTemplateModal({ agents, defaultAgent, onClose, onSaved }: { agents: Array<{ id: string; codename: string; name: string; role: string }>; defaultAgent?: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [agentId, setAgentId] = useState(agents.find((a) => a.codename === defaultAgent)?.id ?? '');
  const [topic, setTopic] = useState('');
  const [intervalMin, setIntervalMin] = useState(60);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const agent = agents.find((a) => a.id === agentId);
    if (!name.trim() || !agent || !topic.trim()) { toast({ title: 'Name, agent, topic required', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      await postJson('/api/autonomy-templates', { name: name.trim(), agentCodename: agent.codename, topic: topic.trim(), intervalMin });
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
          <h3 className="jarvis-mono text-sm uppercase text-[var(--j-green)]">Save Autonomy Template</h3>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Template Name</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Morning Industry Scan" className="w-full bg-[var(--j-panel-soft)] border border-[var(--j-border)] rounded-md px-3 py-2 text-sm text-[var(--j-text)] placeholder:text-[var(--j-text-mute)] outline-none focus:border-[var(--j-green)]" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Agent</label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue placeholder="Select agent…" /></SelectTrigger>
              <SelectContent>{agents.map((a) => <SelectItem key={a.id} value={a.id}><span className="jarvis-mono">{a.codename}</span> · {a.role}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Research Topic</label>
            <Textarea value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. AI industry news this week" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[60px] resize-none text-sm" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Default Interval</label>
            <div className="flex gap-2">
              {[15, 30, 60, 120, 360].map((m) => (
                <button key={m} onClick={() => setIntervalMin(m)} className={`jarvis-mono text-[10px] uppercase px-2.5 py-1.5 rounded-md border transition-colors ${intervalMin === m ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'}`}>
                  {m < 60 ? `${m}m` : `${m / 60}h`}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={submit} disabled={busy} className="w-full jarvis-btn-accent border-0">
            {busy ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Saving…</> : <><Bookmark className="h-3.5 w-3.5 mr-1.5" /> Save Template</>}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ---------- Parallel Orchestrator result view (with ASCII DAG viz) ---------- */
function ParallelResultView({ result }: { result: ParallelResult }) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const accentColor = result.orchestration.failureCount === 0 ? JARVIS.colors.green : JARVIS.colors.amber;

  // Build a topological wave representation as the "DAG viz".
  // Each wave is one batch from the orchestration; steps in the same wave
  // are visually grouped as parallel.
  const batches = result.orchestration.batches && result.orchestration.batches.length > 0
    ? result.orchestration.batches
    : result.plan.steps.map((s) => [s]);

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Source" value={result.plan.source === 'dag-planner' ? 'DAG' : 'Decomposer'} icon={GitBranch} accent={JARVIS.colors.cyan} />
        <StatCard label="Steps" value={`${result.orchestration.successCount}/${result.results.length}`} icon={CheckCircle2} accent={accentColor} />
        <StatCard label="Batches" value={result.orchestration.parallelBatches} icon={Layers} accent={JARVIS.colors.violet} />
        <StatCard label="Total Time" value={`${(result.totalDurationMs / 1000).toFixed(1)}s`} icon={Zap} accent={JARVIS.colors.amber} />
      </div>

      {/* DAG visualization (ASCII-style wave representation) */}
      <div className="jarvis-panel p-4">
        <SectionTitle
          title="DAG Plan"
          icon={Network}
          accent={JARVIS.colors.cyan}
          action={
            <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
              {result.plan.steps.length} steps · est. {result.plan.estimatedTotalIterations} iters
            </span>
          }
        />
        <div className="text-[11px] text-[var(--j-text-dim)] mb-3 italic">{result.plan.reasoning}</div>
        <div className="space-y-2">
          {batches.map((batch, waveIdx) => (
            <motion.div
              key={waveIdx}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: waveIdx * 0.08 }}
              className="flex items-start gap-3"
            >
              <div className="flex flex-col items-center shrink-0">
                <span className="jarvis-mono text-[9px] uppercase text-[var(--j-violet)] mb-1">W{waveIdx + 1}</span>
                <span className="h-2 w-2 rounded-full" style={{ background: JARVIS.colors.violet, boxShadow: `0 0 6px ${JARVIS.colors.violet}` }} />
                {waveIdx < batches.length - 1 && <span className="w-px flex-1 mt-1" style={{ background: `${JARVIS.colors.violet}44`, minHeight: 24 }} />}
              </div>
              <div className="flex-1 flex flex-wrap gap-2 pb-2">
                {batch.map((step) => {
                  const outcome = result.results.find((o) => o.stepId === step.id);
                  const ok = outcome?.success;
                  const color = ok === undefined ? JARVIS.colors.textMute : ok ? JARVIS.colors.green : JARVIS.colors.red;
                  return (
                    <div
                      key={step.id}
                      className="flex-1 min-w-[180px] p-2.5 rounded-md border bg-[var(--j-panel-soft)]/40"
                      style={{ borderColor: `${color}44` }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="jarvis-mono text-[10px] uppercase" style={{ color }}>{step.id}</span>
                        {ok && <CheckCircle2 className="h-3 w-3" style={{ color: JARVIS.colors.green }} />}
                        {!ok && ok !== undefined && <XCircle className="h-3 w-3" style={{ color: JARVIS.colors.red }} />}
                        {step.dependsOn.length > 0 && (
                          <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] flex items-center gap-0.5">
                            <GitBranch className="h-2.5 w-2.5" /> {step.dependsOn.join(',')}
                          </span>
                        )}
                        {step.parallelizable && (
                          <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] flex items-center gap-0.5">
                            <Layers className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[var(--j-text)] line-clamp-2">{step.title}</div>
                      {outcome && (
                        <div className="jarvis-mono text-[9px] text-[var(--j-text-mute)] mt-1 flex items-center gap-2">
                          <span>{outcome.executedBy}</span>
                          <span>{outcome.durationMs}ms</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </div>
        {/* ASCII representation */}
        <div className="mt-3 p-3 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-bg-soft)] jarvis-mono text-[10px] text-[var(--j-text-dim)] overflow-x-auto">
          <div className="text-[var(--j-text-mute)] mb-1"># ASCII DAG representation</div>
          {batches.map((batch, waveIdx) => (
            <div key={waveIdx} className="whitespace-nowrap">
              <span className="text-[var(--j-violet)]">[{waveIdx + 1}]</span>{' '}
              {batch.map((s, i) => (
                <span key={s.id}>
                  <span style={{ color: result.results.find((o) => o.stepId === s.id)?.success ? JARVIS.colors.green : JARVIS.colors.red }}>{s.id}</span>
                  {s.dependsOn.length > 0 && <span className="text-[var(--j-text-mute)]">←{s.dependsOn.join(',')}</span>}
                  {i < batch.length - 1 && <span className="text-[var(--j-text-mute)]"> | </span>}
                </span>
              ))}
              {waveIdx < batches.length - 1 && <span className="text-[var(--j-text-mute)]"> →</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Per-step outcomes (expandable) */}
      <div className="jarvis-panel p-4">
        <SectionTitle
          title="Step Outcomes"
          icon={ListTodo}
          accent={JARVIS.colors.amber}
          action={<Pill color={accentColor}>{result.orchestration.successCount} succeeded</Pill>}
        />
        <div className="space-y-1.5 max-h-96 overflow-y-auto jarvis-scroll">
          {result.results.map((o, i) => {
            const isOpen = expandedStep === o.stepId;
            const color = o.success ? JARVIS.colors.green : JARVIS.colors.red;
            return (
              <motion.div key={o.stepId + i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }} className="rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]/40 overflow-hidden">
                <button onClick={() => setExpandedStep(isOpen ? null : o.stepId)} className="w-full flex items-center gap-3 p-2.5 text-left hover:bg-[var(--j-panel-soft)]/60">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                  <span className="jarvis-mono text-[10px] text-[var(--j-cyan)] shrink-0">{o.stepId}</span>
                  <span className="text-xs text-[var(--j-text)] truncate flex-1">{o.title}</span>
                  <span className="jarvis-mono text-[9px] uppercase px-1 py-0.5 rounded" style={{ color, background: `${color}1a` }}>{o.success ? 'OK' : 'FAIL'}</span>
                  <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] shrink-0">{o.executedBy}</span>
                  <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] shrink-0">{o.durationMs}ms</span>
                </button>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-[var(--j-border-soft)] px-3 py-2.5">
                      {o.error && <div className="jarvis-mono text-[10px] text-[var(--j-red)] mb-1">error: {o.error}</div>}
                      <pre className="text-[11px] text-[var(--j-text-dim)] whitespace-pre-wrap break-words max-h-60 overflow-y-auto jarvis-scroll">{o.result}</pre>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Orchestration trace */}
      <div className="jarvis-panel p-4">
        <SectionTitle title="Orchestration Trace" icon={Radio} accent={JARVIS.colors.cyan} action={<span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">run {result.runId.slice(0, 16)}</span>} />
        <div className="space-y-1">
          {result.trace.map((s, i) => {
            const color = s.status === 'success' ? JARVIS.colors.green : s.status === 'error' ? JARVIS.colors.red : JARVIS.colors.textMute;
            return (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
                <span className="jarvis-mono text-[var(--j-text-dim)] w-28 shrink-0">{s.step}</span>
                <span className="text-[var(--j-text-mute)] truncate flex-1">{s.detail}</span>
                <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] shrink-0">{s.latencyMs}ms</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
