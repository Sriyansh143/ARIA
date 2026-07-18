'use client';

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot, Plus, X, RefreshCw, Power, MessageSquare, ListTodo, Copy,
  Activity, Settings, Send, Loader2, ChevronRight, Clock, Cpu,
  Download, Upload, FileJson, Sparkles, Search, Zap, GitCompare, Trophy, Check,
} from 'lucide-react';
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Legend, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { useApi, postJson, patchJson } from '@/lib/hooks/use-api';
import { JARVIS, STATUS_COLORS } from '@/lib/config';
import { SectionTitle, StatusDot, Pill, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTabNav } from '@/lib/nav-store';

interface Agent {
  id: string; name: string; codename: string; role: string; status: string;
  skills: string; model: string; taskCount: number; logCount: number;
  successRate: number; load: number; lastActive: string;
  logs?: Array<{ id: string; level: string; message: string; createdAt: string }>;
}

interface Task {
  id: string; title: string; status: string; priority: string; assigneeId: string | null;
}

const STATUS_CYCLE = ['idle', 'thinking', 'working', 'error', 'offline'] as const;

export default function FleetTab() {
  const { data, loading, refresh } = useApi<{ agents: Agent[] }>('/api/agents', 8000);
  const { toast } = useToast();
  const [selected, setSelected] = useState<Agent | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const cycleStatus = async (a: Agent) => {
    const idx = STATUS_CYCLE.indexOf(a.status as never);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    await patchJson(`/api/agents/${a.id}`, { status: next });
    toast({ title: `${a.codename} → ${next}` });
    refresh();
  };

  const exportAgents = () => {
    window.open('/api/agents/backup', '_blank');
    toast({ title: 'Exporting agent configurations…' });
  };

  const filtered = (data?.agents ?? []).filter((a) => {
    if (statusFilter !== 'all' && a.status !== statusFilter) return false;
    if (q) {
      const ql = q.toLowerCase();
      return a.codename.toLowerCase().includes(ql) || a.name.toLowerCase().includes(ql) || a.role.toLowerCase().includes(ql);
    }
    return true;
  });

  const statusCounts = (data?.agents ?? []).reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Agent Fleet"
        icon={Bot}
        accent={JARVIS.colors.cyan}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={exportAgents} title="Export all agent configs as JSON" className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)]">
              <Download className="h-3.5 w-3.5 mr-1" /> Export
            </Button>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} title="Import agent configs from JSON" className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)]">
              <Upload className="h-3.5 w-3.5 mr-1" /> Import
            </Button>
            <Button size="sm" variant="outline" onClick={() => setTemplatesOpen(true)} title="Spawn from template" className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)]">
              <Sparkles className="h-3.5 w-3.5 mr-1" /> Templates
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCompareOpen(true)} title="Compare agents side-by-side" className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)]">
              <GitCompare className="h-3.5 w-3.5 mr-1" /> Compare
            </Button>
            <Button size="sm" variant="outline" className="jarvis-btn-accent border-0" onClick={() => setSpawnOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Spawn Agent
            </Button>
            <Button size="sm" variant="outline" onClick={refresh} className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)]">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search agents by codename, name, or role…"
          className="bg-[var(--j-panel-soft)] border-[var(--j-border)] max-w-xs h-8 text-xs"
        />
        <div className="flex gap-1 flex-wrap">
          {['all', 'idle', 'thinking', 'working', 'error', 'offline'].map((s) => {
            const count = s === 'all' ? (data?.agents?.length ?? 0) : (statusCounts[s] ?? 0);
            const active = statusFilter === s;
            const color = s === 'all' ? JARVIS.colors.cyan : (STATUS_COLORS[s as keyof typeof STATUS_COLORS] ?? JARVIS.colors.textDim);
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`jarvis-mono text-[9px] uppercase px-2 py-1 rounded border transition-all flex items-center gap-1.5 ${
                  active ? 'bg-[var(--j-panel-soft)] text-[var(--j-text)]' : 'text-[var(--j-text-mute)] hover:text-[var(--j-text)]'
                }`}
                style={active ? { borderColor: color, color } : { borderColor: 'var(--j-border-soft)' }}
              >
                {s}
                <span className="text-[8px] opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
          {filtered.length} / {data?.agents?.length ?? 0} agents
        </div>
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="jarvis-panel h-40 animate-pulse">
            <div className="h-full flex flex-col">
              <div className="h-8 bg-[var(--j-panel-soft)] m-3 rounded" />
              <div className="h-3 bg-[var(--j-panel-soft)] mx-3 rounded w-2/3" />
              <div className="grid grid-cols-3 gap-2 p-3 mt-auto">
                <div className="h-10 bg-[var(--j-panel-soft)] rounded" />
                <div className="h-10 bg-[var(--j-panel-soft)] rounded" />
                <div className="h-10 bg-[var(--j-panel-soft)] rounded" />
              </div>
            </div>
          </div>
        ))}</div>
      ) : filtered.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((a, i) => {
            const skills: string[] = JSON.parse(a.skills || '[]');
            const color = STATUS_COLORS[a.status as keyof typeof STATUS_COLORS] ?? JARVIS.colors.textDim;
            const loadColor = a.load > 80 ? JARVIS.colors.red : a.load > 50 ? JARVIS.colors.amber : JARVIS.colors.green;
            return (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="jarvis-panel jarvis-card-hover p-4 cursor-pointer group relative overflow-hidden"
                onClick={() => openDetail(a, setSelected)}
              >
                {/* Status accent bar */}
                <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />

                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <StatusDot status={a.status as never} size={10} />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="jarvis-mono text-sm font-bold" style={{ color }}>{a.codename}</span>
                      </div>
                      <div className="text-[11px] text-[var(--j-text-mute)]">{a.name}</div>
                    </div>
                  </div>
                  <Pill color={color}>{a.status}</Pill>
                </div>

                <div className="text-xs text-[var(--j-text-dim)] mb-3">{a.role}</div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <MiniStat label="Load" value={`${Math.round(a.load)}%`} color={loadColor} />
                  <MiniStat label="Success" value={`${a.successRate}%`} color={JARVIS.colors.green} />
                  <MiniStat label="Tasks" value={String(a.taskCount)} color={JARVIS.colors.amber} />
                </div>

                {/* Load bar */}
                <div className="h-1 rounded-full bg-[var(--j-border)] overflow-hidden mb-3">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: `linear-gradient(90deg, ${loadColor}, ${loadColor}aa)` }}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, a.load)}%` }}
                    transition={{ duration: 0.6, delay: i * 0.03 }}
                  />
                </div>

                <div className="flex flex-wrap gap-1">
                  {skills.slice(0, 4).map((s) => (
                    <span key={s} className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] border border-[var(--j-border-soft)]">{s}</span>
                  ))}
                  {skills.length > 4 && <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">+{skills.length - 4}</span>}
                </div>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--j-border-soft)]">
                  <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] flex items-center gap-1">
                    <Cpu className="h-3 w-3" /> {a.model}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); cycleStatus(a); }}
                    className="jarvis-mono text-[9px] uppercase text-[var(--j-cyan)] hover:underline flex items-center gap-1"
                  >
                    <Power className="h-3 w-3" /> cycle
                  </button>
                </div>

                {/* Hover hint */}
                <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ChevronRight className="h-3 w-3 text-[var(--j-cyan)]" />
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Bot} message="No agents match your filters" />
      )}

      {/* Detail modal */}
      <AnimatePresence>
        {selected && (
          <DetailModal agent={selected} onClose={() => setSelected(null)} onCycle={cycleStatus} onUpdated={() => refresh()} />
        )}
      </AnimatePresence>

      {/* Spawn modal */}
      <AnimatePresence>
        {spawnOpen && <SpawnModal onClose={() => setSpawnOpen(false)} onDone={() => { setSpawnOpen(false); refresh(); }} />}
      </AnimatePresence>

      {/* Import modal */}
      <AnimatePresence>
        {importOpen && <ImportModal onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); refresh(); }} />}
      </AnimatePresence>

      {/* Templates modal */}
      <AnimatePresence>
        {templatesOpen && <TemplatesModal onClose={() => setTemplatesOpen(false)} onDone={() => { setTemplatesOpen(false); refresh(); }} />}
      </AnimatePresence>

      {/* Compare modal */}
      <AnimatePresence>
        {compareOpen && <CompareModal agents={data?.agents ?? []} onClose={() => setCompareOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}

async function openDetail(a: Agent, set: (a: Agent | null) => void) {
  try {
    const res = await fetch(`/api/agents/${a.id}`, { cache: 'no-store' });
    const json = await res.json();
    set(json.agent);
  } catch {
    set(a);
  }
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center py-1.5 rounded bg-[var(--j-panel-soft)]/50 border border-[var(--j-border-soft)]">
      <div className="text-sm font-semibold" style={{ color }}>{value}</div>
      <div className="jarvis-mono text-[8px] uppercase text-[var(--j-text-mute)]">{label}</div>
    </div>
  );
}

type DetailTab = 'overview' | 'logs' | 'actions';

function DetailModal({ agent, onClose, onCycle, onUpdated }: { agent: Agent; onClose: () => void; onCycle: (a: Agent) => void; onUpdated: () => void }) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const skills: string[] = JSON.parse(agent.skills || '[]');
  const color = STATUS_COLORS[agent.status as keyof typeof STATUS_COLORS] ?? JARVIS.colors.textDim;

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 10 }}
        className="relative w-full max-w-2xl jarvis-panel p-0 overflow-hidden max-h-[88vh] flex flex-col"
      >
        {/* Header with gradient accent */}
        <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${color}, ${color}40, transparent)` }} />

        <div className="flex items-center justify-between p-4 border-b border-[var(--j-border)]">
          <div className="flex items-center gap-3">
            <div className="relative">
              <StatusDot status={agent.status as never} size={12} />
              <div className="absolute inset-0 rounded-full animate-ping opacity-30" style={{ background: color }} />
            </div>
            <div>
              <div className="jarvis-mono text-lg font-bold" style={{ color }}>{agent.codename}</div>
              <div className="text-xs text-[var(--j-text-dim)]">{agent.role} · {agent.name}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)] transition-colors"><X className="h-4 w-4" /></button>
        </div>

        {/* Tab strip */}
        <div className="flex border-b border-[var(--j-border)] bg-[var(--j-panel-soft)]/30">
          {([
            { key: 'overview' as const, label: 'Overview', icon: Activity },
            { key: 'logs' as const, label: `Logs (${agent.logCount})`, icon: ListTodo },
            { key: 'actions' as const, label: 'Actions', icon: Settings },
          ]).map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs jarvis-mono uppercase transition-all relative ${
                  active ? 'text-[var(--j-cyan)]' : 'text-[var(--j-text-mute)] hover:text-[var(--j-text-dim)]'
                }`}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
                {active && (
                  <motion.div
                    layoutId="detail-tab-indicator"
                    className="absolute bottom-0 left-0 right-0 h-[2px]"
                    style={{ background: JARVIS.colors.cyan }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="p-4 overflow-y-auto jarvis-scroll flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15 }}
            >
              {tab === 'overview' && <OverviewPane agent={agent} skills={skills} color={color} />}
              {tab === 'logs' && <LogsPane agent={agent} />}
              {tab === 'actions' && (
                <ActionsPane agent={agent} onCycle={onCycle} onUpdated={onUpdated} onClose={onClose} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}

function OverviewPane({ agent, skills, color }: { agent: Agent; skills: string[]; color: string }) {
  const loadColor = agent.load > 80 ? JARVIS.colors.red : agent.load > 50 ? JARVIS.colors.amber : JARVIS.colors.green;
  return (
    <div className="space-y-4">
      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-2">
        <MiniStat label="Load" value={`${Math.round(agent.load)}%`} color={loadColor} />
        <MiniStat label="Success" value={`${agent.successRate}%`} color={JARVIS.colors.green} />
        <MiniStat label="Tasks" value={String(agent.taskCount)} color={JARVIS.colors.amber} />
        <MiniStat label="Logs" value={String(agent.logCount)} color={JARVIS.colors.violet} />
      </div>

      {/* Load + success bars */}
      <div className="space-y-2">
        <div>
          <div className="flex justify-between text-[10px] jarvis-mono uppercase text-[var(--j-text-mute)] mb-1">
            <span>Load</span><span style={{ color: loadColor }}>{Math.round(agent.load)}%</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--j-border)] overflow-hidden">
            <motion.div className="h-full rounded-full" style={{ background: loadColor }} initial={{ width: 0 }} animate={{ width: `${agent.load}%` }} transition={{ duration: 0.5 }} />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-[10px] jarvis-mono uppercase text-[var(--j-text-mute)] mb-1">
            <span>Success Rate</span><span style={{ color: JARVIS.colors.green }}>{agent.successRate}%</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--j-border)] overflow-hidden">
            <motion.div className="h-full rounded-full" style={{ background: JARVIS.colors.green }} initial={{ width: 0 }} animate={{ width: `${agent.successRate}%` }} transition={{ duration: 0.5 }} />
          </div>
        </div>
      </div>

      {/* Status + model */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded bg-[var(--j-panel-soft)]/50 border border-[var(--j-border-soft)]">
          <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1">Status</div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
            <span className="text-sm font-semibold" style={{ color }}>{agent.status}</span>
          </div>
        </div>
        <div className="p-3 rounded bg-[var(--j-panel-soft)]/50 border border-[var(--j-border-soft)]">
          <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1">Model</div>
          <div className="text-sm font-semibold text-[var(--j-text)] flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-[var(--j-cyan)]" /> {agent.model}
          </div>
        </div>
      </div>

      {/* Last active */}
      <div className="flex items-center gap-2 text-xs text-[var(--j-text-mute)]">
        <Clock className="h-3 w-3" />
        <span>Last active: {new Date(agent.lastActive).toLocaleString()}</span>
      </div>

      {/* Skills */}
      <div>
        <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1.5">Skills ({skills.length})</div>
        <div className="flex flex-wrap gap-1.5">
          {skills.length ? skills.map((s) => (
            <span key={s} className="jarvis-mono text-[10px] uppercase px-2 py-1 rounded bg-[var(--j-panel-soft)] text-[var(--j-cyan)] border border-[var(--j-border)]">{s}</span>
          )) : <span className="text-xs text-[var(--j-text-mute)]">No skills assigned</span>}
        </div>
      </div>
    </div>
  );
}

function LogsPane({ agent }: { agent: Agent }) {
  const { data, loading } = useApi<{ logs: Array<{ id: string; level: string; message: string; createdAt: string }> }>(
    `/api/logs?agent=${agent.codename}&limit=50`,
    10000,
  );
  const logs = data?.logs ?? agent.logs ?? [];

  if (loading && !data) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 bg-[var(--j-panel-soft)] animate-pulse rounded" />)}</div>;
  }

  return (
    <div className="space-y-1.5 max-h-96 overflow-y-auto jarvis-scroll">
      {logs.length ? logs.map((l) => (
        <div key={l.id} className="flex items-start gap-2 text-xs p-2 rounded hover:bg-[var(--j-panel-soft)]/50 transition-colors">
          <span className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded shrink-0" style={{ color: levelColor(l.level), background: `${levelColor(l.level)}1a`, border: `1px solid ${levelColor(l.level)}33` }}>
            {l.level}
          </span>
          <span className="text-[var(--j-text-dim)] flex-1">{l.message}</span>
          <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] shrink-0">{new Date(l.createdAt).toLocaleTimeString()}</span>
        </div>
      )) : <div className="text-xs text-[var(--j-text-mute)] text-center py-8">No logs recorded for this agent</div>}
    </div>
  );
}

function ActionsPane({ agent, onCycle, onUpdated, onClose }: { agent: Agent; onCycle: (a: Agent) => void; onUpdated: () => void; onClose: () => void }) {
  const navigate = useTabNav();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  // Assign task form state
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPriority, setTaskPriority] = useState('medium');

  // Send comms form state
  const [commsSubject, setCommsSubject] = useState('');
  const [commsBody, setCommsBody] = useState('');
  const [commsPriority, setCommsPriority] = useState('normal');

  // Edit model state
  const [model, setModel] = useState(agent.model);

  const assignTask = async () => {
    if (!taskTitle.trim()) { toast({ title: 'Task title required', variant: 'destructive' }); return; }
    setBusy('task');
    try {
      const res = await postJson('/api/tasks', { title: taskTitle, priority: taskPriority, assigneeId: agent.id });
      toast({ title: `Task assigned to ${agent.codename}`, description: taskTitle });
      setTaskTitle('');
      onUpdated();
    } catch (e) {
      toast({ title: 'Assign failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const sendComms = async () => {
    if (!commsSubject.trim() || !commsBody.trim()) { toast({ title: 'Subject and body required', variant: 'destructive' }); return; }
    setBusy('comms');
    try {
      await postJson('/api/comms', {
        fromAgent: 'ORION',
        toAgent: agent.codename,
        subject: commsSubject,
        body: commsBody,
        priority: commsPriority,
        thread: 'ops',
      });
      toast({ title: `Message sent to ${agent.codename}` });
      setCommsSubject('');
      setCommsBody('');
      onUpdated();
    } catch (e) {
      toast({ title: 'Send failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const spawnSubAgent = async () => {
    setBusy('spawn');
    try {
      await postJson('/api/agents/spawn', {
        parentCodename: agent.codename,
        role: `Sub-agent under ${agent.codename}`,
        reason: 'Manual spawn from fleet detail',
      });
      toast({ title: `Sub-agent spawned under ${agent.codename}` });
      navigate('spawned');
      onClose();
    } catch (e) {
      toast({ title: 'Spawn failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const updateModel = async () => {
    if (!model.trim()) return;
    setBusy('model');
    try {
      await patchJson(`/api/agents/${agent.id}`, { model });
      toast({ title: `Model updated to ${model}` });
      onUpdated();
    } catch (e) {
      toast({ title: 'Update failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Assign Task */}
      <div className="p-3 rounded border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]/30">
        <div className="flex items-center gap-2 mb-2">
          <ListTodo className="h-3.5 w-3.5 text-[var(--j-amber)]" />
          <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text)]">Assign New Task</span>
        </div>
        <div className="space-y-2">
          <Input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Task title…"
            className="bg-[var(--j-panel)] border-[var(--j-border)] h-8 text-xs"
          />
          <div className="flex gap-2">
            <Select value={taskPriority} onValueChange={setTaskPriority}>
              <SelectTrigger className="bg-[var(--j-panel)] border-[var(--j-border)] h-8 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={assignTask} disabled={busy === 'task'} className="jarvis-btn-accent border-0">
              {busy === 'task' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              Assign
            </Button>
          </div>
        </div>
      </div>

      {/* Send Comms */}
      <div className="p-3 rounded border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]/30">
        <div className="flex items-center gap-2 mb-2">
          <MessageSquare className="h-3.5 w-3.5 text-[var(--j-violet)]" />
          <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text)]">Send Message</span>
        </div>
        <div className="space-y-2">
          <Input
            value={commsSubject}
            onChange={(e) => setCommsSubject(e.target.value)}
            placeholder="Subject…"
            className="bg-[var(--j-panel)] border-[var(--j-border)] h-8 text-xs"
          />
          <Textarea
            value={commsBody}
            onChange={(e) => setCommsBody(e.target.value)}
            placeholder="Message body…"
            className="bg-[var(--j-panel)] border-[var(--j-border)] min-h-[60px] text-xs"
          />
          <div className="flex gap-2">
            <Select value={commsPriority} onValueChange={setCommsPriority}>
              <SelectTrigger className="bg-[var(--j-panel)] border-[var(--j-border)] h-8 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={sendComms} disabled={busy === 'comms'} className="jarvis-btn-accent border-0">
              {busy === 'comms' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
              Send
            </Button>
          </div>
        </div>
      </div>

      {/* Spawn Sub-Agent */}
      <div className="p-3 rounded border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]/30">
        <div className="flex items-center gap-2 mb-2">
          <Copy className="h-3.5 w-3.5 text-[var(--j-cyan)]" />
          <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text)]">Spawn Sub-Agent</span>
        </div>
        <p className="text-[11px] text-[var(--j-text-mute)] mb-2">
          Create an ephemeral child agent under {agent.codename} for parallel task execution. Sub-agents inherit the parent's skills + model.
        </p>
        <Button size="sm" onClick={spawnSubAgent} disabled={busy === 'spawn'} className="w-full jarvis-btn-accent border-0">
          {busy === 'spawn' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
          Spawn Under {agent.codename}
        </Button>
      </div>

      {/* Edit Model */}
      <div className="p-3 rounded border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]/30">
        <div className="flex items-center gap-2 mb-2">
          <Cpu className="h-3.5 w-3.5 text-[var(--j-green)]" />
          <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text)]">Model Configuration</span>
        </div>
        <div className="flex gap-2">
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="bg-[var(--j-panel)] border-[var(--j-border)] h-8 text-xs flex-1"
          />
          <Button size="sm" onClick={updateModel} disabled={busy === 'model' || model === agent.model} className="jarvis-btn-accent border-0">
            {busy === 'model' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Settings className="h-3.5 w-3.5 mr-1" />}
            Save
          </Button>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 pt-2 border-t border-[var(--j-border-soft)]">
        <Button size="sm" variant="outline" onClick={() => onCycle(agent)} className="flex-1 border-[var(--j-border)] bg-transparent">
          <Power className="h-3.5 w-3.5 mr-1" /> Cycle Status
        </Button>
        <Button size="sm" variant="outline" onClick={() => { navigate('comms'); onClose(); }} className="flex-1 border-[var(--j-border)] bg-transparent">
          <MessageSquare className="h-3.5 w-3.5 mr-1" /> Comms
        </Button>
        <Button size="sm" variant="outline" onClick={() => { navigate('tasks', { assigneeId: agent.id }); onClose(); }} className="flex-1 border-[var(--j-border)] bg-transparent">
          <ListTodo className="h-3.5 w-3.5 mr-1" /> Tasks
        </Button>
      </div>
    </div>
  );
}

function levelColor(l: string): string {
  switch (l) {
    case 'success': return JARVIS.colors.green;
    case 'warn': return JARVIS.colors.amber;
    case 'error': return JARVIS.colors.red;
    case 'debug': return JARVIS.colors.textMute;
    default: return JARVIS.colors.cyan;
  }
}

function SpawnModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [codename, setCodename] = useState('');
  const [role, setRole] = useState('');
  const [skills, setSkills] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name || !codename) { toast({ title: 'Name and codename required', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      await postJson('/api/agents', {
        name, codename, role: role || 'Generalist',
        skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
      });
      toast({ title: `${codename.toUpperCase()} spawned` });
      onDone();
    } catch (e) {
      toast({ title: 'Spawn failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} className="relative w-full max-w-md jarvis-panel p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="jarvis-mono text-sm uppercase text-[var(--j-cyan)]">Spawn New Agent</h3>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Quantum" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Codename</label>
            <Input value={codename} onChange={(e) => setCodename(e.target.value.toUpperCase())} placeholder="e.g. QUANTUM" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Role</label>
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Security Analyst" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Skills (comma-separated)</label>
            <Textarea value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="research, summarize, alerts" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[60px]" />
          </div>
          <Button onClick={submit} disabled={busy} className="w-full jarvis-btn-accent border-0">
            {busy ? 'Spawning…' : 'Deploy Agent'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * Import modal — upload a JSON backup file or paste JSON directly.
 * Supports two modes: 'upsert' (update existing by codename, create new)
 * and 'create' (only create new agents, skip existing codenames).
 */
function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [jsonText, setJsonText] = useState('');
  const [mode, setMode] = useState<'upsert' | 'create'>('upsert');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ count: number; codenames: string[] } | null>(null);

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      setJsonText(text);
      parsePreview(text);
    } catch {
      toast({ title: 'Failed to read file', variant: 'destructive' });
    }
  };

  const parsePreview = (text: string) => {
    try {
      const parsed = JSON.parse(text);
      const agents = Array.isArray(parsed.agents) ? parsed.agents : Array.isArray(parsed) ? parsed : [];
      setPreview({
        count: agents.length,
        codenames: agents.slice(0, 8).map((a: { codename?: string }) => a.codename ?? '?').filter(Boolean),
      });
    } catch {
      setPreview(null);
    }
  };

  const submit = async () => {
    if (!jsonText.trim()) { toast({ title: 'Paste JSON or upload a file first', variant: 'destructive' }); return; }
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      toast({ title: 'Invalid JSON', variant: 'destructive' });
      return;
    }
    const agents = Array.isArray((parsed as { agents?: unknown[] })?.agents)
      ? (parsed as { agents: unknown[] }).agents
      : Array.isArray(parsed) ? parsed : [];
    if (agents.length === 0) { toast({ title: 'No agents found in JSON', variant: 'destructive' }); return; }

    setBusy(true);
    try {
      const res = await postJson('/api/agents/backup', { agents, mode });
      toast({
        title: `Import complete: ${res.created} created, ${res.updated} updated, ${res.skipped} skipped`,
        description: res.errors?.length ? `${res.errors.length} errors` : undefined,
      });
      onDone();
    } catch (e) {
      toast({ title: 'Import failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} className="relative w-full max-w-lg jarvis-panel p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-[var(--j-cyan)]/15 border border-[var(--j-cyan)]/30">
              <Upload className="h-3.5 w-3.5 text-[var(--j-cyan)]" />
            </div>
            <h3 className="jarvis-mono text-sm uppercase text-[var(--j-cyan)]">Import Agent Configurations</h3>
          </div>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-3">
          {/* File upload dropzone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
            className="border-2 border-dashed border-[var(--j-border)] rounded-lg p-6 text-center cursor-pointer hover:border-[var(--j-cyan)] hover:bg-[var(--j-cyan)]/5 transition-all group"
          >
            <FileJson className="h-8 w-8 mx-auto text-[var(--j-text-mute)] group-hover:text-[var(--j-cyan)] transition-colors mb-2" />
            <div className="text-xs text-[var(--j-text-dim)] group-hover:text-[var(--j-text)] transition-colors">
              <span className="font-semibold">Click to upload</span> or drag & drop
            </div>
            <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mt-1">JSON backup file</div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </div>

          {/* Or paste JSON */}
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1.5 block">
              Or paste JSON directly
            </label>
            <Textarea
              value={jsonText}
              onChange={(e) => { setJsonText(e.target.value); parsePreview(e.target.value); }}
              placeholder='{"agents": [{"name": "...", "codename": "...", "role": "...", "skills": "[]", "model": "glm-4.6"}]}'
              className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[100px] text-xs font-mono"
            />
          </div>

          {/* Preview */}
          {preview && (
            <div className="p-3 rounded bg-[var(--j-panel-soft)]/50 border border-[var(--j-border-soft)]">
              <div className="flex items-center gap-2 mb-1.5">
                <FileJson className="h-3.5 w-3.5 text-[var(--j-green)]" />
                <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text)]">
                  Preview: {preview.count} agent{preview.count !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {preview.codenames.map((cn, i) => (
                  <span key={i} className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-[var(--j-panel)] text-[var(--j-cyan)] border border-[var(--j-border-soft)]">
                    {cn}
                  </span>
                ))}
                {preview.count > 8 && <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">+{preview.count - 8} more</span>}
              </div>
            </div>
          )}

          {/* Mode selector */}
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1.5 block">Import Mode</label>
            <div className="flex gap-2">
              <button
                onClick={() => setMode('upsert')}
                className={`flex-1 px-3 py-2 rounded border text-xs transition-all ${
                  mode === 'upsert' ? 'border-[var(--j-cyan)] bg-[var(--j-cyan)]/10 text-[var(--j-cyan)]' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'
                }`}
              >
                <div className="font-semibold mb-0.5">Upsert</div>
                <div className="text-[9px] text-[var(--j-text-mute)]">Update existing, create new</div>
              </button>
              <button
                onClick={() => setMode('create')}
                className={`flex-1 px-3 py-2 rounded border text-xs transition-all ${
                  mode === 'create' ? 'border-[var(--j-amber)] bg-[var(--j-amber)]/10 text-[var(--j-amber)]' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'
                }`}
              >
                <div className="font-semibold mb-0.5">Create Only</div>
                <div className="text-[9px] text-[var(--j-text-mute)]">Skip existing codenames</div>
              </button>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={onClose} className="flex-1 border-[var(--j-border)] bg-transparent">
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || !jsonText.trim()} className="flex-1 jarvis-btn-accent border-0">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
              Import {preview ? `(${preview.count})` : ''}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * Templates modal — browse pre-built agent presets and spawn with one click.
 * Templates are grouped by category (engineering, research, business, ops, creative, security).
 */
interface Template {
  key: string;
  name: string;
  codename: string;
  role: string;
  skills: string[];
  model: string;
  description: string;
  category: string;
  accent: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  engineering: 'Engineering',
  research: 'Research',
  business: 'Business',
  ops: 'Operations',
  creative: 'Creative',
  security: 'Security',
};

function TemplatesModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const { data, loading } = useApi<{ templates: Template[]; byCategory: Record<string, Template[]> }>('/api/agents/templates', 0);
  const [search, setSearch] = useState('');
  const [spawning, setSpawning] = useState<string | null>(null);

  const templates = data?.templates ?? [];
  const filtered = search
    ? templates.filter((t) =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.role.toLowerCase().includes(search.toLowerCase()) ||
        t.skills.some((s) => s.includes(search.toLowerCase()))
      )
    : templates;

  const byCategory = filtered.reduce<Record<string, Template[]>>((acc, t) => {
    (acc[t.category] ??= []).push(t);
    return acc;
  }, {});

  const spawn = async (template: Template) => {
    setSpawning(template.key);
    try {
      const res = await postJson('/api/agents/templates', { templateKey: template.key });
      toast({ title: `${res.agent.codename} spawned`, description: `${template.name} · ${template.role}` });
      onDone();
    } catch (e) {
      toast({ title: 'Spawn failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setSpawning(null);
    }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="relative w-full max-w-3xl jarvis-glass border border-[var(--j-border)] rounded-xl overflow-hidden max-h-[88vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--j-border)]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--j-violet)]/15 border border-[var(--j-violet)]/30">
              <Sparkles className="h-4 w-4 text-[var(--j-violet)]" />
            </div>
            <div>
              <div className="text-sm font-bold text-[var(--j-text)]">Agent Templates</div>
              <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
                {templates.length} presets · one-click spawn
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)] transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-[var(--j-border)]">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--j-text-mute)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates by name, role, or skill…"
              className="w-full pl-8 pr-3 py-2 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-xs text-[var(--j-text)] placeholder:text-[var(--j-text-mute)] focus:outline-none focus:border-[var(--j-cyan)]"
            />
          </div>
        </div>

        {/* Templates grid by category */}
        <div className="p-4 overflow-y-auto jarvis-scroll flex-1 space-y-5">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-32 jarvis-skeleton rounded-lg" />)}
            </div>
          ) : Object.keys(byCategory).length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--j-text-mute)]">No templates match your search.</div>
          ) : (
            Object.entries(byCategory).map(([cat, items]) => (
              <div key={cat}>
                <div className="jarvis-mono text-[9px] uppercase tracking-widest text-[var(--j-text-mute)] mb-2 flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full" style={{ background: items[0]?.accent ?? JARVIS.colors.cyan }} />
                  {CATEGORY_LABELS[cat] ?? cat} · {items.length}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {items.map((t) => (
                    <div
                      key={t.key}
                      className="jarvis-panel p-3 group hover:border-[var(--j-cyan)]/40 transition-all relative overflow-hidden"
                    >
                      {/* Accent left border */}
                      <div className="absolute top-0 left-0 bottom-0 w-[3px]" style={{ background: t.accent }} />
                      <div className="pl-2">
                        <div className="flex items-start justify-between mb-1.5">
                          <div>
                            <div className="text-sm font-semibold text-[var(--j-text)]">{t.name}</div>
                            <div className="jarvis-mono text-[9px] uppercase text-[var(--j-cyan)]">{t.codename} · {t.model}</div>
                          </div>
                          <button
                            onClick={() => spawn(t)}
                            disabled={spawning === t.key}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[9px] jarvis-mono uppercase border transition-all disabled:opacity-50"
                            style={{ borderColor: `${t.accent}40`, color: t.accent }}
                          >
                            {spawning === t.key
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Zap className="h-3 w-3" />
                            }
                            Spawn
                          </button>
                        </div>
                        <p className="text-[11px] text-[var(--j-text-dim)] leading-snug mb-2">{t.description}</p>
                        <div className="flex flex-wrap gap-1">
                          {t.skills.slice(0, 5).map((s) => (
                            <span key={s} className="jarvis-mono text-[8px] uppercase px-1.5 py-0.5 rounded bg-[var(--j-panel-soft)] text-[var(--j-text-mute)] border border-[var(--j-border-soft)]">
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-[var(--j-border)] bg-[var(--j-panel-soft)]/40 flex items-center justify-between jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
          <span>Templates auto-generate unique codenames if collision occurs</span>
          <button onClick={onClose} className="text-[var(--j-cyan)] hover:underline">Done</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * Compare modal — select 2-5 agents and view side-by-side metrics.
 * Shows a comparison table with health scores, task stats, log stats, comms,
 * skills, and winners per metric (highlighted with a trophy icon).
 */
interface CompareAgent {
  id: string;
  codename: string;
  name: string;
  role: string;
  status: string;
  model: string;
  load: number;
  successRate: number;
  taskCount: number;
  logCount: number;
  healthScore: number;
  metrics: {
    tasks: { total: number; completed: number; inProgress: number; pending: number; failed: number; completionRate: number };
    logs: { total: number; errors: number; successes: number; warnings: number };
    comms: { sent: number; received: number; total: number };
    skills: { totalRuns: number; successes: number; successRate: number; avgLatency: number };
  };
  lastActive: string;
}

/**
 * downloadFile — creates a Blob from the given content, triggers a browser
 * download via an ephemeral <a> element, then revokes the object URL.
 */
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Returns a YYYY-MM-DD stamp for filenames (in local time). */
function dateStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Escapes a single CSV cell per RFC 4180 (quote when needed, double inner quotes). */
function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function CompareModal({ agents, onClose }: { agents: Agent[]; onClose: () => void }) {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const { data, loading } = useApi<{ agents: CompareAgent[]; winners: Record<string, string> }>(
    selectedIds.length >= 2 ? `/api/agents/compare?ids=${selectedIds.join(',')}` : null,
    0,
  );

  const filtered = search
    ? agents.filter((a) =>
        a.codename.toLowerCase().includes(search.toLowerCase()) ||
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        a.role.toLowerCase().includes(search.toLowerCase())
      )
    : agents;

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
  };

  const comparison = data?.agents ?? [];
  const winners = data?.winners ?? {};

  /** Build a normalized row for each compared agent (used by both JSON + CSV). */
  const exportRows = () =>
    comparison.map((a) => ({
      codename: a.codename,
      name: a.name,
      role: a.role,
      status: a.status,
      model: a.model,
      healthScore: a.healthScore,
      successRate: a.successRate,
      load: Math.round(a.load),
      tasksTotal: a.metrics.tasks.total,
      tasksCompleted: a.metrics.tasks.completed,
      completionRate: a.metrics.tasks.completionRate,
      logsTotal: a.metrics.logs.total,
      logErrors: a.metrics.logs.errors,
      logSuccesses: a.metrics.logs.successes,
      logWarnings: a.metrics.logs.warnings,
      commsSent: a.metrics.comms.sent,
      commsReceived: a.metrics.comms.received,
      commsTotal: a.metrics.comms.total,
      skillRuns: a.metrics.skills.totalRuns,
      skillSuccesses: a.metrics.skills.successes,
      skillSuccessRate: a.metrics.skills.successRate,
      skillAvgLatency: a.metrics.skills.avgLatency,
      lastActive: a.lastActive,
    }));

  /** Export the full comparison payload (agents + winners) as a JSON file. */
  const exportJson = () => {
    if (comparison.length === 0) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      selectedIds,
      agents: exportRows(),
      winners,
      summary: {
        agentCount: comparison.length,
        bestHealthScore: winners.healthScore ?? null,
        bestSuccessRate: winners.successRate ?? null,
      },
    };
    downloadFile(
      JSON.stringify(payload, null, 2),
      `agent-comparison-${dateStamp()}.json`,
      'application/json',
    );
    toast({ title: 'Export complete', description: `agent-comparison-${dateStamp()}.json` });
  };

  /** Export the comparison as a CSV with the canonical column set. */
  const exportCsv = () => {
    if (comparison.length === 0) return;
    const headers = [
      'Codename', 'Role', 'Status', 'Health Score', 'Success Rate', 'Load',
      'Tasks Total', 'Tasks Completed', 'Completion Rate',
      'Logs Total', 'Log Errors', 'Comms Sent', 'Comms Received',
      'Skill Runs', 'Skill Success Rate',
    ];
    const rows = comparison.map((a) => [
      a.codename, a.role, a.status, a.healthScore, a.successRate, Math.round(a.load),
      a.metrics.tasks.total, a.metrics.tasks.completed, a.metrics.tasks.completionRate,
      a.metrics.logs.total, a.metrics.logs.errors,
      a.metrics.comms.sent, a.metrics.comms.received,
      a.metrics.skills.totalRuns, a.metrics.skills.successRate,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map(csvCell).join(','))
      .join('\n');
    downloadFile(csv, `agent-comparison-${dateStamp()}.csv`, 'text/csv;charset=utf-8;');
    toast({ title: 'Export complete', description: `agent-comparison-${dateStamp()}.csv` });
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="relative w-full max-w-5xl jarvis-glass border border-[var(--j-border)] rounded-xl overflow-hidden max-h-[88vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--j-border)]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--j-cyan)]/15 border border-[var(--j-cyan)]/30">
              <GitCompare className="h-4 w-4 text-[var(--j-cyan)]" />
            </div>
            <div>
              <div className="text-sm font-bold text-[var(--j-text)]">Agent Comparison</div>
              <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
                {selectedIds.length} selected · pick 2-5 to compare
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)] transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: agent picker */}
          <div className="w-64 border-r border-[var(--j-border)] flex flex-col">
            <div className="p-3 border-b border-[var(--j-border)]">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--j-text-mute)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search agents…"
                  className="w-full pl-8 pr-3 py-2 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-xs text-[var(--j-text)] placeholder:text-[var(--j-text-mute)] focus:outline-none focus:border-[var(--j-cyan)]"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto jarvis-scroll p-2 space-y-1">
              {filtered.slice(0, 50).map((a) => {
                const isSelected = selectedIds.includes(a.id);
                const color = STATUS_COLORS[a.status as keyof typeof STATUS_COLORS] ?? JARVIS.colors.textDim;
                return (
                  <button
                    key={a.id}
                    onClick={() => toggle(a.id)}
                    className={`w-full flex items-center gap-2 p-2 rounded text-left transition-colors ${
                      isSelected ? 'bg-[var(--j-cyan)]/10 border border-[var(--j-cyan)]/40' : 'hover:bg-[var(--j-panel-soft)] border border-transparent'
                    }`}
                  >
                    <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${isSelected ? 'bg-[var(--j-cyan)] border-[var(--j-cyan)]' : 'border-[var(--j-border)]'}`}>
                      {isSelected && <Check className="h-3 w-3 text-white" />}
                    </div>
                    <StatusDot status={a.status as never} size={8} />
                    <div className="min-w-0 flex-1">
                      <div className="jarvis-mono text-xs text-[var(--j-text)] truncate">{a.codename}</div>
                      <div className="text-[9px] text-[var(--j-text-mute)] truncate">{a.role}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: comparison table */}
          <div className="flex-1 overflow-y-auto jarvis-scroll p-4">
            {selectedIds.length < 2 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <GitCompare className="h-12 w-12 text-[var(--j-text-mute)] opacity-30 mb-3" />
                <div className="text-sm text-[var(--j-text-dim)] mb-1">Select at least 2 agents</div>
                <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
                  Pick from the list on the left to compare metrics side-by-side
                </div>
              </div>
            ) : loading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 jarvis-skeleton rounded" />)}
              </div>
            ) : comparison.length > 0 ? (
              <div className="space-y-4">
                {/* Agent headers */}
                <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${comparison.length}, 1fr)` }}>
                  {comparison.map((a) => {
                    const color = STATUS_COLORS[a.status as keyof typeof STATUS_COLORS] ?? JARVIS.colors.textDim;
                    return (
                      <div key={a.id} className="jarvis-panel p-3 text-center relative overflow-hidden">
                        <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: color }} />
                        <StatusDot status={a.status as never} size={10} />
                        <div className="jarvis-mono text-sm font-bold mt-1" style={{ color }}>{a.codename}</div>
                        <div className="text-[10px] text-[var(--j-text-mute)] truncate">{a.role}</div>
                        <div className="jarvis-mono text-[9px] text-[var(--j-text-dim)] mt-1">{a.model}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Health score row */}
                <div className="jarvis-panel p-3">
                  <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-2">Health Score</div>
                  <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${comparison.length}, 1fr)` }}>
                    {comparison.map((a) => {
                      const isWinner = winners.healthScore === a.codename;
                      const score = a.healthScore;
                      const color = score >= 70 ? JARVIS.colors.green : score >= 40 ? JARVIS.colors.amber : JARVIS.colors.red;
                      return (
                        <div key={a.id} className="text-center relative">
                          {isWinner && <Trophy className="absolute -top-1 -right-1 h-3 w-3 text-[var(--j-amber)]" />}
                          <div className="text-2xl font-bold jarvis-mono" style={{ color }}>{score}</div>
                          <div className="h-1.5 rounded-full bg-[var(--j-border)] overflow-hidden mt-1">
                            <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${score}%` }} transition={{ duration: 0.5 }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Metrics comparison table */}
                <div className="jarvis-panel p-3">
                  <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-2">Metrics Comparison</div>
                  <table className="w-full text-xs">
                    <tbody>
                      <CompareRow label="Success Rate" agents={comparison} winners={winners} winnerKey="successRate" getValue={(a) => `${a.successRate}%`} getNum={(a) => a.successRate} higherBetter />
                      <CompareRow label="Load" agents={comparison} winners={winners} winnerKey="load" getValue={(a) => `${Math.round(a.load)}%`} getNum={(a) => a.load} higherBetter={false} />
                      <CompareRow label="Tasks Total" agents={comparison} winners={winners} winnerKey="taskCount" getValue={(a) => String(a.metrics.tasks.total)} getNum={(a) => a.metrics.tasks.total} higherBetter />
                      <CompareRow label="Tasks Completed" agents={comparison} winners={winners} winnerKey="completionRate" getValue={(a) => `${a.metrics.tasks.completed} (${a.metrics.tasks.completionRate}%)`} getNum={(a) => a.metrics.tasks.completionRate} higherBetter />
                      <CompareRow label="Logs Total" agents={comparison} winners={winners} winnerKey="logCount" getValue={(a) => String(a.metrics.logs.total)} getNum={(a) => a.metrics.logs.total} higherBetter />
                      <CompareRow label="Log Errors" agents={comparison} winners={[]} winnerKey="" getValue={(a) => String(a.metrics.logs.errors)} getNum={(a) => a.metrics.logs.errors} higherBetter={false} />
                      <CompareRow label="Comms Sent" agents={comparison} winners={[]} winnerKey="" getValue={(a) => String(a.metrics.comms.sent)} getNum={(a) => a.metrics.comms.sent} higherBetter />
                      <CompareRow label="Comms Received" agents={comparison} winners={[]} winnerKey="" getValue={(a) => String(a.metrics.comms.received)} getNum={(a) => a.metrics.comms.received} higherBetter />
                      <CompareRow label="Skill Runs" agents={comparison} winners={[]} winnerKey="" getValue={(a) => String(a.metrics.skills.totalRuns)} getNum={(a) => a.metrics.skills.totalRuns} higherBetter />
                      <CompareRow label="Skill Success" agents={comparison} winners={[]} winnerKey="" getValue={(a) => `${a.metrics.skills.successRate}%`} getNum={(a) => a.metrics.skills.successRate} higherBetter />
                    </tbody>
                  </table>
                </div>

                {/* Radar chart — normalized 0-100 comparison across 6 dimensions */}
                <div className="jarvis-panel p-3">
                  <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-2 flex items-center gap-1.5">
                    <Activity className="h-3 w-3" /> Capability Radar (normalized 0-100)
                  </div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={(() => {
                        // Normalize each metric to 0-100 for the radar.
                        const maxTasks = Math.max(1, ...comparison.map((a) => a.metrics.tasks.total));
                        const maxLogs = Math.max(1, ...comparison.map((a) => a.metrics.logs.total));
                        const maxComms = Math.max(1, ...comparison.map((a) => a.metrics.comms.total));
                        const maxSkills = Math.max(1, ...comparison.map((a) => a.metrics.skills.totalRuns));
                        const dims = ['Health', 'Success', 'Tasks', 'Activity', 'Comms', 'Skills'];
                        return dims.map((dim) => {
                          const row: Record<string, string | number> = { dim };
                          for (const a of comparison) {
                            let val = 0;
                            switch (dim) {
                              case 'Health': val = a.healthScore; break;
                              case 'Success': val = a.successRate; break;
                              case 'Tasks': val = (a.metrics.tasks.total / maxTasks) * 100; break;
                              case 'Activity': val = (a.metrics.logs.total / maxLogs) * 100; break;
                              case 'Comms': val = (a.metrics.comms.total / maxComms) * 100; break;
                              case 'Skills': val = (a.metrics.skills.totalRuns / maxSkills) * 100; break;
                            }
                            row[a.codename] = Math.round(val);
                          }
                          return row;
                        });
                      })()} outerRadius="70%">
                        <PolarGrid stroke="#1B2330" />
                        <PolarAngleAxis dataKey="dim" tick={{ fill: '#94A3B8', fontSize: 10 }} />
                        <PolarRadiusAxis tick={{ fill: '#64748B', fontSize: 9 }} angle={90} domain={[0, 100]} />
                        <Tooltip contentStyle={{ background: '#0E1218', border: '1px solid #1B2330', borderRadius: 8, fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        {comparison.map((a, i) => {
                          const colors = [JARVIS.colors.cyan, JARVIS.colors.green, JARVIS.colors.amber, JARVIS.colors.violet, JARVIS.colors.red];
                          const color = colors[i % colors.length];
                          return (
                            <Radar
                              key={a.id}
                              name={a.codename}
                              dataKey={a.codename}
                              stroke={color}
                              fill={color}
                              fillOpacity={0.1}
                              strokeWidth={1.5}
                            />
                          );
                        })}
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Activity Timeline — daily activity over 14 days */}
                <CompareTimeline selectedIds={selectedIds} agents={comparison} />
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-[var(--j-border)] bg-[var(--j-panel-soft)]/40 flex items-center justify-between">
          <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
            {selectedIds.length}/5 agents selected
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={exportJson}
              disabled={comparison.length === 0}
              className="flex items-center gap-1.5 jarvis-mono text-[9px] uppercase px-2 py-1 rounded border border-[var(--j-border)] text-[var(--j-text-mute)] hover:text-[var(--j-cyan)] hover:border-[var(--j-cyan)]/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[var(--j-text-mute)] disabled:hover:border-[var(--j-border)]"
              title={comparison.length === 0 ? 'Select 2+ agents to enable export' : 'Download as JSON'}
            >
              <Download className="h-3 w-3" />
              JSON
            </button>
            <button
              onClick={exportCsv}
              disabled={comparison.length === 0}
              className="flex items-center gap-1.5 jarvis-mono text-[9px] uppercase px-2 py-1 rounded border border-[var(--j-border)] text-[var(--j-text-mute)] hover:text-[var(--j-cyan)] hover:border-[var(--j-cyan)]/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[var(--j-text-mute)] disabled:hover:border-[var(--j-border)]"
              title={comparison.length === 0 ? 'Select 2+ agents to enable export' : 'Download as CSV'}
            >
              <Download className="h-3 w-3" />
              CSV
            </button>
            <button
              onClick={onClose}
              className="jarvis-mono text-[9px] uppercase text-[var(--j-cyan)] hover:underline ml-1"
            >
              Done
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function CompareRow({
  label,
  agents,
  winners,
  winnerKey,
  getValue,
  getNum,
  higherBetter,
}: {
  label: string;
  agents: CompareAgent[];
  winners: Record<string, string>;
  winnerKey: string;
  getValue: (a: CompareAgent) => string;
  getNum: (a: CompareAgent) => number;
  higherBetter: boolean;
}) {
  // Find the best value
  const nums = agents.map(getNum);
  const bestVal = higherBetter ? Math.max(...nums) : Math.min(...nums);
  return (
    <tr className="border-b border-[var(--j-border-soft)] last:border-0">
      <td className="py-2 pr-3 jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] whitespace-nowrap">{label}</td>
      {agents.map((a) => {
        const val = getNum(a);
        const isWinner = winnerKey && val === bestVal && agents.length > 1;
        return (
          <td key={a.id} className="py-2 px-2 text-center relative">
            {isWinner && <Trophy className="absolute top-1 right-1 h-2.5 w-2.5 text-[var(--j-amber)]" />}
            <span className={`jarvis-mono text-xs ${isWinner ? 'font-bold text-[var(--j-amber)]' : 'text-[var(--j-text)]'}`}>
              {getValue(a)}
            </span>
          </td>
        );
      })}
    </tr>
  );
}

/**
 * CompareTimeline — fetches daily activity data for the selected agents and
 * renders a multi-line chart showing activity (logs + comms + tasks) over 14 days.
 */
function CompareTimeline({ selectedIds, agents }: { selectedIds: string[]; agents: CompareAgent[] }) {
  const [metric, setMetric] = useState<'logs' | 'comms' | 'tasks' | 'errors'>('logs');
  const { data, loading } = useApi<{
    timeline: Array<{ id: string; codename: string; series: Array<{ date: string; label: string; logs: number; errors: number; commsTotal: number; tasks: number }> }>;
    buckets: Array<{ date: string; label: string }>;
  }>(`/api/agents/compare/timeline?ids=${selectedIds.join(',')}&days=14`, 0);

  if (loading || !data || data.timeline.length === 0) {
    return (
      <div className="jarvis-panel p-3">
        <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-2">Activity Timeline (14d)</div>
        <div className="h-48 flex items-center justify-center">
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-[var(--j-cyan)]" /> : <span className="text-xs text-[var(--j-text-mute)]">No timeline data</span>}
        </div>
      </div>
    );
  }

  // Merge all agents' series into a single array for the chart.
  const merged = data.buckets.map((b) => {
    const row: Record<string, string | number> = { label: b.label };
    for (const agent of data.timeline) {
      const point = agent.series.find((s) => s.date === b.date);
      if (point) {
        switch (metric) {
          case 'logs': row[agent.codename] = point.logs; break;
          case 'errors': row[agent.codename] = point.errors; break;
          case 'comms': row[agent.codename] = point.commsTotal; break;
          case 'tasks': row[agent.codename] = point.tasks; break;
        }
      } else {
        row[agent.codename] = 0;
      }
    }
    return row;
  });

  const colors = [JARVIS.colors.cyan, JARVIS.colors.green, JARVIS.colors.amber, JARVIS.colors.violet, JARVIS.colors.red];

  return (
    <div className="jarvis-panel p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] flex items-center gap-1.5">
          <Activity className="h-3 w-3" /> Activity Timeline (14d)
        </div>
        <div className="flex gap-1">
          {(['logs', 'errors', 'comms', 'tasks'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded border transition-colors ${
                metric === m ? 'border-[var(--j-cyan)] bg-[var(--j-cyan)]/10 text-[var(--j-cyan)]' : 'border-[var(--j-border)] text-[var(--j-text-mute)] hover:text-[var(--j-text)]'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={merged} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1B2330" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={20} />
            <YAxis tick={{ fill: '#64748B', fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={{ background: '#0E1218', border: '1px solid #1B2330', borderRadius: 8, fontSize: 11 }} labelStyle={{ color: '#94A3B8' }} />
            <Legend wrapperStyle={{ fontSize: 9 }} />
            {data.timeline.map((agent, i) => {
              const color = colors[i % colors.length];
              return (
                <Line
                  key={agent.id}
                  type="monotone"
                  dataKey={agent.codename}
                  stroke={color}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
