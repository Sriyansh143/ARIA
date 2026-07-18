'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Target, Plus, X, Trash2, Edit3, Pin, CheckCircle2, Circle, Clock } from 'lucide-react';
import { useApi, postJson, patchJson, deleteJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, EmptyState, PriorityBadge } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Goal {
  id: string;
  key: string;
  title: string;
  description: string;
  status: string; // pending | in-progress | completed | blocked
  priority: string;
  progress: number; // 0-100
  owner: string;
  dueDate: string | null;
  tags: string[];
  pinned: boolean;
  updatedAt: string;
}

const STATUSES = ['all', 'pending', 'in-progress', 'completed', 'blocked'] as const;

const STATUS_COLOR: Record<string, string> = {
  pending: JARVIS.colors.textMute,
  'in-progress': JARVIS.colors.cyan,
  completed: JARVIS.colors.green,
  blocked: JARVIS.colors.red,
};

const STATUS_ICON: Record<string, typeof Circle> = {
  pending: Circle,
  'in-progress': Clock,
  completed: CheckCircle2,
  blocked: Circle,
};

function timeAgo(date: string | Date): string {
  const d = typeof date === 'object' ? date : new Date(date);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function GoalsTab() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all');
  const { data, loading, refresh } = useApi<{ goals: Goal[] }>(`/api/goals?status=${status === 'all' ? '' : status}`, 15000);
  const { toast } = useToast();
  const [editing, setEditing] = useState<Goal | null>(null);
  const [creating, setCreating] = useState(false);

  const goals = data?.goals ?? [];
  const activeCount = goals.filter((g) => g.status === 'in-progress').length;
  const completedCount = goals.filter((g) => g.status === 'completed').length;
  const blockedCount = goals.filter((g) => g.status === 'blocked').length;

  const cycleProgress = async (g: Goal, delta: number) => {
    const next = Math.max(0, Math.min(100, g.progress + delta));
    await patchJson(`/api/goals/${g.id}`, { progress: next, status: next >= 100 ? 'completed' : next > 0 ? 'in-progress' : 'pending' });
    refresh();
  };
  const togglePin = async (g: Goal) => {
    await patchJson(`/api/goals/${g.id}`, { pinned: !g.pinned });
    refresh();
  };
  const remove = async (g: Goal) => {
    await deleteJson(`/api/goals/${g.id}`);
    toast({ title: 'Goal deleted' });
    refresh();
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Goals"
        icon={Target}
        accent={JARVIS.colors.cyan}
        action={
          <Button size="sm" variant="outline" className="jarvis-btn-accent border-0" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New Goal
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Goals" value={goals.length} icon={Target} accent={JARVIS.colors.cyan} />
        <StatCard label="In Progress" value={activeCount} icon={Clock} accent={JARVIS.colors.violet} />
        <StatCard label="Completed" value={completedCount} icon={CheckCircle2} accent={JARVIS.colors.green} />
        <StatCard label="Blocked" value={blockedCount} icon={Circle} accent={JARVIS.colors.red} />
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`jarvis-mono text-[10px] uppercase px-3 py-1.5 rounded-md border transition-colors ${status === s ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'}`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="jarvis-panel h-32 animate-pulse" />)}
        </div>
      ) : goals.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {goals.map((g, i) => {
            const color = STATUS_COLOR[g.status] ?? JARVIS.colors.textDim;
            const StatusIcon = STATUS_ICON[g.status] ?? Circle;
            return (
              <motion.div
                key={g.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                className={`jarvis-panel jarvis-card-hover p-4 ${g.pinned ? 'border-[var(--j-cyan)]/40' : ''}`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <StatusIcon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                      <span className="text-sm font-semibold text-[var(--j-text)] truncate">{g.title}</span>
                      {g.pinned && <Pin className="h-3 w-3 text-[var(--j-cyan)] fill-[var(--j-cyan)]" />}
                    </div>
                    {g.description && (
                      <p className="text-xs text-[var(--j-text-dim)] line-clamp-2 mb-1">{g.description}</p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded" style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}>
                        {g.status}
                      </span>
                      <PriorityBadge priority={g.priority} />
                      <span className="jarvis-mono text-[10px] text-[var(--j-cyan)]">@{g.owner}</span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => togglePin(g)} className={`p-1 ${g.pinned ? 'text-[var(--j-cyan)]' : 'text-[var(--j-text-mute)] hover:text-[var(--j-cyan)]'}`}>
                      <Pin className="h-3 w-3" />
                    </button>
                    <button onClick={() => setEditing(g)} className="text-[var(--j-text-mute)] hover:text-[var(--j-cyan)] p-1">
                      <Edit3 className="h-3 w-3" />
                    </button>
                    <button onClick={() => remove(g)} className="text-[var(--j-text-mute)] hover:text-[var(--j-red)] p-1">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)]">progress</span>
                    <span className="jarvis-mono text-[10px]" style={{ color }}>{g.progress}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--j-panel-soft)] overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${g.progress}%` }}
                      transition={{ duration: 0.6 }}
                      className="h-full rounded-full"
                      style={{ background: `linear-gradient(90deg, ${color}, ${color}80)` }}
                    />
                  </div>
                </div>

                {/* Quick progress controls */}
                <div className="flex items-center justify-between mt-3">
                  <div className="flex gap-1">
                    <button onClick={() => cycleProgress(g, -10)} className="jarvis-mono text-[10px] px-2 py-0.5 rounded border border-[var(--j-border-soft)] text-[var(--j-text-mute)] hover:text-[var(--j-text)]">−10%</button>
                    <button onClick={() => cycleProgress(g, 10)} className="jarvis-mono text-[10px] px-2 py-0.5 rounded border border-[var(--j-border-soft)] text-[var(--j-text-mute)] hover:text-[var(--j-green)]">+10%</button>
                  </div>
                  <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">{timeAgo(g.updatedAt)}</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Target} message="No goals yet — set your first objective" />
      )}

      <AnimatePresence>
        {(creating || editing) && (
          <GoalModal
            goal={editing}
            onClose={() => { setCreating(false); setEditing(null); }}
            onDone={() => { setCreating(false); setEditing(null); refresh(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function GoalModal({ goal, onClose, onDone }: { goal: Goal | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(goal?.title ?? '');
  const [description, setDescription] = useState(goal?.description ?? '');
  const [status, setStatus] = useState(goal?.status ?? 'pending');
  const [priority, setPriority] = useState(goal?.priority ?? 'medium');
  const [progress, setProgress] = useState(goal?.progress ?? 0);
  const [owner, setOwner] = useState(goal?.owner ?? 'ORION');
  const [dueDate, setDueDate] = useState(goal?.dueDate ?? '');
  const [tags, setTags] = useState((goal?.tags ?? []).join(', '));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title) {
      toast({ title: 'Title required', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const body = {
        title,
        description,
        status,
        priority,
        progress: Number(progress) || 0,
        owner,
        dueDate: dueDate || null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (goal) {
        await patchJson(`/api/goals/${goal.id}`, body);
      } else {
        await postJson('/api/goals', body);
      }
      toast({ title: goal ? 'Goal updated' : 'Goal created' });
      onDone();
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="relative w-full max-w-md jarvis-panel p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="jarvis-mono text-sm uppercase text-[var(--j-cyan)]">
            {goal ? 'Edit Goal' : 'New Goal'}
          </h3>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Launch v10 of Mission Control" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does success look like?" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[70px]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Status</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['pending', 'in-progress', 'completed', 'blocked'].map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['low', 'medium', 'high', 'critical'].map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Progress (0-100)</label>
              <Input value={String(progress)} onChange={(e) => setProgress(Number(e.target.value))} type="number" min={0} max={100} className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
            </div>
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Owner</label>
              <Input value={owner} onChange={(e) => setOwner(e.target.value.toUpperCase())} placeholder="ORION" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono" />
            </div>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Due date</label>
            <Input value={dueDate} onChange={(e) => setDueDate(e.target.value)} type="date" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Tags (comma-separated)</label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="q4, launch" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <Button onClick={save} disabled={busy} className="w-full jarvis-btn-accent border-0">
            {busy ? 'Saving…' : goal ? 'Update Goal' : 'Create Goal'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
