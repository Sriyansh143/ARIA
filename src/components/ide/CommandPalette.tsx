'use client';

/**
 * CommandPalette.tsx — Ctrl+P (quick open file) + Ctrl+Shift+P (commands).
 * Single overlay component, mode-switchable.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ChevronRight } from 'lucide-react';
import type { FileMeta } from '@/lib/ide';
import { fileIconFor } from './highlight';
import { cn } from '@/lib/utils';

export interface CommandDef {
  id: string;
  label: string;
  shortcut?: string[];
  group?: string;
  run: () => void;
}

interface Props {
  mode: 'files' | 'commands';
  files: FileMeta[];
  commands: CommandDef[];
  onClose: () => void;
  onOpenFile: (file: FileMeta) => void;
}

export default function CommandPalette({ mode, files, commands, onClose, onOpenFile }: Props) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Fuzzy filter
  const filteredFiles = useMemo(() => {
    if (!q) return files.slice(0, 50);
    const lower = q.toLowerCase();
    return files
      .map((f) => {
        const score = fuzzyScore(f.path.toLowerCase(), lower);
        return { f, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((x) => x.f);
  }, [q, files]);

  const filteredCmds = useMemo(() => {
    if (!q) return commands;
    const lower = q.toLowerCase();
    return commands.filter((c) => c.label.toLowerCase().includes(lower) || c.id.toLowerCase().includes(lower));
  }, [q, commands]);

  const items = mode === 'files' ? filteredFiles : filteredCmds;
  const maxIdx = items.length - 1;
  // Clamp idx into range on every render — replaces the previous effect-based reset.
  const safeIdx = maxIdx < 0 ? 0 : Math.min(idx, maxIdx);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(maxIdx, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (mode === 'files') {
        const f = filteredFiles[safeIdx];
        if (f) { onOpenFile(f); onClose(); }
      } else {
        const c = filteredCmds[safeIdx];
        if (c) { c.run(); onClose(); }
      }
    } else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-[640px] rounded-lg border border-[var(--j-border)] bg-[var(--j-panel)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--j-border)]">
          <Search className="h-4 w-4 text-[var(--j-text-mute)]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={mode === 'files' ? 'Search files by name…' : 'Type a command…'}
            className="flex-1 bg-transparent border-0 outline-none text-sm text-[var(--j-text)] placeholder:text-[var(--j-text-mute)]"
          />
          <kbd className="text-[10px] jarvis-mono text-[var(--j-text-mute)] px-1.5 py-0.5 rounded border border-[var(--j-border)]">
            {mode === 'files' ? 'Ctrl+P' : 'Ctrl+Shift+P'}
          </kbd>
        </div>
        <div className="max-h-[400px] overflow-y-auto py-1">
          {items.length === 0 ? (
            <div className="text-center py-8 text-xs jarvis-mono text-[var(--j-text-mute)]">No results</div>
          ) : mode === 'files' ? (
            filteredFiles.map((f, i) => {
              const { icon: Icon, color } = fileIconFor(f.name);
              return (
                <button
                  key={f.id}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => { onOpenFile(f); onClose(); }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-left',
                    i === safeIdx ? 'bg-[var(--j-cyan)]/10' : 'hover:bg-[var(--j-panel-soft)]',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                  <span className="text-xs jarvis-mono text-[var(--j-text)] truncate">{f.name}</span>
                  <span className="text-[10px] jarvis-mono text-[var(--j-text-mute)] truncate ml-auto">{f.path}</span>
                </button>
              );
            })
          ) : (
            filteredCmds.map((c, i) => (
              <button
                key={c.id}
                onMouseEnter={() => setIdx(i)}
                onClick={() => { c.run(); onClose(); }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-left',
                  i === safeIdx ? 'bg-[var(--j-cyan)]/10' : 'hover:bg-[var(--j-panel-soft)]',
                )}
              >
                <ChevronRight className="h-3 w-3 shrink-0 text-[var(--j-text-mute)]" />
                <span className="text-xs jarvis-mono text-[var(--j-text)] truncate">{c.label}</span>
                {c.shortcut && (
                  <span className="ml-auto flex items-center gap-1">
                    {c.shortcut.map((k, j) => (
                      <kbd key={j} className="text-[10px] jarvis-mono text-[var(--j-text-mute)] px-1 py-0.5 rounded border border-[var(--j-border)]">
                        {k}
                      </kbd>
                    ))}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-[var(--j-border)] text-[10px] jarvis-mono text-[var(--j-text-mute)]">
          <span>{items.length} results</span>
          <span className="flex items-center gap-2">
            <span>↑↓ navigate</span>
            <span>↵ select</span>
            <span>esc close</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Simple subsequence fuzzy match → higher = better, -1 = no match. */
function fuzzyScore(text: string, query: string): number {
  if (!query) return 0;
  let ti = 0, qi = 0, score = 0, streak = 0;
  while (ti < text.length && qi < query.length) {
    if (text[ti] === query[qi]) {
      score += 1 + streak;
      streak += 1;
      qi++;
    } else {
      streak = 0;
    }
    ti++;
  }
  return qi === query.length ? score : -1;
}
