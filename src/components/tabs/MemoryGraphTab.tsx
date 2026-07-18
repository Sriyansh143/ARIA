'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Network, Database, Tag, Pin, RefreshCw, X, Hash, Search } from 'lucide-react';
import { useApi } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, EmptyState, Pill } from '@/components/jarvis/shared';
import { ForceGraph, GraphLegend, type GraphNode, type GraphEdge } from '@/components/jarvis/ForceGraph';

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { items: number; tags: number; edges: number; pinned: number };
}

const SCOPE_COLORS: Record<string, string> = {
  semantic: '#7DD3FC',
  episodic: '#C4B5FD',
  working: '#FBBF24',
  conversation: '#34D399',
};

export default function MemoryGraphTab() {
  const { data, loading, refresh } = useApi<GraphData>('/api/memory/graph', 30000);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [scopeFilter, setScopeFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  // Collect available tags from tag nodes.
  const allTags = useMemo(() => {
    const tags: string[] = [];
    for (const n of data?.nodes ?? []) {
      if (n.type === 'tag') tags.push(n.label.replace(/^#/, ''));
    }
    return tags.sort();
  }, [data]);

  // Filter nodes + edges by scope/tag/search.
  const { nodes, edges, matchIds } = useMemo(() => {
    if (!data) return { nodes: [], edges: [], matchIds: new Set<string>() };
    const ql = search.trim().toLowerCase();
    // Determine which memory-item node ids pass the filter.
    const keepIds = new Set<string>();
    const matchIds = new Set<string>();
    for (const n of data.nodes) {
      if (n.type === 'tag') {
        // Keep a tag node if tagFilter matches or if it's connected to a kept item.
        if (tagFilter === 'all' || n.label === `#${tagFilter}`) keepIds.add(n.id);
        continue;
      }
      // Memory item node.
      if (scopeFilter !== 'all' && n.type !== scopeFilter) continue;
      keepIds.add(n.id);
      // Search match highlighting.
      if (ql) {
        const meta = n.meta as { value?: string };
        const hay = `${n.label} ${meta?.value ?? ''}`.toLowerCase();
        if (hay.includes(ql)) matchIds.add(n.id);
      }
    }
    // Second pass: keep tags connected to kept items (when tagFilter is 'all').
    if (tagFilter === 'all') {
      for (const e of data.edges) {
        if (keepIds.has(e.source) && e.target.startsWith('tag-')) keepIds.add(e.target);
        if (keepIds.has(e.target) && e.source.startsWith('tag-')) keepIds.add(e.source);
      }
    }
    const fNodes = data.nodes.filter((n) => keepIds.has(n.id));
    const fEdges = data.edges.filter((e) => keepIds.has(e.source) && keepIds.has(e.target));
    return { nodes: fNodes, edges: fEdges, matchIds };
  }, [data, scopeFilter, tagFilter, search]);

  // Type counts for legend (from unfiltered data).
  const typeCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of data?.nodes ?? []) m[n.type] = (m[n.type] ?? 0) + 1;
    return m;
  }, [data]);

  const hasFilter = scopeFilter !== 'all' || tagFilter !== 'all' || search.trim() !== '';

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Memory Graph"
        icon={Network}
        accent={JARVIS.colors.violet}
        action={
          <button onClick={refresh} className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)]">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Memory Items" value={data?.stats.items ?? 0} icon={Database} accent={JARVIS.colors.cyan} />
        <StatCard label="Tags" value={data?.stats.tags ?? 0} icon={Tag} accent={JARVIS.colors.green} />
        <StatCard label="Edges" value={data?.stats.edges ?? 0} icon={Network} accent={JARVIS.colors.amber} />
        <StatCard label="Pinned" value={data?.stats.pinned ?? 0} icon={Pin} accent={JARVIS.colors.violet} />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex items-center gap-2">
          <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">scope:</span>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip label="all" active={scopeFilter === 'all'} onClick={() => setScopeFilter('all')} />
            {Object.entries(SCOPE_COLORS).map(([s, c]) => (
              <FilterChip key={s} label={s} color={c} active={scopeFilter === s} onClick={() => setScopeFilter(s)} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">tag:</span>
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="jarvis-mono text-xs px-2.5 py-1.5 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text)] outline-none focus:border-[var(--j-violet)]"
          >
            <option value="all">all tags</option>
            {allTags.map((t) => <option key={t} value={t}>#{t}</option>)}
          </select>
          {hasFilter && (
            <button onClick={() => { setScopeFilter('all'); setTagFilter('all'); }} className="jarvis-mono text-[9px] uppercase text-[var(--j-cyan)] hover:underline">clear</button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--j-text-mute)]" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search memory items by key or content — matches highlight in the graph…"
          className="w-full pl-9 pr-3 py-2 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-sm text-[var(--j-text)] placeholder:text-[var(--j-text-mute)] outline-none focus:border-[var(--j-violet)]"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--j-text-mute)] hover:text-[var(--j-text)]">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Graph */}
        <div className="lg:col-span-2 jarvis-panel p-4">
          <SectionTitle title="Knowledge Network" icon={Network} accent={JARVIS.colors.violet} action={<span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{hasFilter ? `${nodes.length} shown` : 'click a node for details'}</span>} />
          {loading && !data ? (
            <div className="h-[460px] flex items-center justify-center">
              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] animate-pulse">building graph…</div>
            </div>
          ) : nodes.length > 0 ? (
            <>
              <ForceGraph nodes={nodes} edges={edges} height={460} emptyMessage="No memory to graph" onNodeClick={(n) => setSelected(n)} highlightIds={matchIds} />
              <GraphLegend
                items={[
                  { label: 'semantic', color: SCOPE_COLORS.semantic },
                  { label: 'episodic', color: SCOPE_COLORS.episodic },
                  { label: 'working', color: SCOPE_COLORS.working },
                  { label: 'conversation', color: SCOPE_COLORS.conversation },
                  { label: 'tag', color: '#38BDF8' },
                ]}
              />
            </>
          ) : (
            <EmptyState icon={Network} message={hasFilter ? 'No items match the filter' : 'No memory items to graph'} />
          )}
        </div>

        {/* Selected node detail */}
        <div className="jarvis-panel p-4">
          <SectionTitle title={selected ? 'Node Detail' : 'Tip'} icon={Tag} accent={JARVIS.colors.cyan} />
          <AnimatePresence mode="wait">
            {selected ? (
              <motion.div key={selected.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <NodeDetailPanel node={selected} edges={edges} nodes={nodes} onClose={() => setSelected(null)} />
              </motion.div>
            ) : (
              <motion.div key="tip" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center py-10">
                <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-xl mb-3" style={{ background: `${JARVIS.colors.violet}1a`, border: `1px solid ${JARVIS.colors.violet}33`, color: JARVIS.colors.violet }}>
                  <Network className="h-6 w-6" />
                </div>
                <div className="text-sm text-[var(--j-text-dim)]">Click any node to inspect it</div>
                <div className="jarvis-mono text-[10px] text-[var(--j-text-mute)] mt-1">drag to rearrange · hover to highlight</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Scope breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(SCOPE_COLORS).map(([scope, color]) => (
          <motion.button
            key={scope}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => setScopeFilter(scopeFilter === scope ? 'all' : scope)}
            className={`jarvis-panel p-3 flex items-center gap-3 transition-all ${scopeFilter === scope ? 'jarvis-card-hover' : ''}`}
            style={scopeFilter === scope ? { borderColor: color, boxShadow: `0 0 0 1px ${color}55` } : undefined}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${color}1a`, border: `1px solid ${color}33`, color }}>
              <Database className="h-4 w-4" />
            </div>
            <div className="text-left">
              <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{scope}</div>
              <div className="text-lg font-semibold" style={{ color }}>{typeCounts[scope] ?? 0}</div>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function FilterChip({ label, color, active, onClick }: { label: string; color?: string; active: boolean; onClick: () => void }) {
  const c = color ?? JARVIS.colors.textDim;
  return (
    <button
      onClick={onClick}
      className="jarvis-mono text-[10px] uppercase px-2.5 py-1 rounded-md border transition-colors flex items-center gap-1.5"
      style={active ? { background: `${c}1a`, borderColor: c, color: c } : { borderColor: 'var(--j-border)', color: 'var(--j-text-dim)' }}
    >
      {color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />}
      {label}
    </button>
  );
}

function NodeDetailPanel({ node, edges, nodes, onClose }: { node: GraphNode; edges: GraphEdge[]; nodes: GraphNode[]; onClose: () => void }) {
  const isTag = node.type === 'tag';
  const meta = node.meta as { scope?: string; pinned?: boolean; value?: string; count?: number };
  // Connected nodes.
  const connected = edges.filter((e) => e.source === node.id || e.target === node.id);
  const connectedIds = new Set<string>();
  for (const e of connected) { connectedIds.add(e.source); connectedIds.add(e.target); }
  connectedIds.delete(node.id);
  const connectedNodes = nodes.filter((n) => connectedIds.has(n.id));

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: node.color, boxShadow: `0 0 8px ${node.color}` }} />
            {isTag ? <Pill color="#38BDF8">tag</Pill> : <Pill color={node.color}>{meta.scope ?? node.type}</Pill>}
            {meta.pinned && <Pin className="h-3 w-3 text-[var(--j-violet)] fill-[var(--j-violet)]" />}
          </div>
          <div className="text-sm font-medium text-[var(--j-text)] break-all">{node.label}</div>
          {isTag && meta.count != null && <div className="jarvis-mono text-[10px] text-[var(--j-text-mute)] mt-0.5">{meta.count} item{meta.count !== 1 ? 's' : ''}</div>}
        </div>
        <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
      </div>

      {!isTag && meta.value && (
        <div className="p-3 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]/40">
          <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1">value</div>
          <div className="text-xs text-[var(--j-text-dim)] leading-relaxed">{meta.value}</div>
        </div>
      )}

      <div>
        <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1.5">connected ({connectedNodes.length})</div>
        <div className="space-y-1 max-h-40 overflow-y-auto jarvis-scroll">
          {connectedNodes.length ? connectedNodes.slice(0, 12).map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-xs">
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: c.color }} />
              <span className="text-[var(--j-text-dim)] truncate">{c.label}</span>
              <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] ml-auto shrink-0">{c.type}</span>
            </div>
          )) : <div className="text-[10px] text-[var(--j-text-mute)]">no connections</div>}
        </div>
      </div>
    </div>
  );
}
