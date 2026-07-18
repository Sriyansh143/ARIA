'use client';

/**
 * EditorPane.tsx — the central code editor.
 *
 * Features:
 *   - Multi-file tabs (open/close/switch/reorder by drag).
 *   - Lightweight regex-based syntax highlighting (read-only overlay).
 *   - Editable via hidden textarea synced with the highlight overlay.
 *   - Line-number gutter with click-to-jump.
 *   - Find & replace (Ctrl+F / Ctrl+H) bar.
 *   - Go to line (Ctrl+G) bar.
 *   - Cursor position tracking (line:col).
 *   - Word-wrap toggle + font-size controls.
 *   - Auto-save support (every 30s if dirty) — controlled by parent.
 *   - Dirty indicator (unsaved changes dot) on tabs.
 *   - Drag-reorder file tabs.
 */

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { X, Save, Search, Replace, XCircle, ArrowRightLeft, WrapText, Minus, Plus } from 'lucide-react';
import type { FileWithContent } from '@/lib/ide';
import { highlightLine, fileIconFor } from './highlight';
import { JARVIS } from '@/lib/config';
import { cn } from '@/lib/utils';

export interface OpenTab {
  file: FileWithContent;
  draft: string;
  scrollY: number;
  cursorLine: number;
  cursorCol: number;
}

interface EditorPaneProps {
  tabs: OpenTab[];
  activeTabId: string | null;
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  minimap: boolean;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onReorderTabs: (from: number, to: number) => void;
  onDraftChange: (id: string, draft: string) => void;
  onSave: (id: string) => void;
  onCursorChange: (id: string, line: number, col: number) => void;
  onScrollChange: (id: string, y: number) => void;
  onJumpToLine?: (line: number) => void;
}

export default function EditorPane(props: EditorPaneProps) {
  const {
    tabs, activeTabId, fontSize, tabSize, wordWrap, minimap,
    onSelectTab, onCloseTab, onReorderTabs, onDraftChange, onSave,
    onCursorChange, onScrollChange, onJumpToLine,
  } = props;

  const active = tabs.find((t) => t.file.id === activeTabId) ?? null;

  const taRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [findIdx, setFindIdx] = useState(0);
  const [gotoOpen, setGotoOpen] = useState(false);
  const [gotoVal, setGotoVal] = useState('');
  const dragTabIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // ── Find matches ──
  const matches = useMemo(() => {
    if (!active || !findQuery) return [] as Array<{ line: number; start: number; end: number }>;
    const out: Array<{ line: number; start: number; end: number }> = [];
    const lines = active.draft.split('\n');
    const q = findQuery.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].toLowerCase();
      let from = 0;
      while (true) {
        const idx = l.indexOf(q, from);
        if (idx < 0) break;
        out.push({ line: i, start: idx, end: idx + findQuery.length });
        from = idx + findQuery.length;
      }
    }
    return out;
  }, [active, findQuery]);

  const currentMatchLine = matches[findIdx]?.line;

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setFindOpen(true);
        setReplaceOpen(false);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault();
        setFindOpen(true);
        setReplaceOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        setGotoOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (active && active.file.isDirty) onSave(active.file.id);
      } else if (e.key === 'Escape') {
        setFindOpen(false);
        setReplaceOpen(false);
        setGotoOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, onSave]);

  // ── Sync scroll ──
  const syncScroll = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    if (overlayRef.current) {
      overlayRef.current.scrollTop = ta.scrollTop;
      overlayRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = ta.scrollTop;
    }
    if (active) onScrollChange(active.file.id, ta.scrollTop);
  }, [active, onScrollChange]);

  // ── Restore scroll on tab switch ──
  useEffect(() => {
    const ta = taRef.current;
    if (ta && active) {
      ta.scrollTop = active.scrollY;
      if (overlayRef.current) overlayRef.current.scrollTop = active.scrollY;
      if (gutterRef.current) gutterRef.current.scrollTop = active.scrollY;
    }
  }, [activeTabId]);

  // ── Cursor tracking + tab handling ──
  const updateCursor = useCallback(() => {
    const ta = taRef.current;
    if (!ta || !active) return;
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const lines = before.split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    onCursorChange(active.file.id, line, col);
  }, [active, onCursorChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const spaces = ' '.repeat(tabSize);
      const newValue = ta.value.slice(0, start) + spaces + ta.value.slice(end);
      onDraftChange(active!.file.id, newValue);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + spaces.length;
      });
    }
  };

  // ── Find/replace actions ──
  const findNext = () => setFindIdx((i) => (i + 1) % Math.max(1, matches.length));
  const findPrev = () => setFindIdx((i) => (i - 1 + matches.length) % Math.max(1, matches.length));

  const jumpToMatch = (m: { line: number; start: number; end: number }) => {
    const ta = taRef.current;
    if (!ta || !active) return;
    const lines = active.draft.split('\n');
    let pos = 0;
    for (let i = 0; i < m.line; i++) pos += lines[i].length + 1;
    pos += m.start;
    ta.focus();
    ta.setSelectionRange(pos, pos + (m.end - m.start));
    // approximate scroll
    const lineH = fontSize * 1.5;
    ta.scrollTop = m.line * lineH - ta.clientHeight / 2;
    syncScroll();
    onJumpToLine?.(m.line + 1);
  };

  useEffect(() => {
    if (matches.length && findOpen) jumpToMatch(matches[findIdx] ?? matches[0]);
  }, [findIdx, findOpen]);

  const replaceCurrent = () => {
    if (!active || !matches.length) return;
    const m = matches[findIdx];
    if (!m) return;
    const lines = active.draft.split('\n');
    const line = lines[m.line];
    const newLine = line.slice(0, m.start) + replaceQuery + line.slice(m.end);
    lines[m.line] = newLine;
    onDraftChange(active.file.id, lines.join('\n'));
    setFindIdx((i) => (i + 1) % Math.max(1, matches.length - 1 || 1));
  };

  const replaceAll = () => {
    if (!active || !findQuery) return;
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'g');
    onDraftChange(active.file.id, active.draft.replace(re, replaceQuery));
  };

  const doGoto = () => {
    const n = parseInt(gotoVal, 10);
    if (!n || !active) return;
    const ta = taRef.current;
    if (!ta) return;
    const lines = active.draft.split('\n');
    let pos = 0;
    for (let i = 0; i < Math.min(n - 1, lines.length); i++) pos += lines[i].length + 1;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    const lineH = fontSize * 1.5;
    ta.scrollTop = (n - 1) * lineH - ta.clientHeight / 2;
    syncScroll();
    setGotoOpen(false);
    setGotoVal('');
    onJumpToLine?.(n);
  };

  const lines = active ? active.draft.split('\n') : [];

  return (
    <div className="flex flex-col h-full bg-[var(--j-panel)] min-w-0">
      {/* ── Tab strip ── */}
      <div className="flex items-stretch border-b border-[var(--j-border)] overflow-x-auto jarvis-scroll-thin">
        {tabs.length === 0 && (
          <div className="px-3 py-2 text-[10px] jarvis-mono uppercase text-[var(--j-text-mute)]">
            No file open — pick one from the explorer
          </div>
        )}
        {tabs.map((t, idx) => {
          const { icon: Icon, color } = fileIconFor(t.file.name);
          const isActive = t.file.id === activeTabId;
          const dirty = t.file.isDirty || t.draft !== t.file.content;
          return (
            <div
              key={t.file.id}
              draggable
              onDragStart={() => { dragTabIdx.current = idx; }}
              onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
              onDrop={() => {
                if (dragTabIdx.current !== null && dragTabIdx.current !== idx) {
                  onReorderTabs(dragTabIdx.current, idx);
                }
                dragTabIdx.current = null;
                setDragOverIdx(null);
              }}
              onClick={() => onSelectTab(t.file.id)}
              className={cn(
                'group flex items-center gap-1.5 px-3 py-1.5 border-r border-[var(--j-border)] cursor-pointer min-w-0 max-w-[200px] transition-colors',
                isActive ? 'bg-[var(--j-panel)] text-[var(--j-text)]' : 'bg-[var(--j-bg-soft)] text-[var(--j-text-dim)] hover:bg-[var(--j-panel-soft)]',
                dragOverIdx === idx && 'ring-1 ring-inset ring-[var(--j-cyan)]',
              )}
              title={t.file.path}
            >
              <Icon className="h-3 w-3 shrink-0" style={{ color }} />
              <span className="text-xs truncate jarvis-mono">{t.file.name}</span>
              {dirty && <span className="h-1.5 w-1.5 rounded-full bg-[var(--j-cyan)] shrink-0" />}
              <button
                onClick={(e) => { e.stopPropagation(); onCloseTab(t.file.id); }}
                className="ml-1 p-0.5 rounded hover:bg-[var(--j-panel-soft)] opacity-0 group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Find / Replace / Goto bars ── */}
      {findOpen && active && (
        <div className="flex flex-col gap-1 border-b border-[var(--j-border)] bg-[var(--j-panel-soft)] px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <Search className="h-3 w-3 text-[var(--j-text-mute)]" />
            <input
              autoFocus
              value={findQuery}
              onChange={(e) => { setFindQuery(e.target.value); setFindIdx(0); }}
              placeholder="Find"
              className="flex-1 bg-transparent border-0 outline-none text-xs jarvis-mono text-[var(--j-text)] placeholder:text-[var(--j-text-mute)]"
            />
            <span className="text-[10px] jarvis-mono text-[var(--j-text-mute)]">
              {matches.length ? `${findIdx + 1}/${matches.length}` : '0/0'}
            </span>
            <button onClick={findPrev} className="p-0.5 rounded hover:bg-[var(--j-panel)] text-[var(--j-text-mute)]" title="Previous">
              <ArrowRightLeft className="h-3 w-3 rotate-90" />
            </button>
            <button onClick={findNext} className="p-0.5 rounded hover:bg-[var(--j-panel)] text-[var(--j-text-mute)]" title="Next">
              <ArrowRightLeft className="h-3 w-3 -rotate-90" />
            </button>
            <button onClick={() => setFindOpen(false)} className="p-0.5 rounded hover:bg-[var(--j-panel)] text-[var(--j-text-mute)]">
              <XCircle className="h-3 w-3" />
            </button>
          </div>
          {replaceOpen && (
            <div className="flex items-center gap-1.5">
              <Replace className="h-3 w-3 text-[var(--j-text-mute)]" />
              <input
                value={replaceQuery}
                onChange={(e) => setReplaceQuery(e.target.value)}
                placeholder="Replace"
                className="flex-1 bg-transparent border-0 outline-none text-xs jarvis-mono text-[var(--j-text)] placeholder:text-[var(--j-text-mute)]"
              />
              <button onClick={replaceCurrent} className="text-[10px] jarvis-mono px-1.5 py-0.5 rounded border border-[var(--j-border)] text-[var(--j-cyan)] hover:bg-[var(--j-panel)]">Replace</button>
              <button onClick={replaceAll} className="text-[10px] jarvis-mono px-1.5 py-0.5 rounded border border-[var(--j-border)] text-[var(--j-cyan)] hover:bg-[var(--j-panel)]">All</button>
            </div>
          )}
        </div>
      )}

      {gotoOpen && (
        <div className="flex items-center gap-2 border-b border-[var(--j-border)] bg-[var(--j-panel-soft)] px-2 py-1.5">
          <span className="text-[10px] jarvis-mono text-[var(--j-text-mute)]">Go to line:</span>
          <input
            autoFocus
            value={gotoVal}
            onChange={(e) => setGotoVal(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && doGoto()}
            placeholder=":"
            className="w-20 bg-transparent border-0 outline-none text-xs jarvis-mono text-[var(--j-text)]"
          />
          <button onClick={doGoto} className="text-[10px] jarvis-mono px-2 py-0.5 rounded border border-[var(--j-border)] text-[var(--j-cyan)] hover:bg-[var(--j-panel)]">Go</button>
        </div>
      )}

      {/* ── Editor body ── */}
      <div className="relative flex-1 min-h-0 flex">
        {active ? (
          <>
            {/* gutter */}
            <div
              ref={gutterRef}
              className="overflow-hidden shrink-0 select-none text-right py-2 px-2 jarvis-mono text-[var(--j-text-mute)]"
              style={{ fontSize, lineHeight: 1.5, minWidth: `${Math.max(2, String(lines.length).length) + 2}ch` }}
            >
              {lines.map((_, i) => (
                <div key={i} style={{ height: fontSize * 1.5 }} className={cn(currentMatchLine === i && 'text-[var(--j-cyan)]')}>
                  {i + 1}
                </div>
              ))}
            </div>

            {/* editor area */}
            <div className="relative flex-1 min-w-0">
              {/* highlight overlay */}
              <div
                ref={overlayRef}
                aria-hidden
                className="absolute inset-0 overflow-auto py-2 pointer-events-none whitespace-pre"
                style={{ fontSize, lineHeight: 1.5, fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)', padding: '0 12px', wordBreak: wordWrap ? 'break-word' : 'normal', whiteSpace: wordWrap ? 'pre-wrap' : 'pre' }}
              >
                {lines.map((line, i) => (
                  <div key={i} style={{ minHeight: fontSize * 1.5 }} className={cn(currentMatchLine === i && 'bg-[var(--j-cyan)]/10')}>
                    {highlightLine(line, active.file.language) || '\u00A0'}
                  </div>
                ))}
              </div>

              {/* transparent textarea on top */}
              <textarea
                ref={taRef}
                value={active.draft}
                onChange={(e) => onDraftChange(active.file.id, e.target.value)}
                onScroll={syncScroll}
                onClick={updateCursor}
                onKeyUp={updateCursor}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                className="absolute inset-0 w-full h-full resize-none bg-transparent outline-none overflow-auto py-2"
                style={{
                  fontSize,
                  lineHeight: 1.5,
                  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
                  color: 'transparent',
                  caretColor: JARVIS.colors.cyan,
                  padding: '0 12px',
                  whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
                  wordBreak: wordWrap ? 'break-word' : 'normal',
                }}
              />
            </div>

            {/* minimap */}
            {minimap && (
              <div className="hidden lg:block w-[60px] shrink-0 border-l border-[var(--j-border)] overflow-hidden bg-[var(--j-bg-soft)] py-2">
                <div
                  className="origin-top"
                  style={{ transform: `scaleY(${Math.min(1, 600 / Math.max(1, lines.length * 2))})`, transformOrigin: 'top left' }}
                >
                  {lines.slice(0, 800).map((line, i) => {
                    const trimmed = line.trim();
                    if (!trimmed) return <div key={i} style={{ height: 2 }} />;
                    const len = Math.min(50, line.length);
                    return (
                      <div
                        key={i}
                        style={{ height: 2, width: `${len * 1.1}px`, background: JARVIS.colors.textMute, opacity: 0.4 }}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-[10px] jarvis-mono uppercase text-[var(--j-text-mute)]">JARVIS IDE</div>
              <div className="mt-2 text-xs text-[var(--j-text-dim)]">Select a file to begin editing</div>
              <div className="mt-4 text-[10px] jarvis-mono text-[var(--j-text-mute)] space-y-0.5">
                <div><kbd className="px-1 py-0.5 rounded border border-[var(--j-border)]">Ctrl+P</kbd> quick open file</div>
                <div><kbd className="px-1 py-0.5 rounded border border-[var(--j-border)]">Ctrl+Shift+P</kbd> command palette</div>
                <div><kbd className="px-1 py-0.5 rounded border border-[var(--j-border)]">Ctrl+F</kbd> find in file</div>
                <div><kbd className="px-1 py-0.5 rounded border border-[var(--j-border)]">Ctrl+G</kbd> go to line</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Save button (floating) ── */}
      {active && (
        <button
          onClick={() => onSave(active.file.id)}
          className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--j-cyan)]/40 bg-[var(--j-cyan)]/10 text-[var(--j-cyan)] hover:bg-[var(--j-cyan)]/20 transition-colors"
          style={{ borderColor: `${JARVIS.colors.cyan}40`, color: JARVIS.colors.cyan }}
          title="Save (Ctrl+S)"
        >
          <Save className="h-3 w-3" />
          <span className="text-[10px] jarvis-mono uppercase">Save</span>
        </button>
      )}
    </div>
  );
}
