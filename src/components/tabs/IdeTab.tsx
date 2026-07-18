'use client';

/**
 * IdeTab.tsx — the JARVIS IDE tab.
 *
 * VS Code-style layout: project picker + breadcrumb top bar, resizable file
 * tree on the left, multi-tab editor in the center, toggleable outline /
 * problems / git-diff panel on the right, toggleable search-results /
 * terminal dock on the bottom, command palette overlay, settings dialog,
 * and a status bar at the very bottom.
 *
 * 30+ features (see worklog):
 *   1  Multi-file tabs (open/close/switch/drag-reorder)
 *   2  File tree with folders
 *   3  File icons by extension
 *   4  Git status indicators in tree
 *   5  Dirty indicator
 *   6  Save (Ctrl+S) — disk + DB
 *   7  Auto-save (30s if dirty)
 *   8  New file / new folder
 *   9  Rename file
 *   10 Delete file
 *   11 Search across files (Ctrl+Shift+F)
 *   12 Search results panel with click-to-jump
 *   13 Find in file (Ctrl+F)
 *   14 Find & replace (Ctrl+H)
 *   15 Go to line (Ctrl+G)
 *   16 Command palette (Ctrl+Shift+P)
 *   17 Quick open file (Ctrl+P)
 *   18 Outline panel (symbols)
 *   19 Problems panel (lint errors)
 *   20 Git status bar (branch name)
 *   21 Git diff viewer
 *   22 Syntax highlighting (lightweight regex)
 *   23 Line numbers gutter
 *   24 Cursor position in status bar
 *   25 Word wrap toggle
 *   26 Font size +/- controls
 *   27 Theme toggle
 *   28 Minimap toggle
 *   29 Tab size (2/4/8)
 *   30 Format on save toggle
 *   31 Terminal dock (bottom panel)
 *   32 Right-click context menu on file tree
 *   33 Drag-reorder file tabs
 *   34 Keyboard shortcuts overlay (?)
 *   35 Settings panel
 *   36 Session restore (open tabs + cursor)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Code2, Settings as SettingsIcon, Search as SearchIcon, ListTree, AlertTriangle,
  GitBranch, Terminal as TerminalIcon, Keyboard,
  Sun, Moon, RefreshCw, X,
  ChevronRight, Folder,
} from 'lucide-react';
import { JARVIS } from '@/lib/config';
import { useApi, postJson, deleteJson, patchJson } from '@/lib/hooks/use-api';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { ProjectSummary, FileMeta, FileWithContent, GitStatusInfo, ProblemItem } from '@/lib/ide';
import FileTree from '@/components/ide/FileTree';
import EditorPane, { type OpenTab } from '@/components/ide/EditorPane';
import CommandPalette, { type CommandDef } from '@/components/ide/CommandPalette';
import SettingsDialog, { type IdeSettings } from '@/components/ide/SettingsDialog';
import ProjectPicker from '@/components/ide/ProjectPicker';
import {
  OutlinePanel, ProblemsPanel, GitDiffPanel,
  SearchResultsPanel, TerminalDock, type SearchHit,
} from '@/components/ide/Panels';

type RightPanel = 'outline' | 'problems' | 'git' | null;
type BottomPanel = 'search' | 'terminal' | null;

export default function IdeTab() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const { data: projectData, loading: projectLoading, refresh: refreshProject } = useApi<{ project: ProjectSummary & { files: FileMeta[] } }>(
    projectId ? `/api/ide/projects/${projectId}` : null,
    0,
  );

  // Git status (polls every 30s when project is set)
  const { data: gitData, refresh: refreshGit } = useApi<{ status: GitStatusInfo }>(
    projectId ? `/api/ide/git/status?projectId=${projectId}` : null,
    30000,
  );

  const files = projectData?.project?.files ?? [];
  const project = projectData?.project;

  // ── Open tabs ──
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // ── Settings ──
  const [settings, setSettings] = useState<IdeSettings>({
    theme: 'jarvis-dark',
    fontSize: 13,
    tabSize: 2,
    wordWrap: false,
    minimap: true,
    autoSave: true,
    formatOnSave: true,
    linting: true,
  });

  // ── Panel state ──
  const [rightPanel, setRightPanel] = useState<RightPanel>('outline');
  const [bottomPanel, setBottomPanel] = useState<BottomPanel>(null);
  const [paletteMode, setPaletteMode] = useState<'files' | 'commands' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpts, setSearchOpts] = useState({ useRegex: false, caseSensitive: false, filePattern: '' });
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

  const { toast } = useToast();
  const autosaveTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionId = useRef<string | null>(null);

  // ── Apply settings from project ──
  useEffect(() => {
    if (project) {
      setSettings({
        theme: project.theme ?? 'jarvis-dark',
        fontSize: project.fontSize ?? 13,
        tabSize: project.tabSize ?? 2,
        wordWrap: project.wordWrap ?? false,
        minimap: project.minimap ?? true,
        autoSave: project.autoSave ?? true,
        formatOnSave: project.formatOnSave ?? true,
        linting: project.linting ?? true,
      });
    }
  }, [projectId]);

  // ── Persist settings ──
  const persistSettings = useCallback(async (next: IdeSettings) => {
    setSettings(next);
    if (!projectId) return;
    try {
      await patchJson(`/api/ide/projects/${projectId}`, next);
    } catch { /* silent */ }
  }, [projectId]);

  // ── Restore session on project load ──
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ide/sessions?projectId=${projectId}`);
        const data = await res.json();
        const sessions: Array<{ openTabs: string[]; activeTabId: string | null }> = data.sessions ?? [];
        if (sessions.length > 0 && !cancelled) {
          const s = sessions[0];
          sessionId.current = (data.sessions as Array<{ id: string }>)[0]?.id ?? null;
          if (s.openTabs?.length) {
            for (const fid of s.openTabs) {
              try {
                const fr = await fetch(`/api/ide/files/${fid}`);
                const fd = await fr.json();
                if (fd.file && !cancelled) {
                  setTabs((prev) => prev.some((t) => t.file.id === fid) ? prev : [...prev, { file: fd.file as FileWithContent, draft: (fd.file as FileWithContent).content, scrollY: 0, cursorLine: 1, cursorCol: 1 }]);
                }
              } catch { /* ignore */ }
            }
            if (s.activeTabId && !cancelled) setActiveTabId(s.activeTabId);
          }
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // ── Save session periodically (session id is captured during restore) ──

  const saveSession = useCallback(() => {
    if (!sessionId.current) return;
    postJson('/api/ide/sessions', {
      sessionId: sessionId.current,
      openTabs: tabs.map((t) => t.file.id),
      activeTabId,
      cursor: activeTabId ? { fileId: activeTabId, line: cursor.line, col: cursor.col } : {},
    }).catch(() => {});
  }, [tabs, activeTabId, cursor]);

  useEffect(() => {
    const id = setInterval(saveSession, 15000);
    return () => clearInterval(id);
  }, [saveSession]);

  // ── Auto-save ──
  useEffect(() => {
    if (autosaveTimer.current) clearInterval(autosaveTimer.current);
    if (!settings.autoSave) return;
    autosaveTimer.current = setInterval(() => {
      tabs.forEach((t) => {
        if (t.draft !== t.file.content) {
          handleSave(t.file.id, /* silent */ true);
        }
      });
    }, 30000);
    return () => { if (autosaveTimer.current) clearInterval(autosaveTimer.current); };
  }, [settings.autoSave, tabs]);

  // ── File operations ──
  const openFile = useCallback(async (file: FileMeta) => {
    // already open?
    if (tabs.some((t) => t.file.id === file.id)) {
      setActiveTabId(file.id);
      return;
    }
    try {
      const res = await fetch(`/api/ide/files/${file.id}`);
      const data = await res.json();
      if (data.file) {
        const fw: FileWithContent = data.file;
        setTabs((prev) => [...prev, {
          file: fw,
          draft: fw.content,
          scrollY: 0,
          cursorLine: 1,
          cursorCol: 1,
        }]);
        setActiveTabId(fw.id);
      } else {
        toast({ title: data.error ?? 'Open failed', variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Open failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  }, [tabs, toast]);

  const openFileByPath = useCallback(async (path: string) => {
    if (!projectId) return;
    try {
      const r = await fetch('/api/ide/files', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, path }),
      });
      const data = await r.json();
      if (data.file) {
        const existing = files.find((f) => f.path === path);
        if (existing) {
          await openFile({ ...existing });
        } else {
          // file not in tree yet — refresh
          refreshProject();
          // open by id
          setTabs((prev) => prev.some((t) => t.file.id === data.file.id) ? prev : [...prev, { file: data.file, draft: data.file.content, scrollY: 0, cursorLine: 1, cursorCol: 1 }]);
          setActiveTabId(data.file.id);
        }
      } else {
        toast({ title: data.error ?? 'Open failed', variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Open failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  }, [projectId, files, openFile, refreshProject, toast]);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => prev.filter((t) => t.file.id !== id));
    setActiveTabId((curr) => {
      if (curr !== id) return curr;
      const remaining = tabs.filter((t) => t.file.id !== id);
      return remaining.length > 0 ? remaining[remaining.length - 1].file.id : null;
    });
  }, [tabs]);

  const handleDraftChange = useCallback((id: string, draft: string) => {
    setTabs((prev) => prev.map((t) => t.file.id === id ? { ...t, draft } : t));
  }, []);

  const handleSave = useCallback(async (id: string, silent = false) => {
    const tab = tabs.find((t) => t.file.id === id);
    if (!tab) return;
    // simple format-on-save: trim trailing whitespace per line
    let content = tab.draft;
    if (settings.formatOnSave) {
      content = content.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n');
    }
    try {
      const r = await fetch(`/api/ide/files/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await r.json();
      if (data.file) {
        setTabs((prev) => prev.map((t) => t.file.id === id ? { ...t, file: { ...data.file, content: data.file.content }, draft: data.file.content } : t));
        if (!silent) toast({ title: 'Saved', description: tab.file.path });
        refreshProject();
      } else {
        if (!silent) toast({ title: data.error ?? 'Save failed', variant: 'destructive' });
      }
    } catch (e) {
      if (!silent) toast({ title: 'Save failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  }, [tabs, settings.formatOnSave, toast, refreshProject]);

  const reorderTabs = useCallback((from: number, to: number) => {
    setTabs((prev) => {
      const next = [...prev];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
  }, []);

  // ── File tree actions ──
  const [newFileDialog, setNewFileDialog] = useState<{ dir: string } | null>(null);
  const [newFolderDialog, setNewFolderDialog] = useState<{ dir: string } | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ file: FileMeta } | null>(null);

  const createFile = async (path: string, content = '') => {
    if (!projectId) return;
    try {
      const r = await postJson<{ file: FileWithContent }>('/api/ide/files', { projectId, path, content });
      toast({ title: 'File created', description: path });
      refreshProject();
      await openFile(r.file);
    } catch (e) {
      toast({ title: 'Create failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  };

  const createFolder = async (path: string) => {
    if (!projectId) return;
    try {
      await postJson('/api/ide/files', { projectId, path, folder: true });
      toast({ title: 'Folder created', description: path });
      refreshProject();
    } catch (e) {
      toast({ title: 'Create folder failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  };

  const renameFile = async (file: FileMeta, newPath: string) => {
    try {
      await patchJson(`/api/ide/files/${file.id}`, { newPath });
      toast({ title: 'Renamed', description: `${file.path} → ${newPath}` });
      refreshProject();
      // update tab if open
      setTabs((prev) => prev.map((t) => t.file.id === file.id ? { ...t, file: { ...t.file, path: newPath, name: newPath.split('/').pop() ?? newPath } } : t));
    } catch (e) {
      toast({ title: 'Rename failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  };

  const deleteFile = async (file: FileMeta) => {
    if (!confirm(`Delete ${file.path}?`)) return;
    try {
      await deleteJson(`/api/ide/files/${file.id}`);
      toast({ title: 'Deleted', description: file.path });
      setTabs((prev) => prev.filter((t) => t.file.id !== file.id));
      setActiveTabId((curr) => curr === file.id ? null : curr);
      refreshProject();
    } catch (e) {
      toast({ title: 'Delete failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    }
  };

  // ── Search ──
  const runSearch = async () => {
    if (!projectId || !searchQuery.trim()) return;
    setBottomPanel('search');
    setSearchLoading(true);
    try {
      const r = await postJson<{ results: SearchHit[] }>('/api/ide/search', {
        projectId, query: searchQuery,
        useRegex: searchOpts.useRegex, caseSensitive: searchOpts.caseSensitive,
        filePattern: searchOpts.filePattern || undefined,
      });
      setSearchHits(r.results ?? []);
    } catch (e) {
      toast({ title: 'Search failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setSearchLoading(false);
    }
  };

  const jumpToSearch = async (path: string, line: number) => {
    await openFileByPath(path);
    // hint via storage so EditorPane picks it up
    setTimeout(() => {
      // Trigger goto via event
      window.dispatchEvent(new CustomEvent('ide-goto-line', { detail: line }));
    }, 200);
  };

  // ── Keyboard shortcuts (global) ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      if (meta && e.key === 'p' && !shift) { e.preventDefault(); setPaletteMode('files'); }
      else if (meta && shift && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); setPaletteMode('commands'); }
      else if (meta && shift && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setBottomPanel('search');
        setTimeout(() => document.getElementById('ide-search-input')?.focus(), 50);
      }
      else if (e.key === '?' && !meta && !shift && (e.target as HTMLElement)?.tagName !== 'INPUT' && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') {
        setShortcutsOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Cursor tracking ──
  const handleCursorChange = useCallback((id: string, line: number, col: number) => {
    setCursor({ line, col });
  }, []);

  const handleScrollChange = useCallback((id: string, y: number) => {
    setTabs((prev) => prev.map((t) => t.file.id === id ? { ...t, scrollY: y } : t));
  }, []);

  // ── Commands ──
  const commands = useMemo<CommandDef[]>(() => [
    { id: 'file.save', label: 'File: Save', shortcut: ['Ctrl', 'S'], run: () => activeTabId && handleSave(activeTabId) },
    { id: 'file.new', label: 'File: New File', run: () => setNewFileDialog({ dir: '' }) },
    { id: 'file.newFolder', label: 'File: New Folder', run: () => setNewFolderDialog({ dir: '' }) },
    { id: 'search.files', label: 'Search: Find in Files', shortcut: ['Ctrl', 'Shift', 'F'], run: () => { setBottomPanel('search'); setTimeout(() => document.getElementById('ide-search-input')?.focus(), 50); } },
    { id: 'view.outline', label: 'View: Toggle Outline', run: () => setRightPanel((p) => p === 'outline' ? null : 'outline') },
    { id: 'view.problems', label: 'View: Toggle Problems', run: () => setRightPanel((p) => p === 'problems' ? null : 'problems') },
    { id: 'view.git', label: 'View: Toggle Git Diff', run: () => setRightPanel((p) => p === 'git' ? null : 'git') },
    { id: 'view.terminal', label: 'View: Toggle Terminal', run: () => setBottomPanel((p) => p === 'terminal' ? null : 'terminal') },
    { id: 'view.search', label: 'View: Toggle Search Panel', run: () => setBottomPanel((p) => p === 'search' ? null : 'search') },
    { id: 'settings.open', label: 'Preferences: Open Settings', run: () => setSettingsOpen(true) },
    { id: 'quickOpen', label: 'Go to File…', shortcut: ['Ctrl', 'P'], run: () => setPaletteMode('files') },
    { id: 'palette', label: 'Show All Commands', shortcut: ['Ctrl', 'Shift', 'P'], run: () => setPaletteMode('commands') },
    { id: 'shortcuts', label: 'Help: Keyboard Shortcuts', shortcut: ['?'], run: () => setShortcutsOpen(true) },
    { id: 'theme.toggle', label: 'Preferences: Toggle Theme', run: () => persistSettings({ ...settings, theme: settings.theme === 'jarvis-dark' ? 'light' : 'jarvis-dark' }) },
    { id: 'wordwrap.toggle', label: 'View: Toggle Word Wrap', run: () => persistSettings({ ...settings, wordWrap: !settings.wordWrap }) },
    { id: 'minimap.toggle', label: 'View: Toggle Minimap', run: () => persistSettings({ ...settings, minimap: !settings.minimap }) },
    { id: 'font.increase', label: 'View: Increase Font Size', run: () => persistSettings({ ...settings, fontSize: Math.min(24, settings.fontSize + 1) }) },
    { id: 'font.decrease', label: 'View: Decrease Font Size', run: () => persistSettings({ ...settings, fontSize: Math.max(10, settings.fontSize - 1) }) },
    { id: 'git.refresh', label: 'Git: Refresh Status', run: refreshGit },
    { id: 'project.refresh', label: 'Project: Refresh Files', run: refreshProject },
  ], [activeTabId, handleSave, persistSettings, settings, refreshGit, refreshProject]);

  // ── Problem count ──
  const problems = useRef<ProblemItem[]>([]);
  const [problemCount, setProblemCount] = useState<{ errors: number; warnings: number }>({ errors: 0, warnings: 0 });
  // Problems are loaded inside the panel via /api/ide/problems — we use a polling ref
  // here just to surface a count in the status bar. For simplicity we re-fetch on demand.
  useEffect(() => {
    if (!projectId || !settings.linting) { setProblemCount({ errors: 0, warnings: 0 }); return; }
    let cancelled = false;
    const run = async () => {
      try {
        const r = await postJson<{ problems: ProblemItem[] }>('/api/ide/problems', { projectId });
        if (cancelled) return;
        problems.current = r.problems ?? [];
        setProblemCount({
          errors: problems.current.filter((p) => p.severity === 'error').length,
          warnings: problems.current.filter((p) => p.severity === 'warning').length,
        });
      } catch { /* silent */ }
    };
    run();
    const id = setInterval(run, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [projectId, settings.linting]);

  const activeTab = tabs.find((t) => t.file.id === activeTabId);
  const branch = gitData?.status?.branch ?? project?.gitBranch ?? '';

  // ── Render ──
  return (
    <div className="h-full flex flex-col bg-[var(--j-bg)] text-[var(--j-text)] overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--j-border)] bg-[var(--j-panel)]">
        <div className="flex items-center gap-1.5">
          <Code2 className="h-4 w-4" style={{ color: JARVIS.colors.cyan }} />
          <span className="jarvis-mono text-xs uppercase text-[var(--j-text)] hidden sm:inline">JARVIS IDE</span>
        </div>
        <ProjectPicker activeId={projectId} onPick={(p) => { if (p.id) { setProjectId(p.id); setTabs([]); setActiveTabId(null); } else { setProjectId(null); } }} />
        {/* Breadcrumb */}
        <div className="hidden md:flex items-center gap-1 text-[10px] jarvis-mono text-[var(--j-text-mute)] truncate flex-1 min-w-0">
          {project && <><span className="truncate">{project.name}</span><ChevronRight className="h-2.5 w-2.5" /></>}
          {activeTab && <span className="text-[var(--j-text)] truncate">{activeTab.file.path}</span>}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={refreshProject}
            disabled={!projectId || projectLoading}
            title="Refresh"
            className="p-1.5 rounded hover:bg-[var(--j-panel-soft)] text-[var(--j-text-mute)] hover:text-[var(--j-text)] disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', projectLoading && 'animate-spin')} />
          </button>
          <button
            onClick={() => setBottomPanel((p) => p === 'terminal' ? null : 'terminal')}
            title="Toggle terminal"
            className={cn('p-1.5 rounded hover:bg-[var(--j-panel-soft)]', bottomPanel === 'terminal' ? 'text-[var(--j-green)]' : 'text-[var(--j-text-mute)] hover:text-[var(--j-text)]')}
          >
            <TerminalIcon className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setBottomPanel((p) => p === 'search' ? null : 'search')}
            title="Find in files"
            className={cn('p-1.5 rounded hover:bg-[var(--j-panel-soft)]', bottomPanel === 'search' ? 'text-[var(--j-cyan)]' : 'text-[var(--j-text-mute)] hover:text-[var(--j-text)]')}
          >
            <SearchIcon className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setRightPanel((p) => p === 'outline' ? null : 'outline')}
            title="Outline"
            className={cn('p-1.5 rounded hover:bg-[var(--j-panel-soft)]', rightPanel === 'outline' ? 'text-[var(--j-cyan)]' : 'text-[var(--j-text-mute)] hover:text-[var(--j-text)]')}
          >
            <ListTree className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setRightPanel((p) => p === 'problems' ? null : 'problems')}
            title="Problems"
            className={cn('p-1.5 rounded hover:bg-[var(--j-panel-soft)] relative', rightPanel === 'problems' ? 'text-[var(--j-amber)]' : 'text-[var(--j-text-mute)] hover:text-[var(--j-text)]')}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {(problemCount.errors + problemCount.warnings) > 0 && (
              <span className="absolute -top-0.5 -right-0.5 text-[8px] jarvis-mono px-0.5 rounded-full" style={{ background: problemCount.errors > 0 ? JARVIS.colors.red : JARVIS.colors.amber, color: '#000' }}>
                {problemCount.errors + problemCount.warnings}
              </span>
            )}
          </button>
          <button
            onClick={() => setRightPanel((p) => p === 'git' ? null : 'git')}
            title="Git diff"
            className={cn('p-1.5 rounded hover:bg-[var(--j-panel-soft)]', rightPanel === 'git' ? 'text-[var(--j-cyan)]' : 'text-[var(--j-text-mute)] hover:text-[var(--j-text)]')}
          >
            <GitBranch className="h-3.5 w-3.5" />
          </button>
          <div className="w-px h-4 bg-[var(--j-border)] mx-0.5" />
          <button onClick={() => persistSettings({ ...settings, theme: settings.theme === 'jarvis-dark' ? 'light' : 'jarvis-dark' })} className="p-1.5 rounded hover:bg-[var(--j-panel-soft)] text-[var(--j-text-mute)] hover:text-[var(--j-text)]" title="Toggle theme">
            {settings.theme === 'jarvis-dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
          <button onClick={() => setSettingsOpen(true)} className="p-1.5 rounded hover:bg-[var(--j-panel-soft)] text-[var(--j-text-mute)] hover:text-[var(--j-text)]" title="Settings">
            <SettingsIcon className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setShortcutsOpen(true)} className="p-1.5 rounded hover:bg-[var(--j-panel-soft)] text-[var(--j-text-mute)] hover:text-[var(--j-text)]" title="Shortcuts (?)">
            <Keyboard className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        {/* Left: file tree */}
        <div className="w-[240px] shrink-0 border-r border-[var(--j-border)] bg-[var(--j-panel)] hidden sm:block">
          {projectId ? (
            <FileTree
              files={files}
              activeFileId={activeTabId}
              onOpenFile={openFile}
              onNewFile={(dir) => setNewFileDialog({ dir })}
              onNewFolder={(dir) => setNewFolderDialog({ dir })}
              onRename={(file) => setRenameDialog({ file })}
              onDelete={deleteFile}
              onRefresh={refreshProject}
              loading={projectLoading}
            />
          ) : (
            <div className="h-full flex items-center justify-center p-4 text-center">
              <div>
                <Folder className="h-6 w-6 mx-auto text-[var(--j-text-mute)]" />
                <div className="mt-2 text-xs jarvis-mono text-[var(--j-text-mute)]">No project selected</div>
                <div className="mt-1 text-[10px] text-[var(--j-text-dim)]">Use the picker above to create or open one.</div>
              </div>
            </div>
          )}
        </div>

        {/* Center: editor */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-0">
            <EditorPane
              tabs={tabs}
              activeTabId={activeTabId}
              fontSize={settings.fontSize}
              tabSize={settings.tabSize}
              wordWrap={settings.wordWrap}
              minimap={settings.minimap}
              onSelectTab={setActiveTabId}
              onCloseTab={closeTab}
              onReorderTabs={reorderTabs}
              onDraftChange={handleDraftChange}
              onSave={handleSave}
              onCursorChange={handleCursorChange}
              onScrollChange={handleScrollChange}
            />
          </div>

          {/* Bottom panel */}
          {bottomPanel && (
            <div className="h-[220px] shrink-0 border-t border-[var(--j-border)] bg-[var(--j-panel)] flex flex-col">
              <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--j-border)] bg-[var(--j-panel-soft)]">
                {bottomPanel === 'search' ? (
                  <div className="flex items-center gap-2 flex-1">
                    <SearchIcon className="h-3 w-3 text-[var(--j-cyan)]" />
                    <input
                      id="ide-search-input"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                      placeholder="Search in files…"
                      className="flex-1 bg-transparent border-0 outline-none text-xs jarvis-mono text-[var(--j-text)] placeholder:text-[var(--j-text-mute)]"
                    />
                    <input
                      value={searchOpts.filePattern}
                      onChange={(e) => setSearchOpts((s) => ({ ...s, filePattern: e.target.value }))}
                      placeholder="files to include"
                      className="w-32 bg-transparent border-0 outline-none text-[10px] jarvis-mono text-[var(--j-text-mute)] placeholder:text-[var(--j-text-mute)]"
                    />
                    <label className="flex items-center gap-1 text-[10px] jarvis-mono text-[var(--j-text-mute)] cursor-pointer">
                      <input type="checkbox" checked={searchOpts.caseSensitive} onChange={(e) => setSearchOpts((s) => ({ ...s, caseSensitive: e.target.checked }))} />
                      Aa
                    </label>
                    <label className="flex items-center gap-1 text-[10px] jarvis-mono text-[var(--j-text-mute)] cursor-pointer">
                      <input type="checkbox" checked={searchOpts.useRegex} onChange={(e) => setSearchOpts((s) => ({ ...s, useRegex: e.target.checked }))} />
                      .*
                    </label>
                    <button onClick={runSearch} className="text-[10px] jarvis-mono px-2 py-0.5 rounded border border-[var(--j-border)] text-[var(--j-cyan)] hover:bg-[var(--j-panel)]">Search</button>
                  </div>
                ) : (
                  <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">{bottomPanel}</span>
                )}
                <button onClick={() => setBottomPanel(null)} className="ml-auto p-0.5 rounded hover:bg-[var(--j-panel)] text-[var(--j-text-mute)]">
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                {bottomPanel === 'search' && (
                  <SearchResultsPanel
                    hits={searchHits}
                    query={searchQuery}
                    loading={searchLoading}
                    onClose={() => setBottomPanel(null)}
                    onJump={jumpToSearch}
                  />
                )}
                {bottomPanel === 'terminal' && (
                  <TerminalDock cwd={project?.rootPath ?? '/'} />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right panel */}
        {rightPanel && (
          <div className="w-[240px] shrink-0 border-l border-[var(--j-border)] bg-[var(--j-panel)] hidden lg:block">
            {rightPanel === 'outline' && <OutlinePanel fileId={activeTabId} onJump={(line) => window.dispatchEvent(new CustomEvent('ide-goto-line', { detail: line }))} />}
            {rightPanel === 'problems' && (
              <ProblemsPanel
                projectId={projectId}
                onJump={(file, line) => jumpToSearch(file, line)}
              />
            )}
            {rightPanel === 'git' && <GitDiffPanel projectId={projectId} />}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="h-6 shrink-0 flex items-center gap-3 px-3 border-t border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[10px] jarvis-mono text-[var(--j-text-mute)] overflow-x-auto jarvis-scroll-thin">
        {branch && (
          <span className="flex items-center gap-1 text-[var(--j-cyan)] shrink-0">
            <GitBranch className="h-2.5 w-2.5" /> {branch}
          </span>
        )}
        {gitData?.status && (gitData.status.modified + gitData.status.added + gitData.status.deleted + gitData.status.untracked) > 0 && (
          <span className="shrink-0">
            <span className="text-[var(--j-amber)]">{gitData.status.modified}M</span>{' '}
            <span className="text-[var(--j-green)]">{gitData.status.added}A</span>{' '}
            <span className="text-[var(--j-red)]">{gitData.status.deleted}D</span>{' '}
            <span className="text-[var(--j-violet)]">{gitData.status.untracked}U</span>
          </span>
        )}
        {activeTab && (
          <>
            <span className="shrink-0">{activeTab.file.language}</span>
            <span className="shrink-0">Ln {cursor.line}, Col {cursor.col}</span>
            <span className="shrink-0">UTF-8</span>
            <span className="shrink-0">Spaces: {settings.tabSize}</span>
          </>
        )}
        <span className="ml-auto flex items-center gap-3 shrink-0">
          {problemCount.errors > 0 && <span className="text-[var(--j-red)]">✕ {problemCount.errors}</span>}
          {problemCount.warnings > 0 && <span className="text-[var(--j-amber)]">⚠ {problemCount.warnings}</span>}
          {problemCount.errors + problemCount.warnings === 0 && settings.linting && projectId && <span className="text-[var(--j-green)]">✓ No problems</span>}
          <span>{tabs.length} open</span>
          <span>{files.length} files</span>
        </span>
      </div>

      {/* Overlays */}
      {paletteMode && (
        <CommandPalette
          mode={paletteMode}
          files={files}
          commands={commands}
          onClose={() => setPaletteMode(null)}
          onOpenFile={openFile}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onChange={persistSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}

      {newFileDialog && (
        <PromptDialog
          title="New File"
          placeholder="path/to/file.ts"
          onCancel={() => setNewFileDialog(null)}
          onConfirm={(path) => { createFile(path); setNewFileDialog(null); }}
        />
      )}
      {newFolderDialog && (
        <PromptDialog
          title="New Folder"
          placeholder="path/to/folder"
          onCancel={() => setNewFolderDialog(null)}
          onConfirm={(path) => { createFolder(path); setNewFolderDialog(null); }}
        />
      )}
      {renameDialog && (
        <PromptDialog
          title={`Rename ${renameDialog.file.name}`}
          placeholder={renameDialog.file.path}
          initial={renameDialog.file.path}
          onCancel={() => setRenameDialog(null)}
          onConfirm={(path) => { renameFile(renameDialog.file, path); setRenameDialog(null); }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Shortcuts overlay
// ────────────────────────────────────────────────────────────────────────────

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const groups = [
    {
      label: 'File',
      items: [
        { keys: ['Ctrl', 'S'], label: 'Save' },
        { keys: ['Ctrl', 'P'], label: 'Quick open file' },
        { keys: ['Ctrl', 'Shift', 'P'], label: 'Command palette' },
      ],
    },
    {
      label: 'Edit',
      items: [
        { keys: ['Ctrl', 'F'], label: 'Find in file' },
        { keys: ['Ctrl', 'H'], label: 'Find & replace' },
        { keys: ['Ctrl', 'G'], label: 'Go to line' },
        { keys: ['Ctrl', 'Shift', 'F'], label: 'Search in files' },
      ],
    },
    {
      label: 'View',
      items: [
        { keys: ['?'], label: 'Toggle this overlay' },
        { keys: ['Esc'], label: 'Close overlay / panel' },
      ],
    },
  ];
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-[480px] rounded-lg border border-[var(--j-border)] bg-[var(--j-panel)] shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--j-border)]">
          <Keyboard className="h-4 w-4 text-[var(--j-cyan)]" />
          <span className="jarvis-mono text-xs uppercase text-[var(--j-text)]">Keyboard Shortcuts</span>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-[var(--j-panel-soft)] text-[var(--j-text-mute)]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] mb-1.5">{g.label}</div>
              <div className="space-y-1">
                {g.items.map((it) => (
                  <div key={it.label} className="flex items-center justify-between">
                    <span className="text-xs text-[var(--j-text)]">{it.label}</span>
                    <span className="flex items-center gap-1">
                      {it.keys.map((k, j) => (
                        <kbd key={j} className="text-[10px] jarvis-mono px-1.5 py-0.5 rounded border border-[var(--j-border)] text-[var(--j-text-mute)]">
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Prompt dialog (new file / new folder / rename)
// ────────────────────────────────────────────────────────────────────────────

function PromptDialog({
  title, placeholder, initial = '', onConfirm, onCancel,
}: {
  title: string;
  placeholder?: string;
  initial?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(initial);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-[420px] rounded-lg border border-[var(--j-border)] bg-[var(--j-panel)] shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-[var(--j-border)] jarvis-mono text-xs uppercase text-[var(--j-text)]">{title}</div>
        <div className="p-4">
          <input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && val.trim()) onConfirm(val.trim()); if (e.key === 'Escape') onCancel(); }}
            placeholder={placeholder}
            className="w-full bg-transparent border border-[var(--j-border)] rounded px-2 py-1.5 text-xs jarvis-mono text-[var(--j-text)] placeholder:text-[var(--j-text-mute)] outline-none focus:border-[var(--j-cyan)]"
          />
        </div>
        <div className="px-4 py-2 border-t border-[var(--j-border)] flex items-center justify-end gap-1.5">
          <button onClick={onCancel} className="jarvis-mono text-[10px] uppercase px-2 py-1 rounded border border-[var(--j-border)] text-[var(--j-text-mute)] hover:bg-[var(--j-panel-soft)]">Cancel</button>
          <button
            onClick={() => val.trim() && onConfirm(val.trim())}
            disabled={!val.trim()}
            className="jarvis-mono text-[10px] uppercase px-2 py-1 rounded border disabled:opacity-50"
            style={{ borderColor: `${JARVIS.colors.cyan}40`, color: JARVIS.colors.cyan, background: `${JARVIS.colors.cyan}10` }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

// Local ProblemItem type import is hoisted to top.
