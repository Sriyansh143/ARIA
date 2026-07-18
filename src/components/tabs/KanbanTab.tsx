'use client';

import { useState, useMemo, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  closestCorners, type DragStartEvent, type DragEndEvent, useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy,
  sortableKeyboardCoordinates, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
  // Task ID 3 (PARALLEL-C) — manual ordering within a Kanban column.
  sortOrder: number;
}

const COLUMNS = [
  { key: 'pending', label: 'Backlog', accent: JARVIS.colors.amber },
  { key: 'in_progress', label: 'In Progress', accent: JARVIS.colors.cyan },
  { key: 'completed', label: 'Done', accent: JARVIS.colors.green },
  { key: 'failed', label: 'Blocked', accent: JARVIS.colors.red },
] as const;

const COLUMN_KEYS = new Set(COLUMNS.map((c) => c.key));

export default function KanbanTab() {
  const { data, loading, refresh } = useApi<{ tasks: Task[] }>('/api/tasks', 8000);
  const { toast } = useToast();
  const [dragId, setDragId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Group tasks by column, then sort each column by `sortOrder` ascending.
  // Tasks that still share the default sortOrder (0) fall back to createdAt
  // desc so the board reads naturally before any manual reorder happens.
  const byCol = useMemo(() => {
    const m: Record<string, Task[]> = { pending: [], in_progress: [], completed: [], failed: [] };
    for (const t of data?.tasks ?? []) (m[t.status] ?? m.pending).push(t);
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    }
    return m;
  }, [data]);

  const draggedTask = useMemo(() => (data?.tasks ?? []).find((t) => t.id === dragId) ?? null, [data, dragId]);

  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id));

  const onDragEnd = async (e: DragEndEvent) => {
    setDragId(null);
    const { active, over } = e;
    if (!over) return;

    const allTasks = data?.tasks ?? [];
    const activeTask = allTasks.find((t) => t.id === active.id);
    if (!activeTask) return;

    const overId = String(over.id);
    const overTask = allTasks.find((t) => t.id === overId);
    // `over` can be either a card id (hovered over another card) or a column
    // key (hovered over empty space in a column). Resolve to a column key.
    const overColKey = overTask ? overTask.status : (COLUMN_KEYS.has(overId) ? overId : null);
    if (!overColKey || !COLUMN_KEYS.has(overColKey)) return;

    // ── Same column → reorder ──────────────────────────────────────────────
    if (overColKey === activeTask.status) {
      // No card hovered (dropped on column empty space) or dropped on self → no-op.
      if (!overTask || overTask.id === activeTask.id) return;
      const colTasks = byCol[overColKey] ?? [];
      const oldIndex = colTasks.findIndex((t) => t.id === activeTask.id);
      const newIndex = colTasks.findIndex((t) => t.id === overTask.id);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
      const reordered = arrayMove(colTasks, oldIndex, newIndex);
      const items = reordered.map((t, i) => ({ id: t.id, sortOrder: i }));
      try {
        await postJson('/api/tasks/reorder', { items });
        toast({ title: 'Task reordered' });
        refresh();
      } catch (err) {
        toast({ title: 'Reorder failed', description: err instanceof Error ? err.message : '', variant: 'destructive' });
        refresh();
      }
      return;
    }

    // ── Different column → change status + append to end of new column ────
    const newStatus = overColKey;
    try {
      await patchJson(`/api/tasks/${activeTask.id}`, {
        status: newStatus,
        progress: newStatus === 'completed' ? 100 : newStatus === 'in_progress' ? 25 : activeTask.progress,
      });
      // Re-sequence the destination column so the moved task lands at the end.
      const targetColTasks = (byCol[newStatus] ?? []).filter((t) => t.id !== activeTask.id);
      const items = targetColTasks.map((t, i) => ({ id: t.id, sortOrder: i }));
      items.push({ id: activeTask.id, sortOrder: targetColTasks.length });
      await postJson('/api/tasks/reorder', { items });
      toast({ title: `Moved to ${COLUMNS.find((c) => c.key === newStatus)?.label}` });
      refresh();
    } catch (err) {
      toast({ title: 'Move failed', description: err instanceof Error ? err.message : '', variant: 'destructive' });
      refresh();
    }
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
          <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }}>
            {draggedTask ? (
              <div style={{ transform: 'rotate(2.5deg)', filter: 'drop-shadow(0 22px 32px rgba(0,0,0,0.45))' }}>
                <KanbanCard task={draggedTask} dragging overlay />
              </div>
            ) : null}
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
  const ids = useMemo(() => tasks.map((t) => t.id), [tasks]);
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
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="space-y-2 flex-1">
          <AnimatePresence>
            {tasks.map((t) => (
              <SortableCard key={t.id} task={t} onAdvance={onAdvance} onDelete={onDelete} onReopen={onReopen} />
            ))}
          </AnimatePresence>
          {tasks.length === 0 && (
            <div className={`text-center py-8 rounded border border-dashed transition-all ${
              isOver
                ? 'border-[var(--j-cyan)] bg-[var(--j-cyan)]/5'
                : 'border-[var(--j-border-soft)]'
            }`}>
              <LayoutGrid className="h-5 w-5 mx-auto mb-1.5 opacity-30" style={{ color: col.accent }} />
              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
                {isOver ? 'Drop here' : 'Empty — drag tasks here'}
              </div>
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

/**
 * Sortable wrapper — owns the dnd-kit `useSortable` hook and applies the drag
 * transform/transition to an outer div. The inner `KanbanCard` keeps its
 * framer-motion enter/exit + hover animations, so the two animation systems
 * never fight over the `transform` CSS property.
 */
function SortableCard({ task, onAdvance, onDelete, onReopen }: {
  task: Task;
  onAdvance: (t: Task) => Promise<void>;
  onDelete: (t: Task) => Promise<void>;
  onReopen: (t: Task) => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <KanbanCard task={task} dragging={isDragging} onAdvance={onAdvance} onDelete={onDelete} onReopen={onReopen} />
    </div>
  );
}

function KanbanCard({
  task, dragging, overlay, onAdvance, onDelete, onReopen,
}: {
  task: Task;
  dragging?: boolean;
  overlay?: boolean;
  onAdvance?: (t: Task) => Promise<void>;
  onDelete?: (t: Task) => Promise<void>;
  onReopen?: (t: Task) => Promise<void>;
}) {
  const pColor = PRIORITY_COLORS[task.priority] ?? JARVIS.colors.textDim;
  const ageMs = Date.now() - new Date(task.createdAt).getTime();
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  const isStale = ageDays > 3 && task.status !== 'completed';
  // `overlay` = rendered inside <DragOverlay/> (the floating copy). Give it a
  // slightly bigger scale + stronger glow so it reads as "lifted off" the board.
  const dimmed = dragging && !overlay;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 8 }}
      animate={{ opacity: dimmed ? 0.35 : 1, scale: overlay ? 1.03 : 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: -8 }}
      transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
      className="group relative rounded-lg border bg-[var(--j-panel-soft)] p-3 cursor-grab active:cursor-grabbing overflow-hidden"
      style={{
        borderColor: overlay
          ? JARVIS.colors.cyan
          : dragging
            ? JARVIS.colors.cyan
            : isStale
              ? `${JARVIS.colors.red}40`
              : 'var(--j-border)',
        boxShadow: overlay
          ? `0 24px 48px -8px rgba(125,211,252,0.65), 0 0 0 1px ${JARVIS.colors.cyan}`
          : dragging
            ? `0 16px 40px -8px rgba(125,211,252,0.5), 0 0 0 1px ${JARVIS.colors.cyan}`
            : isStale
              ? `inset 3px 0 0 ${JARVIS.colors.red}`
              : `inset 3px 0 0 ${pColor}`,
      }}
    >
      {/* Shimmer effect on hover */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ background: `linear-gradient(120deg, transparent 40%, ${JARVIS.colors.cyan}08 50%, transparent 60%)` }} />

      <div className="flex items-start gap-2 mb-1.5 relative">
        <GripVertical className="h-3.5 w-3.5 text-[var(--j-text-mute)] opacity-40 group-hover:opacity-100 group-hover:text-[var(--j-cyan)] transition-all mt-0.5 shrink-0" />
        <span className="text-xs text-[var(--j-text)] leading-snug flex-1">{task.title}</span>
        {isStale && (
          <span className="shrink-0 jarvis-mono text-[8px] uppercase px-1 rounded bg-[var(--j-red)]/15 text-[var(--j-red)] border border-[var(--j-red)]/30" title={`${ageDays} days old`}>
            {ageDays}d
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap pl-5 relative">
        <PriorityBadge priority={task.priority} />
        {task.assignee && (
          <span className="jarvis-mono text-[9px] flex items-center gap-0.5 text-[var(--j-cyan)]">
            <UserIcon className="h-2.5 w-2.5" />{task.assignee.codename}
          </span>
        )}
      </div>
      {task.status === 'in_progress' && (
        <div className="mt-2 pl-5 relative">
          <div className="h-1 rounded-full bg-[var(--j-border)] overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: `linear-gradient(90deg, ${JARVIS.colors.cyan}, ${JARVIS.colors.green})` }}
              initial={{ width: 0 }}
              animate={{ width: `${task.progress}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
        </div>
      )}
      {task.status === 'completed' && (
        <div className="mt-1.5 pl-5 flex items-center gap-1 relative">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: JARVIS.colors.green, boxShadow: `0 0 6px ${JARVIS.colors.green}` }} />
          <span className="jarvis-mono text-[9px] uppercase text-[var(--j-green)]">completed</span>
        </div>
      )}
      {/* Hover actions — pointerdown is stopped so these never start a drag */}
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
