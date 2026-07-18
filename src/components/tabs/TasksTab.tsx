'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ListTodo, Plus, X, RefreshCw, ChevronRight, Trash2, RotateCcw } from 'lucide-react';
import { useApi, postJson, patchJson, deleteJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, PriorityBadge, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Task {
  id: string; title: string; description?: string; status: string; priority: string;
  progress: number; assignee?: { codename: string; name: string } | null; createdAt: string;
}

const FILTERS = ['all', 'pending', 'in_progress', 'completed', 'failed'] as const;

export default function TasksTab() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const { data, loading, refresh } = useApi<{ tasks: Task[] }>(`/api/tasks?status=${filter === 'all' ? '' : filter}`, 8000);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const tasks = data?.tasks ?? [];
  const counts = {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
  };

  const advance = async (t: Task) => {
    await postJson(`/api/tasks/${t.id}`, {});
    toast({ title: `Task → ${nextStatus(t.status)}` });
    refresh();
  };
  const remove = async (t: Task) => {
    await deleteJson(`/api/tasks/${t.id}`);
    toast({ title: 'Task deleted' });
    refresh();
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Task Board"
        icon={ListTodo}
        accent={JARVIS.colors.amber}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="jarvis-btn-accent border-0" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" /> New Task</Button>
            <Button size="sm" variant="outline" onClick={refresh} className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)]"><RefreshCw className="h-3.5 w-3.5" /></Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total" value={counts.total} icon={ListTodo} accent={JARVIS.colors.cyan} />
        <StatCard label="Pending" value={counts.pending} icon={ListTodo} accent={JARVIS.colors.amber} />
        <StatCard label="In Progress" value={counts.inProgress} icon={ListTodo} accent={JARVIS.colors.violet} />
        <StatCard label="Completed" value={counts.completed} icon={ListTodo} accent={JARVIS.colors.green} />
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`jarvis-mono text-[10px] uppercase px-3 py-1.5 rounded-md border transition-colors ${filter === f ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'}`}
          >
            {f.replace('_', ' ')}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="jarvis-panel h-16 animate-pulse" />)}</div>
      ) : tasks.length ? (
        <div className="space-y-2">
          {tasks.map((t, i) => {
            const color = statusColor(t.status);
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.02 }}
                className="jarvis-panel jarvis-card-hover p-3 flex items-center gap-3 group"
              >
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--j-text)] truncate">{t.title}</span>
                    <PriorityBadge priority={t.priority} />
                    {t.assignee && <span className="jarvis-mono text-[9px] text-[var(--j-cyan)]">{t.assignee.codename}</span>}
                  </div>
                  {t.status === 'in_progress' && (
                    <div className="mt-1.5 h-1 rounded-full bg-[var(--j-border)] overflow-hidden">
                      <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${t.progress}%` }} transition={{ duration: 0.5 }} />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {t.status !== 'completed' && (
                    <button onClick={() => advance(t)} className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--j-border)] text-[var(--j-cyan)] hover:bg-[var(--j-cyan)]/10" title="Advance status">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {t.status === 'completed' && (
                    <button onClick={() => patchJson(`/api/tasks/${t.id}`, { status: 'in_progress', progress: 0 }).then(refresh)} className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--j-border)] text-[var(--j-amber)] hover:bg-[var(--j-amber)]/10" title="Reopen">
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button onClick={() => remove(t)} className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--j-border)] text-[var(--j-red)] hover:bg-[var(--j-red)]/10" title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={ListTodo} message="No tasks in this view" />
      )}

      {open && <NewTaskModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); refresh(); }} />}
    </div>
  );
}

function NewTaskModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const { data } = useApi<{ agents: Array<{ id: string; codename: string; name: string }> }>('/api/agents', 0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [assigneeId, setAssigneeId] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title) { toast({ title: 'Title required', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      await postJson('/api/tasks', { title, description, priority, assigneeId: assigneeId || undefined });
      toast({ title: 'Task created' });
      onDone();
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-md jarvis-panel p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="jarvis-mono text-sm uppercase text-[var(--j-amber)]">New Task</h3>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done?" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional details…" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[60px]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue /></SelectTrigger>
                <SelectContent>{['low', 'medium', 'high', 'critical'].map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Assignee</label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  {data?.agents?.map((a) => <SelectItem key={a.id} value={a.id}>{a.codename}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={submit} disabled={busy} className="w-full jarvis-btn-accent border-0">{busy ? 'Creating…' : 'Create Task'}</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function statusColor(s: string): string {
  switch (s) {
    case 'completed': return JARVIS.colors.green;
    case 'in_progress': return JARVIS.colors.cyan;
    case 'pending': return JARVIS.colors.amber;
    case 'failed': return JARVIS.colors.red;
    default: return JARVIS.colors.textDim;
  }
}
function nextStatus(s: string): string {
  return s === 'pending' ? 'in_progress' : s === 'in_progress' ? 'completed' : 'pending';
}
