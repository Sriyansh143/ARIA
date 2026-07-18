'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GitBranch, Plus, X, Link2, Trash2, RefreshCw, ArrowRight, Lock, CheckCircle2 } from 'lucide-react';
import { useApi, postJson, deleteJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, Pill, EmptyState } from '@/components/jarvis/shared';
import { ForceGraph, GraphLegend, type GraphNode, type GraphEdge } from '@/components/jarvis/ForceGraph';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface TaskLite {
  id: string; title: string; status: string; priority: string;
  assignee?: { codename: string } | null; progress: number;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { tasks: number; links: number; blocked: number; ready: number; completed: number };
}

const STATUS_COLORS: Record<string, string> = {
  pending: JARVIS.colors.amber,
  in_progress: JARVIS.colors.cyan,
  completed: JARVIS.colors.green,
  failed: JARVIS.colors.red,
  cancelled: JARVIS.colors.textMute,
};

export default function TaskDagTab() {
  const { data: graph, loading, refresh: refreshGraph } = useApi<GraphData>('/api/tasks/graph', 15000);
  const { data: tasksData } = useApi<{ tasks: TaskLite[] }>('/api/tasks', 0);
  const { toast } = useToast();
  const [linkOpen, setLinkOpen] = useState(false);
  const [selected, setSelected] = useState<GraphNode | null>(null);

  const tasks = tasksData?.tasks ?? [];

  const addLink = async (taskId: string, dependsOnId: string) => {
    try {
      await postJson('/api/tasks/links', { taskId, dependsOnId });
      toast({ title: 'Dependency added' });
      refreshGraph();
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  };
  const removeLink = async (taskId: string, dependsOnId: string) => {
    await deleteJson('/api/tasks/links', { taskId, dependsOnId });
    toast({ title: 'Dependency removed' });
    refreshGraph();
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Task Dependency Graph"
        icon={GitBranch}
        accent={JARVIS.colors.violet}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="jarvis-btn-accent border-0" onClick={() => setLinkOpen(true)}>
              <Link2 className="h-3.5 w-3.5 mr-1" /> Add Link
            </Button>
            <Button size="sm" variant="outline" onClick={refreshGraph} className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)]">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Tasks" value={graph?.stats.tasks ?? 0} icon={GitBranch} accent={JARVIS.colors.cyan} />
        <StatCard label="Dependencies" value={graph?.stats.links ?? 0} icon={Link2} accent={JARVIS.colors.violet} />
        <StatCard label="Blocked" value={graph?.stats.blocked ?? 0} icon={Lock} accent={JARVIS.colors.amber} />
        <StatCard label="Ready" value={graph?.stats.ready ?? 0} icon={CheckCircle2} accent={JARVIS.colors.green} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Graph */}
        <div className="lg:col-span-2 jarvis-panel p-4">
          <SectionTitle title="Dependency DAG" icon={GitBranch} accent={JARVIS.colors.violet} action={<span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">click a node for details</span>} />
          {loading && !graph ? (
            <div className="h-[440px] flex items-center justify-center">
              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] animate-pulse">building DAG…</div>
            </div>
          ) : (graph?.nodes?.length ?? 0) > 0 ? (
            <>
              <ForceGraph
                nodes={graph!.nodes}
                edges={graph!.edges}
                height={440}
                emptyMessage="No tasks"
                onNodeClick={(n) => setSelected(n)}
              />
              <GraphLegend
                items={[
                  { label: 'pending', color: STATUS_COLORS.pending },
                  { label: 'in_progress', color: STATUS_COLORS.in_progress },
                  { label: 'completed', color: STATUS_COLORS.completed },
                  { label: 'failed', color: STATUS_COLORS.failed },
                ]}
              />
            </>
          ) : (
            <EmptyState icon={GitBranch} message="No tasks to graph" />
          )}
        </div>

        {/* Selected node detail / link list */}
        <div className="jarvis-panel p-4">
          <SectionTitle title={selected ? 'Task Detail' : 'Dependencies'} icon={Link2} accent={JARVIS.colors.amber} />
          {selected ? (
            <NodeDetail node={selected} graph={graph} onRemove={removeLink} onClose={() => setSelected(null)} />
          ) : (
            <div className="space-y-2 max-h-[440px] overflow-y-auto jarvis-scroll">
              {graph && graph.edges.length > 0 ? (
                graph.edges.map((e, i) => {
                  const src = graph.nodes.find((n) => n.id === e.source);
                  const tgt = graph.nodes.find((n) => n.id === e.target);
                  if (!src || !tgt) return null;
                  return (
                    <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }} className="flex items-center gap-2 p-2 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]/40">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: src.color }} />
                      <span className="text-xs text-[var(--j-text-dim)] truncate flex-1">{src.label}</span>
                      <ArrowRight className="h-3 w-3 text-[var(--j-violet)] shrink-0" />
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: tgt.color }} />
                      <span className="text-xs text-[var(--j-text)] truncate flex-1">{tgt.label}</span>
                      <button onClick={() => removeLink(tgt.id, src.id)} className="text-[var(--j-text-mute)] hover:text-[var(--j-red)] p-1 shrink-0" title="Remove dependency">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </motion.div>
                  );
                })
              ) : (
                <div className="text-center py-8">
                  <Link2 className="h-8 w-8 mx-auto mb-2 text-[var(--j-text-mute)] opacity-40" />
                  <div className="text-xs text-[var(--j-text-mute)]">No dependencies yet</div>
                  <div className="jarvis-mono text-[10px] text-[var(--j-text-mute)] mt-1">click "Add Link" to connect tasks</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {linkOpen && <AddLinkModal tasks={tasks} onClose={() => setLinkOpen(false)} onAdd={(t, d) => { addLink(t, d); setLinkOpen(false); }} />}
      </AnimatePresence>
    </div>
  );
}

function NodeDetail({ node, graph, onRemove, onClose }: { node: GraphNode; graph: GraphData | null; onRemove: (taskId: string, dependsOnId: string) => void; onClose: () => void }) {
  const incoming = graph?.edges.filter((e) => e.target === node.id) ?? []; // who blocks me
  const outgoing = graph?.edges.filter((e) => e.source === node.id) ?? []; // who I block
  const meta = node.meta as { status: string; priority: string; priorityColor: string; assignee?: string | null; progress: number; fullTitle: string };
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: node.color, boxShadow: `0 0 8px ${node.color}` }} />
            <Pill color={node.color}>{meta.status}</Pill>
            <span className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded" style={{ color: meta.priorityColor, background: `${meta.priorityColor}1a`, border: `1px solid ${meta.priorityColor}33` }}>{meta.priority}</span>
          </div>
          <div className="text-sm text-[var(--j-text)]">{meta.fullTitle}</div>
          {meta.assignee && <div className="jarvis-mono text-[10px] text-[var(--j-cyan)] mt-0.5">{meta.assignee}</div>}
        </div>
        <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
      </div>

      {meta.status === 'in_progress' && (
        <div className="h-1.5 rounded-full bg-[var(--j-border)] overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${meta.progress}%`, background: node.color }} />
        </div>
      )}

      <div>
        <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1.5 flex items-center gap-1"><Lock className="h-2.5 w-2.5" /> blocked by ({incoming.length})</div>
        {incoming.length ? (
          <div className="space-y-1">
            {incoming.map((e, i) => {
              const src = graph?.nodes.find((n) => n.id === e.source);
              if (!src) return null;
              return (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: src.color }} />
                  <span className="text-[var(--j-text-dim)] truncate flex-1">{src.label}</span>
                  <button onClick={() => onRemove(node.id, src.id)} className="text-[var(--j-text-mute)] hover:text-[var(--j-red)]"><Trash2 className="h-3 w-3" /></button>
                </div>
              );
            })}
          </div>
        ) : <div className="text-[10px] text-[var(--j-text-mute)]">no blockers</div>}
      </div>

      <div>
        <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1.5 flex items-center gap-1"><ArrowRight className="h-2.5 w-2.5" /> blocks ({outgoing.length})</div>
        {outgoing.length ? (
          <div className="space-y-1">
            {outgoing.map((e, i) => {
              const tgt = graph?.nodes.find((n) => n.id === e.target);
              if (!tgt) return null;
              return (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: tgt.color }} />
                  <span className="text-[var(--j-text-dim)] truncate flex-1">{tgt.label}</span>
                  <button onClick={() => onRemove(tgt.id, node.id)} className="text-[var(--j-text-mute)] hover:text-[var(--j-red)]"><Trash2 className="h-3 w-3" /></button>
                </div>
              );
            })}
          </div>
        ) : <div className="text-[10px] text-[var(--j-text-mute)]">blocks nothing</div>}
      </div>
    </div>
  );
}

function AddLinkModal({ tasks, onClose, onAdd }: { tasks: TaskLite[]; onClose: () => void; onAdd: (taskId: string, dependsOnId: string) => void }) {
  const [taskId, setTaskId] = useState('');
  const [dependsOnId, setDependsOnId] = useState('');
  const valid = taskId && dependsOnId && taskId !== dependsOnId;

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-md jarvis-panel p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="jarvis-mono text-sm uppercase text-[var(--j-violet)]">Add Dependency</h3>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Task (the one that's blocked)</label>
            <Select value={taskId} onValueChange={setTaskId}>
              <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue placeholder="Select a task…" /></SelectTrigger>
              <SelectContent>{tasks.map((t) => <SelectItem key={t.id} value={t.id}>{t.title.slice(0, 50)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex justify-center"><ArrowRight className="h-4 w-4 text-[var(--j-violet)] rotate-90" /></div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Depends on (the blocker)</label>
            <Select value={dependsOnId} onValueChange={setDependsOnId}>
              <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue placeholder="Select a blocker…" /></SelectTrigger>
              <SelectContent>{tasks.filter((t) => t.id !== taskId).map((t) => <SelectItem key={t.id} value={t.id}>{t.title.slice(0, 50)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={() => valid && onAdd(taskId, dependsOnId)} disabled={!valid} className="w-full jarvis-btn-accent border-0">
            <Link2 className="h-3.5 w-3.5 mr-1.5" /> Add Dependency
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
