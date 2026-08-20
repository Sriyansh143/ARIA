"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Terminal,
  Send,
  Loader2,
  CornerDownLeft,
  Trash2,
  ChevronRight,
  User,
  Cpu,
  AlertCircle,
} from "lucide-react";
import { FullScreenPanel } from "./full-screen-panel";

/**
 * AgentCommandConsole — terminal-style interface for sending ad-hoc
 * commands to the ARIA Conductor.
 *
 * POSTs to /api/conductor with {message}. Displays the response with
 * routing info (which agent handled it, confidence, method). Keeps a
 * scrollable history of commands + responses. Supports command history
 * navigation (up/down arrows) and quick-action preset commands.
 *
 * This is the "operator's terminal" — for power users who want to
 * directly instruct the agent fleet without clicking through panels.
 */

interface ConsoleEntry {
  id: string;
  type: "command" | "response" | "error";
  content: string;
  agent?: string;
  role?: string;
  confidence?: number;
  method?: string;
  latencyMs?: number;
  timestamp: string;
}

const PRESET_COMMANDS = [
  "What's the current revenue status?",
  "Show me all pending approvals",
  "Which agents are most active right now?",
  "Generate a daily summary report",
  "Run a feasibility check on the top opportunity",
  "What tasks are blocked and why?",
];

export function AgentCommandConsole() {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<ConsoleEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const commandHistory = useRef<string[]>([]);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  const sendCommand = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed || loading) return;

    const commandEntry: ConsoleEntry = {
      id: `cmd-${Date.now()}`,
      type: "command",
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    setHistory((h) => [...h, commandEntry]);
    commandHistory.current.push(trimmed);
    setHistoryIndex(-1);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/conductor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const data = await res.json();

      if (data.error) {
        setHistory((h) => [
          ...h,
          {
            id: `err-${Date.now()}`,
            type: "error",
            content: data.error,
            timestamp: new Date().toISOString(),
          },
        ]);
      } else {
        setHistory((h) => [
          ...h,
          {
            id: `res-${Date.now()}`,
            type: "response",
            content: data.response ?? "(no response)",
            agent: data.routing?.agent,
            role: data.routing?.role,
            confidence: data.routing?.confidence,
            method: data.routing?.method,
            latencyMs: data.latencyMs,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    } catch (err) {
      setHistory((h) => [
        ...h,
        {
          id: `err-${Date.now()}`,
          type: "error",
          content: `Network error: ${String(err)}`,
          timestamp: new Date().toISOString(),
        },
      ]);
      toast.error("Command failed — network error");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [loading]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void sendCommand(input);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (commandHistory.current.length === 0) return;
        const newIdx = historyIndex === -1 ? commandHistory.current.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIdx);
        setInput(commandHistory.current[newIdx]);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (historyIndex === -1) return;
        const newIdx = historyIndex + 1;
        if (newIdx >= commandHistory.current.length) {
          setHistoryIndex(-1);
          setInput("");
        } else {
          setHistoryIndex(newIdx);
          setInput(commandHistory.current[newIdx]);
        }
      } else if (e.key === "l" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setHistory([]);
        toast.success("Console cleared");
      }
    },
    [input, historyIndex, sendCommand]
  );

  return (
    <FullScreenPanel title="Agent Command Console" icon={<Terminal className="h-3.5 w-3.5 text-emerald-400" />}>
      <div className="flex flex-col" style={{ minHeight: "400px" }}>
        {/* Console output — scrollable */}
        <div
          ref={scrollRef}
          className="mc-scroll flex-1 overflow-y-auto bg-[#0a0a0f] p-3 font-mono text-[11px] leading-relaxed"
          style={{ minHeight: "280px", maxHeight: "50vh" }}
          onClick={() => inputRef.current?.focus()}
        >
          {history.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Terminal className="h-8 w-8 opacity-30" />
              <div className="text-[10px] uppercase tracking-wider">Console ready</div>
              <div className="text-[9px] text-muted-foreground/60">
                Type a command or pick a preset below. ↑↓ for history, Ctrl+L to clear.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {history.map((entry) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    {entry.type === "command" && (
                      <div className="flex items-start gap-2">
                        <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-violet-400" />
                        <span className="text-violet-300">{entry.content}</span>
                      </div>
                    )}
                    {entry.type === "response" && (
                      <div className="ml-4 space-y-1.5 border-l border-border/40 pl-3">
                        {(entry.agent || entry.role) && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {entry.agent && (
                              <span className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] uppercase text-emerald-300">
                                <Cpu className="h-2.5 w-2.5" />
                                {entry.agent}
                              </span>
                            )}
                            {entry.role && (
                              <span className="rounded border border-border/60 bg-surface-2 px-1.5 py-0.5 text-[9px] uppercase text-muted-foreground">
                                {entry.role}
                              </span>
                            )}
                            {entry.method && (
                              <span className="text-[9px] text-muted-foreground/60">
                                via {entry.method}
                              </span>
                            )}
                            {typeof entry.confidence === "number" && (
                              <span className="text-[9px] text-cyan-400">
                                {Math.round(entry.confidence * 100)}% conf
                              </span>
                            )}
                            {entry.latencyMs !== undefined && (
                              <span className="text-[9px] text-muted-foreground/60">
                                {entry.latencyMs}ms
                              </span>
                            )}
                          </div>
                        )}
                        <div className="whitespace-pre-wrap text-foreground/90">{entry.content}</div>
                      </div>
                    )}
                    {entry.type === "error" && (
                      <div className="ml-4 flex items-start gap-2 border-l border-rose-500/40 pl-3 text-rose-300">
                        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>{entry.content}</span>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {loading && (
                <div className="ml-4 flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="text-[10px]">routing to agent…</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Preset commands */}
        {history.length === 0 && (
          <div className="border-t border-border/60 p-2">
            <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Preset Commands
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COMMANDS.map((cmd) => (
                <button
                  key={cmd}
                  onClick={() => void sendCommand(cmd)}
                  disabled={loading}
                  className="rounded border border-border/60 bg-surface-2 px-2 py-1 font-mono text-[9px] text-muted-foreground transition-colors hover:border-emerald-500/40 hover:text-emerald-300 disabled:opacity-50"
                >
                  {cmd.length > 40 ? cmd.slice(0, 37) + "…" : cmd}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input row */}
        <div className="flex items-center gap-2 border-t border-border/60 bg-surface-2 px-3 py-2">
          <User className="h-3.5 w-3.5 shrink-0 text-violet-400" />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            placeholder="Send a command to the ARIA Conductor…"
            className="flex-1 bg-transparent font-mono text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-50"
            autoFocus
          />
          {history.length > 0 && (
            <button
              onClick={() => { setHistory([]); toast.success("Console cleared"); }}
              className="flex items-center gap-1 rounded border border-border/60 px-1.5 py-1 font-mono text-[9px] uppercase text-muted-foreground hover:text-rose-300"
              title="Clear console (Ctrl+L)"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={() => void sendCommand(input)}
            disabled={loading || !input.trim()}
            className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 font-mono text-[9px] font-semibold uppercase text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Send
          </button>
        </div>

        {/* Hint bar */}
        <div className="flex items-center justify-between border-t border-border/40 px-3 py-1.5 font-mono text-[8px] text-muted-foreground/60">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <CornerDownLeft className="h-2.5 w-2.5" /> send
            </span>
            <span>↑↓ history</span>
            <span>Ctrl+L clear</span>
          </div>
          <span>{history.length} entries</span>
        </div>
      </div>
    </FullScreenPanel>
  );
}

export default AgentCommandConsole;
