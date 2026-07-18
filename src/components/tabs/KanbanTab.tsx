'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, closestCorners,
  type DragStartEvent, type DragEndEvent, useDroppable, useDraggable,
} from '@dnd-kit/core';
import { LayoutGrid, Plus, GripVertical, User as UserIcon, Trash2, RotateCcw } from 'lucide-react';
import { useApi, patchJson, postJson, deleteJson } from '@/lib/hooks/use-api';
import { JARVIS, PRIORITY_COLORS } from '@/lib/config';
import { SectionTitle, PriorityBadge, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Task {
  id: string; title: string; description?: string; status: string; priority: string;
  progress: number; assignee?: { codename: string; name: string } | null; createdAt: string;
}

const COLUMNS = [
  { key: 'pending', label: 'Backlog', accent: JARVIS.colors.amber },
  { key: 'in_progress', label: 'In Progress', accent: JARVIS.colors.cyan },
  { key: 'completed', label: 'Done', accent: JARVIS.colors.green },
  { key: 'failed', label: 'Blocked', accent: JARVIS.colors.red },
] as const;

export default function KanbanTab() {
  const { data, loading, refresh } = useApi<{ tasks: Task[] }>('/api/tasks', 8000);
  const { toast } = useToast();
  const [dragId, setDragId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const byCol = useMemo(() => {
    const m: Record<string, Task[]> = { pending: [], in_progress: [], completed: [], failed: [] };
    for (const t of data?.tasks ?? []) (m[t.status] ?? m.pending).push(t);
    return m;
  }, [data]);

  const draggedTask = useMemo(() => (data?.tasks ?? []).find((t) => t.id === dragId) ?? null, [data, dragId]);

  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id));
  const onDragEnd = async (e: DragEndEvent) => {
    setDragId(null);
    const { active, over } = e;
    if (!over) return;
    const newStatus = String(over.id);
    const task = (data?.tasks ?? []).find((t) => t.id === active.id);
    if (!task || task.status === newStatus) return;
    await patchJson(`/api/tasks/${task.id}`, { status: newStatus, progress: newStatus === 'completed' ? 100 : newStatus === 'in_progress' ? 25 : task.progress });
    toast({ title: `Moved to ${COLUMNS.find((c) => c.key === newStatus)?.label}` });
    refresh();
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Task Kanban"
        icon={LayoutGrid}
        accent={JARVIS.colors.amber}
        action={
          <Button size="sm" variant="outline" className="jarvis-btn-accent border-0" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New Task
          </Button>
        }
      />

      {/* Column count strip */}
      <div className="grid grid-cols-4 gap-3">
        {COLUMNS.map((c) => (
          <div key={c.key} className="jarvis-panel px-3 py-2 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: c.accent, boxShadow: `0 0 8px ${c.accent}` }} />
            <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-dim)] flex-1">{c.label}</span>
            <span className="jarvis-mono text-sm font-semibold" style={{ color: c.accent }}>{byCol[c.key]?.length ?? 0}</span>
          </div>
        ))}
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="jarvis-panel h-64 animate-pulse" />)}</div>
      ) : (data?.tasks?.length ?? 0) > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {COLUMNS.map((col) => (
              <KanbanColumn key={col.key} col={col} tasks={byCol[col.key] ?? []} onAdvance={async (t) => { await postJson(`/api/tasks/${t.id}`, {}); refresh(); }} onDelete={async (t) => { await deleteJson(`/api/tasks/${t.id}`); refresh(); }} onReopen={async (t) => { await patchJson(`/api/tasks/${t.id}`, { status: 'in_progress', progress: 0 }); refresh(); }} />
            ))}
          </div>
          <DragOverlay>
            {draggedTask ? <KanbanCard task={draggedTask} dragging /> : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <EmptyState icon={LayoutGrid} message="No tasks — create one to start" />
      )}

      <AnimatePresence>
        {open && <NewTaskModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); refresh(); }} />}
      </AnimatePresence>
    </div>
  );
}

function KanbanColumn({ col, tasks, onAdvance, onDelete, onReopen }: {
  col: typeof COLUMNS[number];
  tasks: Task[];
  onAdvance: (t: Task) => Promise<void>;
  onDelete: (t: Task) => Promise<void>;
  onReopen: (t: Task) => Promise<void>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  return (
    <div
      ref={setNodeRef}
      className="jarvis-panel p-3 min-h-[300px] flex flex-col transition-colors"
      style={isOver ? { borderColor: col.accent, boxShadow: `0 0 0 1px ${col.accent}55, inset 0 0 24px -8px ${col.accent}33` } : undefined}
    >
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[var(--j-border-soft)]">
        <span className="h-2 w-2 rounded-full" style={{ background: col.accent, boxShadow: `0 0 8px ${col.accent}` }} />
        <span className="jarvis-mono text-[10px] uppercase tracking-widest" style={{ color: col.accent }}>{col.label}</span>
        <span className="ml-auto jarvis-mono text-[10px] text-[var(--j-text-mute)]">{tasks.length}</span>
      </div>
      <div className="space-y-2 flex-1">
        <AnimatePresence>
          {tasks.map((t) => (
            <DraggableCard key={t.id} task={t} onAdvance={onAdvance} onDelete={onDelete} onReopen={onReopen} />
          ))}
        </AnimatePresence>
        {tasks.length === 0 && (
          <div className="text-center py-6 jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] opacity-50">drop here</div>
        )}
      </div>
    </div>
  );
}

function DraggableCard({ task, onAdvance, onDelete, onReopen }: { task: Task; onAdvance: (t: Task) => Promise<void>; onDelete: (t: Task) => Promise<void>; onReopen: (t: Task) => Promise<void> }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <KanbanCard
      task={task}
      dragging={isDragging}
      dragRef={setNodeRef}
      dragAttrs={attributes}
      dragListeners={listeners}
      onAdvance={onAdvance}
      onDelete={onDelete}
      onReopen={onReopen}
    />
  );
}

function KanbanCard({
  task, dragging, dragRef, dragAttrs, dragListeners, onAdvance, onDelete, onReopen,
}: {
  task: Task;
  dragging?: boolean;
  dragRef?: (el: HTMLElement | null) => void;
  dragAttrs?: Record<string, unknown>;
  dragListeners?: Record<string, unknown>;
  onAdvance?: (t: Task) => Promise<void>;
  onDelete?: (t: Task) => Promise<void>;
  onReopen?: (t: Task) => Promise<void>;
}) {
  const pColor = PRIORITY_COLORS[task.priority] ?? JARVIS.colors.textDim;
  return (
    <motion.div
      ref={dragRef}
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: dragging ? 0.4 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.15 }}
      className="group relative rounded-lg border border-[var(--j-border)] bg-[var(--j-panel-soft)] p-3 cursor-grab active:cursor-grabbing hover:border-[var(--j-cyan)]/50"
      style={dragging ? { boxShadow: '0 12px 32px -8px rgba(125,211,252,0.4)', borderColor: JARVIS.colors.cyan } : undefined}
      {...(dragAttrs ?? {})}
      {...(dragListeners ?? {})}
    >
      <div className="flex items-start gap-2 mb-1.5">
        <GripVertical className="h-3.5 w-3.5 text-[var(--j-text-mute)] opacity-40 group-hover:opacity-100 mt-0.5 shrink-0" />
        <span className="text-xs text-[var(--j-text)] leading-snug flex-1">{task.title}</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap pl-5">
        <PriorityBadge priority={task.priority} />
        {task.assignee && (
          <span className="jarvis-mono text-[9px] flex items-center gap-0.5 text-[var(--j-cyan)]">
            <UserIcon className="h-2.5 w-2.5" />{task.assignee.codename}
          </span>
        )}
      </div>
      {task.status === 'in_progress' && (
        <div className="mt-2 pl-5">
          <div className="h-1 rounded-full bg-[var(--j-border)] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${task.progress}%`, background: JARVIS.colors.cyan }} />
          </div>
        </div>
      )}
      {/* Hover actions */}
      {onAdvance && (
        <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {task.status !== 'completed' && (
            <button
              onClick={(e) => { e.stopPropagation(); onAdvance(task); }}
              className="h-5 w-5 flex items-center justify-center rounded text-[var(--j-cyan)] hover:bg-[var(--j-cyan)]/10"
              title="Advance status"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
          {task.status === 'completed' && onReopen && (
            <button
              onClick={(e) => { e.stopPropagation(); onReopen(task); }}
              className="h-5 w-5 flex items-center justify-center rounded text-[var(--j-amber)] hover:bg-[var(--j-amber)]/10"
              title="Reopen"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete?.(task); }}
            className="h-5 w-5 flex items-center justify-center rounded text-[var(--j-red)] hover:bg-[var(--j-red)]/10"
            title="Delete"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
      <span className="absolute left-0 top-0 bottom-0 w-[2px] rounded-l-lg" style={{ background: pColor }} />
    </motion.div>
  );
}

function NewTaskModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const { data } = useApi<{ agents: Array<{ id: string; codename: string }> }>('/api/agents', 0);
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
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><Plus className="h-4 w-4 rotate-45" /></button>
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
                <SelectContent>{data?.agents?.map((a) => <SelectItem key={a.id} value={a.id}>{a.codename}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={submit} disabled={busy} className="w-full jarvis-btn-accent border-0">{busy ? 'Creating…' : 'Create Task'}</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
