'use client';

/**
 * ProjectPicker.tsx — choose / create / delete an IDE project.
 */

import { useEffect, useState } from 'react';
import { ChevronDown, Plus, Trash2, FolderGit2, Loader2 } from 'lucide-react';
import type { ProjectSummary } from '@/lib/ide';
import { JARVIS } from '@/lib/config';
import { useApi, postJson, deleteJson } from '@/lib/hooks/use-api';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Props {
  activeId: string | null;
  onPick: (p: ProjectSummary) => void;
}

export default function ProjectPicker({ activeId, onPick }: Props) {
  const { data, loading, refresh } = useApi<{ projects: ProjectSummary[] }>('/api/ide/projects', 0);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [framework, setFramework] = useState('');
  const { toast } = useToast();

  useEffect(() => { refresh(); }, []);

  const active = data?.projects?.find((p) => p.id === activeId);

  const create = async () => {
    if (!name || !rootPath) return;
    setCreating(true);
    try {
      const r = await postJson<{ project: ProjectSummary }>('/api/ide/projects', {
        name, rootPath, framework: framework || undefined,
      });
      toast({ title: 'Project created', description: r.project.name });
      setOpen(false);
      setName(''); setRootPath(''); setFramework('');
      refresh();
      onPick(r.project);
    } catch (e) {
      toast({ title: 'Create failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const del = async (id: string) => {
    if (!confirm('Delete this project? Files on disk are NOT removed.')) return;
    try {
      await deleteJson(`/api/ide/projects/${id}`);
      toast({ title: 'Project deleted' });
      refresh();
      if (id === activeId) onPick({} as ProjectSummary);
    } catch (e) {
      toast({ title: 'Delete failed', variant: 'destructive' });
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-[var(--j-border)] bg-[var(--j-panel)] hover:bg-[var(--j-panel-soft)] min-w-[200px]"
      >
        <FolderGit2 className="h-3.5 w-3.5" style={{ color: JARVIS.colors.cyan }} />
        <div className="flex-1 text-left min-w-0">
          <div className="text-xs jarvis-mono text-[var(--j-text)] truncate">
            {active?.name ?? (loading ? 'Loading…' : 'No project')}
          </div>
          {active && (
            <div className="text-[9px] jarvis-mono text-[var(--j-text-mute)] truncate">
              {active.gitBranch || 'no git'} • {active.fileCount} files
            </div>
          )}
        </div>
        <ChevronDown className="h-3 w-3 text-[var(--j-text-mute)]" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-50 w-[360px] rounded-md border border-[var(--j-border)] bg-[var(--j-panel)] shadow-xl">
            <div className="max-h-[280px] overflow-y-auto py-1">
              {data?.projects?.length === 0 && !creating && (
                <div className="text-center py-6 text-[10px] jarvis-mono text-[var(--j-text-mute)]">No projects yet</div>
              )}
              {data?.projects?.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    'group flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--j-panel-soft)]',
                    p.id === activeId && 'bg-[var(--j-cyan)]/10',
                  )}
                  onClick={() => { onPick(p); setOpen(false); }}
                >
                  <FolderGit2 className="h-3 w-3 shrink-0" style={{ color: JARVIS.colors.cyan }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs jarvis-mono text-[var(--j-text)] truncate">{p.name}</div>
                    <div className="text-[10px] jarvis-mono text-[var(--j-text-mute)] truncate">
                      {p.framework ?? '—'} • {p.fileCount} files • {p.language}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); del(p.id); }}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--j-panel)] text-[var(--j-text-mute)] hover:text-[var(--j-red)]"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="border-t border-[var(--j-border)] p-2">
              {!creating ? (
                <button
                  onClick={() => setCreating(true)}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded border border-dashed border-[var(--j-border)] text-xs jarvis-mono text-[var(--j-cyan)] hover:bg-[var(--j-panel-soft)]"
                >
                  <Plus className="h-3 w-3" /> New Project
                </button>
              ) : (
                <div className="space-y-2">
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Project name"
                    className="w-full bg-transparent border border-[var(--j-border)] rounded px-2 py-1.5 text-xs jarvis-mono text-[var(--j-text)] placeholder:text-[var(--j-text-mute)] outline-none focus:border-[var(--j-cyan)]"
                  />
                  <input
                    value={rootPath}
                    onChange={(e) => setRootPath(e.target.value)}
                    placeholder="Root path (e.g. myapp or /abs/path)"
                    className="w-full bg-transparent border border-[var(--j-border)] rounded px-2 py-1.5 text-xs jarvis-mono text-[var(--j-text)] placeholder:text-[var(--j-text-mute)] outline-none focus:border-[var(--j-cyan)]"
                  />
                  <select
                    value={framework}
                    onChange={(e) => setFramework(e.target.value)}
                    className="w-full bg-transparent border border-[var(--j-border)] rounded px-2 py-1.5 text-xs jarvis-mono text-[var(--j-text)] outline-none focus:border-[var(--j-cyan)]"
                  >
                    <option value="" className="bg-[var(--j-panel)]">Auto-detect</option>
                    <option value="nextjs" className="bg-[var(--j-panel)]">Next.js</option>
                    <option value="react" className="bg-[var(--j-panel)]">React</option>
                    <option value="node" className="bg-[var(--j-panel)]">Node</option>
                    <option value="python" className="bg-[var(--j-panel)]">Python</option>
                    <option value="go" className="bg-[var(--j-panel)]">Go</option>
                    <option value="rust" className="bg-[var(--j-panel)]">Rust</option>
                  </select>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={create}
                      disabled={creating || !name || !rootPath}
                      className="flex-1 jarvis-mono text-[10px] uppercase px-2 py-1.5 rounded border disabled:opacity-50"
                      style={{ borderColor: `${JARVIS.colors.cyan}40`, color: JARVIS.colors.cyan, background: `${JARVIS.colors.cyan}10` }}
                    >
                      {creating ? <Loader2 className="h-3 w-3 animate-spin mx-auto" /> : 'Create'}
                    </button>
                    <button
                      onClick={() => { setCreating(false); setName(''); setRootPath(''); setFramework(''); }}
                      className="jarvis-mono text-[10px] uppercase px-2 py-1.5 rounded border border-[var(--j-border)] text-[var(--j-text-mute)] hover:bg-[var(--j-panel-soft)]"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="text-[10px] jarvis-mono text-[var(--j-text-mute)]">
                    Path is resolved inside the workspace root. Existing files will be scanned.
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
