'use client';

import { useState, useRef, useEffect } from 'react';
import { Terminal, Send, Trash2, Loader2 } from 'lucide-react';
import { JARVIS } from '@/lib/config';
import { SectionTitle } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';

interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  blocked?: string;
}

export default function TerminalTab() {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<Array<{ cmd: string; result: CommandResult | null; loading: boolean }>>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history]);

  const execute = async () => {
    const cmd = input.trim();
    if (!cmd || busy) return;
    setInput('');
    setBusy(true);
    const entry = { cmd, result: null, loading: true };
    setHistory(h => [...h, entry]);

    try {
      const res = await fetch('/api/terminal/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });
      const result: CommandResult = await res.json();
      setHistory(h => h.map((e, i) => i === h.length - 1 ? { ...e, result, loading: false } : e));
    } catch (e) {
      setHistory(h => h.map((e, i) => i === h.length - 1 ? { ...e, result: { success: false, stdout: '', stderr: e instanceof Error ? e.message : 'failed', exitCode: null, timedOut: false }, loading: false } : e));
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setHistory([]);
    toast({ title: 'Terminal cleared' });
  };

  return (
    <div className="space-y-4 h-full flex flex-col">
      <SectionTitle
        title="Terminal"
        icon={Terminal}
        accent={JARVIS.colors.green}
        action={
          <Button size="sm" variant="outline" onClick={clear} className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)]">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <div className="flex-1 min-h-0 jarvis-panel flex flex-col overflow-hidden">
        {/* Output */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto jarvis-scroll p-4 font-mono text-xs space-y-3 min-h-[300px]">
          {history.length === 0 && (
            <div className="text-center py-10 text-[var(--j-text-mute)]">
              <Terminal className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <div className="jarvis-mono uppercase">Terminal ready — type a command and press Enter</div>
              <div className="text-[10px] mt-1">Blocked: rm -rf /, sudo, mkfs. Approval: git push, npm publish.</div>
            </div>
          )}
          {history.map((entry, i) => (
            <div key={i}>
              <div className="flex items-start gap-2">
                <span className="text-[var(--j-green)] shrink-0">$</span>
                <span className="text-[var(--j-cyan)] break-all">{entry.cmd}</span>
              </div>
              {entry.loading ? (
                <div className="ml-4 mt-1 flex items-center gap-2 text-[var(--j-text-mute)]">
                  <Loader2 className="h-3 w-3 animate-spin" /> executing...
                </div>
              ) : entry.result && (
                <div className="ml-4 mt-1">
                  {entry.result.stdout && (
                    <pre className="text-[var(--j-text-dim)] whitespace-pre-wrap break-all">{entry.result.stdout}</pre>
                  )}
                  {entry.result.stderr && (
                    <pre className="text-[var(--j-red)] whitespace-pre-wrap break-all">{entry.result.stderr}</pre>
                  )}
                  {entry.result.blocked && (
                    <pre className="text-[var(--j-red)]">⛔ BLOCKED: {entry.result.blocked}</pre>
                  )}
                  <div className="jarvis-mono text-[9px] text-[var(--j-text-mute)] mt-1">
                    exit: {entry.result.exitCode} · {entry.result.timedOut ? 'timeout' : 'ok'}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {/* Input */}
        <div className="border-t border-[var(--j-border)] p-3 flex items-center gap-2">
          <span className="text-[var(--j-green)] font-mono">$</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); execute(); } }}
            placeholder="Enter command… (e.g. ls -la, git status, echo hello)"
            className="flex-1 bg-transparent outline-none text-sm font-mono text-[var(--j-text)] placeholder:text-[var(--j-text-mute)]"
            disabled={busy}
          />
          <Button onClick={execute} disabled={busy || !input.trim()} className="jarvis-btn-accent border-0 h-8 px-3" size="sm">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
