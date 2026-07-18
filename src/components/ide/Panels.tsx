'use client';

/**
 * Panels.tsx — Right-side panels: Outline, Problems, Git diff.
 * Plus the bottom-panel search results + terminal dock.
 */

import { useState, useEffect, useRef } from 'react';
import {
  ListTree, AlertTriangle, XCircle, Info, GitBranch, Search,
  Terminal as TerminalIcon, Loader2, X, CornerDownLeft,
} from 'lucide-react';
import type { OutlineSymbol, ProblemItem } from '@/lib/ide';
import { JARVIS } from '@/lib/config';
import { cn } from '@/lib/utils';
import { postJson } from '@/lib/hooks/use-api';

// ────────────────────────────────────────────────────────────────────────────
// Outline panel
// ────────────────────────────────────────────────────────────────────────────

const SYMBOL_ICONS: Record<OutlineSymbol['type'], string> = {
  function: 'ƒ',
  class: 'C',
  interface: 'I',
  const: '■',
  method: 'm',
  type: 'T',
  import: '↧',
};

const SYMBOL_COLORS: Record<OutlineSymbol['type'], string> = {
  function: JARVIS.colors.cyan,
  class: JARVIS.colors.amber,
  interface: JARVIS.colors.violet,
  const: JARVIS.colors.green,
  method: JARVIS.colors.cyan,
  type: JARVIS.colors.cyan,
  import: JARVIS.colors.textMute,
};

export function OutlinePanel({ fileId, onJump }: { fileId: string | null; onJump: (line: number) => void }) {
  const [symbols, setSymbols] = useState<OutlineSymbol[]>([]);
  const [version, setVersion] = useState(0); // bumped when fileId changes to trigger a re-load via key
  // We use a key-based remount strategy: the parent passes `key={fileId}`,
  // so this component mounts fresh per file. Symbols state lives only for
  // the current file and starts empty.

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    postJson<{ symbols: OutlineSymbol[] }>('/api/ide/outline', { fileId })
      .then((r) => { if (!cancelled) setSymbols(r.symbols ?? []); })
      .catch(() => { if (!cancelled) setSymbols([]); });
    return () => { cancelled = true; };
  }, [fileId, version]);

  const reload = () => setVersion((v) => v + 1);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--j-border)]">
        <ListTree className="h-3 w-3 text-[var(--j-cyan)]" />
        <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Outline</span>
        {fileId && (
          <button onClick={reload} className="ml-auto p-0.5 rounded hover:bg-[var(--j-panel-soft)] text-[var(--j-text-mute)]" title="Re-extract">
            <Loader2 className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {!fileId ? (
          <div className="text-center py-6 text-[10px] jarvis-mono text-[var(--j-text-mute)]">No file open</div>
        ) : symbols.length === 0 ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--j-text-mute)]" />
          </div>
        ) : (
          symbols.map((s, i) => (
            <button
              key={i}
              onClick={() => onJump(s.line)}
              className="w-full flex items-center gap-2 px-2 py-0.5 text-left hover:bg-[var(--j-panel-soft)]"
            >
              <span
                className="jarvis-mono text-[10px] font-bold w-3 text-center shrink-0"
                style={{ color: SYMBOL_COLORS[s.type] }}
              >
                {SYMBOL_ICONS[s.type]}
              </span>
              <span className="text-xs truncate jarvis-mono text-[var(--j-text)] flex-1">{s.name}</span>
              <span className="text-[9px] jarvis-mono text-[var(--j-text-mute)] shrink-0">{s.line}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Problems panel
// ────────────────────────────────────────────────────────────────────────────

export function ProblemsPanel({ projectId, onJump }: { projectId: string | null; onJump: (file: string, line: number) => void }) {
  const [loading, setLoading] = useState(false);
  const [problems, setProblems] = useState<ProblemItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await postJson<{ problems: ProblemItem[] }>('/api/ide/problems', { projectId });
      setProblems(r.problems ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { run(); }, [projectId]);

  const errs = problems.filter((p) => p.severity === 'error').length;
  const warns = problems.filter((p) => p.severity === 'warning').length;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--j-border)]">
        <AlertTriangle className="h-3 w-3 text-[var(--j-amber)]" />
        <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Problems</span>
        <div className="ml-auto flex items-center gap-2">
          {errs > 0 && (
            <span className="jarvis-mono text-[10px] text-[var(--j-red)] flex items-center gap-1">
              <XCircle className="h-2.5 w-2.5" /> {errs}
            </span>
          )}
          {warns > 0 && (
            <span className="jarvis-mono text-[10px] text-[var(--j-amber)] flex items-center gap-1">
              <AlertTriangle className="h-2.5 w-2.5" /> {warns}
            </span>
          )}
          <button
            onClick={run}
            disabled={loading}
            className="p-0.5 rounded hover:bg-[var(--j-panel-soft)] text-[var(--j-text-mute)] disabled:opacity-50"
            title="Re-run checks"
          >
            <Loader2 className={cn('h-3 w-3', loading && 'animate-spin')} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {!projectId ? (
          <div className="text-center py-6 text-[10px] jarvis-mono text-[var(--j-text-mute)]">No project selected</div>
        ) : loading && problems.length === 0 ? (
          <div className="text-center py-6 text-[10px] jarvis-mono text-[var(--j-text-mute)]">Running tsc/eslint…</div>
        ) : problems.length === 0 ? (
          <div className="text-center py-6 text-[10px] jarvis-mono text-[var(--j-green)]">✓ No problems detected</div>
        ) : error ? (
          <div className="text-center py-6 text-[10px] jarvis-mono text-[var(--j-red)]">{error}</div>
        ) : (
          problems.map((p, i) => (
            <button
              key={i}
              onClick={() => onJump(p.file, p.line)}
              className="w-full flex items-start gap-2 px-2 py-1 text-left hover:bg-[var(--j-panel-soft)]"
            >
              {p.severity === 'error'
                ? <XCircle className="h-3 w-3 mt-0.5 shrink-0" style={{ color: JARVIS.colors.red }} />
                : p.severity === 'warning'
                  ? <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" style={{ color: JARVIS.colors.amber }} />
                  : <Info className="h-3 w-3 mt-0.5 shrink-0" style={{ color: JARVIS.colors.cyan }} />}
              <div className="flex-1 min-w-0">
                <div className="text-xs jarvis-mono text-[var(--j-text)] truncate">{p.message}</div>
                <div className="text-[10px] jarvis-mono text-[var(--j-text-mute)] truncate">
                  {p.file}:{p.line}:{p.column}{p.code ? `  [${p.code}]` : ''}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Git diff viewer
// ────────────────────────────────────────────────────────────────────────────

export function GitDiffPanel({ projectId }: { projectId: string | null }) {
  const [staged, setStaged] = useState(false);
  const [diff, setDiff] = useState('');
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const r = await postJson<{ diff: string }>('/api/ide/git/diff', { projectId, staged });
      setDiff(r.diff || '(no changes)');
    } catch (e) {
      setDiff(`error: ${e instanceof Error ? e.message : 'failed'}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { run(); }, [projectId, staged]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--j-border)]">
        <GitBranch className="h-3 w-3 text-[var(--j-cyan)]" />
        <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Git Diff</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setStaged(false)}
            className={cn(
              'text-[10px] jarvis-mono px-1.5 py-0.5 rounded',
              !staged ? 'bg-[var(--j-cyan)]/10 text-[var(--j-cyan)]' : 'text-[var(--j-text-mute)] hover:bg-[var(--j-panel-soft)]',
            )}
          >
            Working
          </button>
          <button
            onClick={() => setStaged(true)}
            className={cn(
              'text-[10px] jarvis-mono px-1.5 py-0.5 rounded',
              staged ? 'bg-[var(--j-cyan)]/10 text-[var(--j-cyan)]' : 'text-[var(--j-text-mute)] hover:bg-[var(--j-panel-soft)]',
            )}
          >
            Staged
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--j-text-mute)]" />
          </div>
        ) : (
          <pre className="text-[11px] jarvis-mono whitespace-pre-wrap break-all">
            {diff.split('\n').map((line, i) => (
              <div
                key={i}
                className={cn(
                  line.startsWith('+') && !line.startsWith('+++') && 'text-[var(--j-green)] bg-[var(--j-green)]/5',
                  line.startsWith('-') && !line.startsWith('---') && 'text-[var(--j-red)] bg-[var(--j-red)]/5',
                  line.startsWith('@@') && 'text-[var(--j-cyan)]',
                  line.startsWith('diff ') && 'text-[var(--j-violet)] font-bold',
                  line.startsWith('---') && 'text-[var(--j-amber)]',
                  line.startsWith('+++') && 'text-[var(--j-amber)]',
                )}
              >
                {line || ' '}
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Search results panel (bottom)
// ────────────────────────────────────────────────────────────────────────────

export interface SearchHit {
  path: string;
  line: number;
  column: number;
  preview: string;
  matchStart: number;
  matchEnd: number;
}

export function SearchResultsPanel({
  hits, query, loading, onClose, onJump,
}: {
  hits: SearchHit[];
  query: string;
  loading: boolean;
  onClose: () => void;
  onJump: (path: string, line: number) => void;
}) {
  // group by file
  const grouped = hits.reduce<Record<string, SearchHit[]>>((acc, h) => {
    (acc[h.path] ||= []).push(h);
    return acc;
  }, {});

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--j-border)]">
        <Search className="h-3 w-3 text-[var(--j-cyan)]" />
        <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
          Search: <span className="text-[var(--j-cyan)]">{query || '(empty)'}</span>
        </span>
        <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)] ml-2">
          {hits.length} results in {Object.keys(grouped).length} files
        </span>
        <button onClick={onClose} className="ml-auto p-0.5 rounded hover:bg-[var(--j-panel-soft)] text-[var(--j-text-mute)]">
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--j-cyan)]" />
          </div>
        ) : hits.length === 0 ? (
          <div className="text-center py-6 text-[10px] jarvis-mono text-[var(--j-text-mute)]">No matches</div>
        ) : (
          Object.entries(grouped).map(([file, items]) => (
            <div key={file} className="mb-1">
              <div className="px-2 py-0.5 text-[10px] jarvis-mono text-[var(--j-violet)] uppercase truncate">
                {file} <span className="text-[var(--j-text-mute)]">({items.length})</span>
              </div>
              {items.map((h, i) => (
                <button
                  key={i}
                  onClick={() => onJump(h.path, h.line)}
                  className="w-full flex items-start gap-2 px-2 py-0.5 text-left hover:bg-[var(--j-panel-soft)]"
                >
                  <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)] shrink-0 w-8 text-right">{h.line}</span>
                  <span className="text-xs jarvis-mono text-[var(--j-text)] truncate flex-1">
                    {h.preview.slice(0, h.matchStart)}
                    <span className="bg-[var(--j-cyan)]/20 text-[var(--j-cyan)]">
                      {h.preview.slice(h.matchStart, h.matchEnd)}
                    </span>
                    {h.preview.slice(h.matchEnd)}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Terminal dock (reuses /api/terminal/exec)
// ────────────────────────────────────────────────────────────────────────────

interface TerminalLine {
  cmd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  blocked?: boolean;
}

export function TerminalDock({ cwd }: { cwd: string }) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const run = async (cmd: string) => {
    if (!cmd.trim() || busy) return;
    setBusy(true);
    setHistory((h) => [...h, cmd]);
    setHistIdx(-1);
    try {
      const res = await postJson<{ stdout?: string; stderr?: string; exitCode?: number | null; blocked?: string; requiresApproval?: boolean }>(
        '/api/terminal/exec',
        { command: cmd, cwd },
      );
      setLines((prev) => [...prev, {
        cmd,
        stdout: res.stdout || '',
        stderr: res.stderr || '',
        exitCode: res.exitCode ?? null,
        blocked: res.blocked,
      }]);
    } catch (e) {
      setLines((prev) => [...prev, {
        cmd, stdout: '', stderr: e instanceof Error ? e.message : 'exec failed',
        exitCode: -1,
      }]);
    } finally {
      setBusy(false);
      setInput('');
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { run(input); }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const ni = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1);
      if (history[ni] !== undefined) { setHistIdx(ni); setInput(history[ni]); }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx < 0) return;
      const ni = histIdx + 1;
      if (ni >= history.length) { setHistIdx(-1); setInput(''); }
      else { setHistIdx(ni); setInput(history[ni]); }
    }
  };

  return (
    <div className="h-full flex flex-col bg-[var(--j-bg)]">
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--j-border)] bg-[var(--j-panel)]">
        <TerminalIcon className="h-3 w-3 text-[var(--j-green)]" />
        <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Terminal</span>
        <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)] ml-2 truncate">{cwd}</span>
        <button
          onClick={() => setLines([])}
          className="ml-auto p-0.5 rounded hover:bg-[var(--j-panel-soft)] text-[var(--j-text-mute)]"
          title="Clear"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 jarvis-mono text-[11px]">
        {lines.length === 0 && (
          <div className="text-[var(--j-text-mute)]">
            Ready. Type a command and press Enter. Blocked commands: rm -rf /, sudo, mkfs, etc.
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className="mb-1">
            <div className="text-[var(--j-cyan)]">$ {l.cmd}</div>
            {l.blocked && <div className="text-[var(--j-red)]">⚠ Blocked: {l.blocked}</div>}
            {l.stdout && <pre className="whitespace-pre-wrap text-[var(--j-green)]">{l.stdout}</pre>}
            {l.stderr && <pre className="whitespace-pre-wrap text-[var(--j-red)]">{l.stderr}</pre>}
            {l.exitCode !== null && l.exitCode !== 0 && (
              <div className="text-[var(--j-amber)]">[exit {l.exitCode}]</div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="flex items-center gap-1.5 px-2 py-1 border-t border-[var(--j-border)]">
        <span className="text-[var(--j-cyan)] jarvis-mono text-[11px]">$</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          disabled={busy}
          className="flex-1 bg-transparent border-0 outline-none jarvis-mono text-[11px] text-[var(--j-text)] disabled:opacity-50"
          placeholder={busy ? 'running…' : 'command'}
        />
        {busy && <Loader2 className="h-3 w-3 animate-spin text-[var(--j-cyan)]" />}
        <button
          onClick={() => run(input)}
          disabled={busy || !input.trim()}
          className="p-0.5 rounded text-[var(--j-cyan)] disabled:opacity-50 hover:bg-[var(--j-panel-soft)]"
        >
          <CornerDownLeft className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
