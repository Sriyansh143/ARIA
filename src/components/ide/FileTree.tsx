'use client';

/**
 * FileTree.tsx — VS Code-style file explorer.
 *
 * Features:
 *   - Folder/file tree with collapse state.
 *   - File icons by extension + git status indicators.
 *   - Right-click context menu (new file / new folder / rename / delete / copy path).
 *   - Dirty indicator (unsaved changes dot).
 *   - Click file → opens it in the editor.
 */

import { useMemo, useState } from 'react';
import {
  ChevronRight, ChevronDown, Folder, FolderOpen, FilePlus, FolderPlus,
  Pencil, Trash2, Copy, RefreshCw,
} from 'lucide-react';
import type { FileMeta } from '@/lib/ide';
import { fileIconFor, gitStatusBadge } from './highlight';
import { JARVIS } from '@/lib/config';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  file?: FileMeta;
}

function buildTree(files: FileMeta[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let child = node.children.find((c) => c.name === part && (isLast ? !c.isDir : c.isDir));
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          isDir: !isLast,
          children: [],
          file: isLast ? f : undefined,
        };
        node.children.push(child);
      }
      node = child;
    }
  }
  // sort: folders first, then files; alphabetical within each group
  const sortNode = (n: TreeNode) => {
    n.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

interface FileTreeProps {
  files: FileMeta[];
  activeFileId: string | null;
  onOpenFile: (file: FileMeta) => void;
  onNewFile: (parentDir: string) => void;
  onNewFolder: (parentDir: string) => void;
  onRename: (file: FileMeta) => void;
  onDelete: (file: FileMeta) => void;
  onRefresh: () => void;
  loading?: boolean;
}

export default function FileTree({
  files, activeFileId, onOpenFile, onNewFile, onNewFolder, onRename, onDelete, onRefresh, loading,
}: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [ctx, setCtx] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  const { toast } = useToast();

  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const copyPath = (path: string) => {
    navigator.clipboard?.writeText(path).then(
      () => toast({ title: 'Path copied', description: path }),
      () => toast({ title: 'Copy failed', variant: 'destructive' }),
    );
    setCtx(null);
  };

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    if (node.isDir) {
      const isCollapsed = collapsed.has(node.path);
      return (
        <div key={node.path || 'root'}>
          <button
            onClick={() => toggle(node.path)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtx({ x: e.clientX, y: e.clientY, node });
            }}
            className="w-full flex items-center gap-1.5 px-1.5 py-0.5 rounded text-left hover:bg-[var(--j-panel-soft)] group"
            style={{ paddingLeft: depth * 12 + 6 }}
          >
            {isCollapsed
              ? <ChevronRight className="h-3 w-3 shrink-0 text-[var(--j-text-mute)]" />
              : <ChevronDown className="h-3 w-3 shrink-0 text-[var(--j-text-mute)]" />}
            {isCollapsed
              ? <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: JARVIS.colors.cyan }} />
              : <FolderOpen className="h-3.5 w-3.5 shrink-0" style={{ color: JARVIS.colors.cyan }} />}
            <span className="text-xs truncate jarvis-mono text-[var(--j-text)]">{node.name || '/'}</span>
          </button>
          {!isCollapsed && node.children.map((c) => renderNode(c, depth + 1))}
        </div>
      );
    }
    // file
    const { icon: Icon, color } = fileIconFor(node.name);
    const badge = node.file ? gitStatusBadge(node.file.gitStatus) : null;
    const active = node.file?.id === activeFileId;
    const dirty = node.file?.isDirty;
    return (
      <button
        key={node.path}
        onClick={() => node.file && onOpenFile(node.file)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (node.file) setCtx({ x: e.clientX, y: e.clientY, node });
        }}
        className={cn(
          'w-full flex items-center gap-1.5 px-1.5 py-0.5 rounded text-left transition-colors group',
          active ? 'bg-[var(--j-cyan)]/10 ring-1 ring-[var(--j-cyan)]/30' : 'hover:bg-[var(--j-panel-soft)]',
        )}
        style={{ paddingLeft: depth * 12 + 22 }}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
        <span className="text-xs truncate jarvis-mono flex-1 text-[var(--j-text)]">{node.name}</span>
        {dirty && <span className="h-1.5 w-1.5 rounded-full bg-[var(--j-cyan)] shrink-0" />}
        {badge && (
          <span
            className="jarvis-mono text-[9px] font-bold shrink-0"
            style={{ color: badge.color }}
          >
            {badge.label}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--j-border)]">
        <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Explorer</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onNewFile('')}
            title="New file"
            className="p-1 rounded hover:bg-[var(--j-panel-soft)] text-[var(--j-text-mute)] hover:text-[var(--j-text)]"
          >
            <FilePlus className="h-3 w-3" />
          </button>
          <button
            onClick={() => onNewFolder('')}
            title="New folder"
            className="p-1 rounded hover:bg-[var(--j-panel-soft)] text-[var(--j-text-mute)] hover:text-[var(--j-text)]"
          >
            <FolderPlus className="h-3 w-3" />
          </button>
          <button
            onClick={onRefresh}
            title="Refresh"
            className="p-1 rounded hover:bg-[var(--j-panel-soft)] text-[var(--j-text-mute)] hover:text-[var(--j-text)]"
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          </button>
        </div>
      </div>
      <div
        className="flex-1 overflow-y-auto py-1"
        onClick={() => setCtx(null)}
        onContextMenu={(e) => {
          // root context menu
          if (e.target === e.currentTarget) {
            e.preventDefault();
            setCtx({ x: e.clientX, y: e.clientY, node: tree });
          }
        }}
      >
        {tree.children.length === 0 ? (
          <div className="text-center py-8 px-3">
            <div className="text-xs text-[var(--j-text-mute)] jarvis-mono">No files yet</div>
            <button
              onClick={() => onNewFile('')}
              className="mt-2 text-[10px] jarvis-mono px-2 py-1 rounded border border-[var(--j-border)] text-[var(--j-cyan)] hover:bg-[var(--j-panel-soft)]"
            >
              + Create file
            </button>
          </div>
        ) : (
          tree.children.map((c) => renderNode(c, 0))
        )}
      </div>

      {/* Context menu */}
      {ctx && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }} />
          <div
            className="fixed z-50 min-w-[160px] py-1 rounded-md border border-[var(--j-border)] bg-[var(--j-panel)] shadow-xl"
            style={{ left: ctx.x, top: ctx.y }}
          >
            <MenuItem icon={FilePlus} label="New File" onClick={() => {
              const dir = ctx.node.isDir ? ctx.node.path : (ctx.node.path.split('/').slice(0, -1).join('/'));
              onNewFile(dir);
              setCtx(null);
            }} />
            <MenuItem icon={FolderPlus} label="New Folder" onClick={() => {
              const dir = ctx.node.isDir ? ctx.node.path : (ctx.node.path.split('/').slice(0, -1).join('/'));
              onNewFolder(dir);
              setCtx(null);
            }} />
            {!ctx.node.isDir && ctx.node.file && (
              <>
                <MenuItem icon={Pencil} label="Rename" onClick={() => { onRename(ctx.node.file!); setCtx(null); }} />
                <MenuItem icon={Copy} label="Copy Path" onClick={() => copyPath(ctx.node.path)} />
                <MenuItem icon={Trash2} label="Delete" danger onClick={() => { onDelete(ctx.node.file!); setCtx(null); }} />
              </>
            )}
            {ctx.node.isDir && (
              <MenuItem icon={Copy} label="Copy Path" onClick={() => copyPath(ctx.node.path + '/')} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-[var(--j-panel-soft)]',
        danger ? 'text-[var(--j-red)]' : 'text-[var(--j-text)]',
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}
