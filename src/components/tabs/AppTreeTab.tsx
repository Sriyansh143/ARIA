'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderArchive, Folder, FileText, ChevronRight, ChevronDown, X, FileCode } from 'lucide-react';
import { postJson } from '@/lib/hooks/use-api';
import { useApi } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';

interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size?: number;
  children?: TreeNode[];
}

interface FilePreview {
  path: string;
  size: number;
  lines: string[];
  totalLines: number;
  truncated: boolean;
}

function formatSize(bytes?: number): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function AppTreeTab() {
  const { data, loading } = useApi<{ tree: TreeNode; root: string }>('/api/apptree', 60000);
  const tree = data?.tree;
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [busyPreview, setBusyPreview] = useState(false);
  const { toast } = useToast();

  // Count files + dirs.
  const counts = useMemo(() => {
    let files = 0;
    let dirs = 0;
    const walk = (n: TreeNode) => {
      if (n.type === 'file') files += 1;
      else dirs += 1;
      n.children?.forEach(walk);
    };
    if (tree) walk(tree);
    return { files, dirs };
  }, [tree]);

  const openFile = useCallback(async (node: TreeNode) => {
    setSelected(node);
    setBusyPreview(true);
    setPreview(null);
    try {
      const res = await postJson<FilePreview>('/api/apptree', { file: node.path });
      setPreview(res);
    } catch (e) {
      toast({ title: 'Preview failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusyPreview(false);
    }
  }, [toast]);

  return (
    <div className="space-y-4">
      <SectionTitle title="App Tree — Project Browser" icon={FolderArchive} accent={JARVIS.colors.cyan} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Root" value={data?.root ?? '—'} icon={Folder} accent={JARVIS.colors.cyan} />
        <StatCard label="Directories" value={counts.dirs} icon={Folder} accent={JARVIS.colors.violet} />
        <StatCard label="Files" value={counts.files} icon={FileText} accent={JARVIS.colors.green} />
        <StatCard
          label="Total Size"
          value={formatSize(sumSize(tree))}
          icon={FileCode}
          accent={JARVIS.colors.amber}
        />
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="jarvis-panel h-96 animate-pulse" />)}
        </div>
      ) : !tree ? (
        <EmptyState icon={FolderArchive} message="No project files found" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="jarvis-panel p-4 max-h-[600px] overflow-y-auto jarvis-scroll">
            <div className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text)] mb-3 pb-2 border-b border-[var(--j-border-soft)]">
              File Tree
            </div>
            <TreeList node={tree} depth={0} selected={selected} onSelect={openFile} />
          </div>

          <div className="jarvis-panel p-4 max-h-[600px] overflow-y-auto jarvis-scroll">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-[var(--j-border-soft)]">
              <div className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text)]">
                {selected ? 'Preview' : 'Select a file'}
              </div>
              {selected && (
                <button onClick={() => { setSelected(null); setPreview(null); }} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {!selected ? (
              <EmptyState icon={FileText} message="Click a file to preview its first 20 lines" />
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="jarvis-mono text-xs text-[var(--j-cyan)] break-all">{selected.path}</div>
                  <div className="jarvis-mono text-[10px] text-[var(--j-text-mute)] mt-1">
                    {formatSize(selected.size)} {preview ? `· ${preview.totalLines} lines` : ''}
                  </div>
                </div>
                {busyPreview ? (
                  <div className="h-32 animate-pulse rounded-md bg-[var(--j-panel-soft)]" />
                ) : preview ? (
                  <pre className="text-[11px] leading-relaxed text-[var(--j-text-dim)] bg-[var(--j-panel-soft)] p-3 rounded-md border border-[var(--j-border-soft)] overflow-x-auto jarvis-mono">
                    {preview.lines.map((l, i) => (
                      <div key={i} className="flex">
                        <span className="text-[var(--j-text-mute)] mr-3 select-none w-8 text-right">{i + 1}</span>
                        <span className="whitespace-pre-wrap break-all flex-1">{l}</span>
                      </div>
                    ))}
                  </pre>
                ) : null}
                {preview?.truncated && (
                  <div className="jarvis-mono text-[10px] text-[var(--j-text-mute)] text-center">
                    … truncated (showing first 20 of {preview.totalLines} lines)
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function sumSize(node?: TreeNode): number {
  if (!node) return 0;
  if (node.type === 'file') return node.size ?? 0;
  return (node.children ?? []).reduce((s, c) => s + sumSize(c), 0);
}

function TreeList({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: TreeNode | null;
  onSelect: (n: TreeNode) => void;
}) {
  if (node.type === 'file') {
    const isSelected = selected?.path === node.path;
    return (
      <button
        onClick={() => onSelect(node)}
        className={`w-full text-left flex items-center gap-2 py-1 px-2 rounded-md text-xs transition-colors ${isSelected ? 'bg-[var(--j-cyan)]/10 text-[var(--j-cyan)]' : 'text-[var(--j-text-dim)] hover:text-[var(--j-text)] hover:bg-[var(--j-panel-soft)]'}`}
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        <FileText className="h-3 w-3 shrink-0 opacity-70" />
        <span className="truncate flex-1">{node.name}</span>
        <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">{formatSize(node.size)}</span>
      </button>
    );
  }

  return <DirList node={node} depth={depth} selected={selected} onSelect={onSelect} />;
}

function DirList({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: TreeNode | null;
  onSelect: (n: TreeNode) => void;
}) {
  const [open, setOpen] = useState(depth < 2); // auto-expand top 2 levels
  const hasChildren = (node.children?.length ?? 0) > 0;
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left flex items-center gap-2 py-1 px-2 rounded-md text-xs text-[var(--j-text)] hover:bg-[var(--j-panel-soft)] transition-colors"
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {hasChildren ? (
          open ? <ChevronDown className="h-3 w-3 shrink-0 text-[var(--j-text-mute)]" /> : <ChevronRight className="h-3 w-3 shrink-0 text-[var(--j-text-mute)]" />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <Folder className="h-3 w-3 shrink-0" style={{ color: JARVIS.colors.violet }} />
        <span className="truncate flex-1">{node.name || '/'}</span>
        <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">{node.children?.length ?? 0}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && hasChildren && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {node.children!.map((child) => (
              <TreeList key={child.path} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
