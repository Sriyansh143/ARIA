"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import {
  ConductorEmblem,
  Dot,
} from "@/components/mission/terminal-primitives";
import {
  Send,
  Mic,
  Sparkles,
  X,
  ChevronDown,
  ChevronUp,
  Radio,
} from "lucide-react";

interface ChatMessage {
  id: string;
  role: "operator" | "conductor";
  text: string;
  ts: string;
  agentName?: string;
}

/**
 * SpeakingAssistant — Gemini-style compact AI conversational UI.
 *
 * Sits at the top of the dashboard (below the stats bar) as a compact
 * strip. Features:
 *  - A "Conductor" emblem with comet sweep when "thinking"
 *  - A voice waveform animation (animated bars) when listening/speaking
 *  - A text input for typed queries
 *  - A mic toggle for voice mode (visual only — no actual audio capture
 *    to keep the component self-contained)
 *  - Collapsible chat history (expand/collapse)
 *  - Simulated responses that reference live dashboard state (agent count,
 *    task status, revenue, alerts)
 *
 * The assistant "speaks" by cycling through context-aware responses
 * derived from the live store — it feels alive because it references
 * real data.
 */

const WAVEFORM_BARS = 24;

// Simulated conductor responses — context-aware, referencing live data.
function generateResponse(
  agents: Record<string, { name: string; status: string }>,
  tasks: Record<string, { status: string }>,
  alerts: { severity: string; ack: boolean }[],
  revenue: { amount: number }[]
): string {
  const agentList = Object.values(agents);
  const activeAgents = agentList.filter((a) => a.status !== "idle" && a.status !== "offline").length;
  const errorAgents = agentList.filter((a) => a.status === "error").length;
  const runningTasks = Object.values(tasks).filter((t) => t.status === "running").length;
  const completedTasks = Object.values(tasks).filter((t) => t.status === "completed").length;
  const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
  const unacked = alerts.filter((a) => !a.ack && (a.severity === "error" || a.severity === "critical")).length;

  const responses = [
    `Fleet status: ${activeAgents}/${agentList.length} agents active, ${runningTasks} tasks in flight, ${completedTasks} completed. ${errorAgents > 0 ? `${errorAgents} agents in error state — self-healing engaged.` : "All systems nominal."}`,
    `Revenue at $${(totalRevenue / 1000).toFixed(1)}k. ${unacked > 0 ? `${unacked} unacknowledged alerts need attention.` : "No pending alerts."} Pipeline is ${runningTasks > 3 ? "at capacity" : "healthy"}.`,
    `I'm monitoring ${agentList.length} agents across the fleet. ${activeAgents} are currently executing. The event stream is live — I can see ${Object.keys(tasks).length} tasks in the pipeline.`,
    `Current mission tempo: ${runningTasks} concurrent tasks, ${completedTasks} done. ${errorAgents > 0 ? "I've detected errors and initiated failover." : "Reliability is holding at 100%."} Want me to dispatch a new task?`,
    `All ${agentList.length} agents reporting. ${activeAgents} active, ${agentList.length - activeAgents} idle. Revenue tracking at $${(totalRevenue / 1000).toFixed(1)}k. I'm watching ${unacked} critical signals.`,
  ];

  return responses[Math.floor(Math.random() * responses.length)];
}

export function SpeakingAssistant() {
  const agents = useMissionStore((s) => s.agents);
  const tasks = useMissionStore((s) => s.tasks);
  const alerts = useMissionStore((s) => s.alerts);
  const revenueEvents = useMissionStore((s) => s.revenueEvents);
  const agentMessages = useMissionStore((s) => s.agentMessages);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [waveform, setWaveform] = useState<number[]>(new Array(WAVEFORM_BARS).fill(0.1));
  const rafRef = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initialize with a welcome message.
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: "welcome",
          role: "conductor",
          text: "Conductor online. I'm monitoring the fleet in real-time. Ask me anything, or just listen — I'll surface what matters.",
          ts: new Date().toISOString(),
          agentName: "Conductor",
        },
      ]);
    }
  }, [messages.length]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Waveform animation when speaking/listening.
  useEffect(() => {
    if (!speaking) {
      setWaveform(new Array(WAVEFORM_BARS).fill(0.1));
      return;
    }
    let frame = 0;
    const animate = () => {
      frame++;
      setWaveform(
        Array.from({ length: WAVEFORM_BARS }, (_, i) => {
          const phase = (frame * 0.05 + i * 0.4) % (Math.PI * 2);
          return 0.15 + Math.abs(Math.sin(phase)) * 0.7 + Math.random() * 0.15;
        })
      );
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [speaking]);

  const send = useCallback(() => {
    if (!input.trim()) return;
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "operator",
      text: input.trim(),
      ts: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setThinking(true);

    // Call the real Conductor API (which uses z-ai-web-dev-sdk).
    const messageText = input.trim();
    (async () => {
      try {
        const res = await fetch("/api/conductor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: messageText }),
        });
        const data = (await res.json()) as { response?: string; fallback?: string; latencyMs?: number };
        const responseText = data.response ?? data.fallback ?? "I'm here. The fleet is operational.";

        setThinking(false);
        setSpeaking(true);
        const conductorMsg: ChatMessage = {
          id: `c-${Date.now()}`,
          role: "conductor",
          text: responseText,
          ts: new Date().toISOString(),
          agentName: "Conductor",
        };
        setMessages((prev) => [...prev, conductorMsg]);

        // "Speak" for a duration proportional to response length.
        setTimeout(() => setSpeaking(false), Math.min(4000, responseText.length * 40));
      } catch {
        setThinking(false);
        setSpeaking(true);
        const conductorMsg: ChatMessage = {
          id: `c-${Date.now()}`,
          role: "conductor",
          text: "I'm having trouble connecting right now. The fleet is still operational — try again in a moment.",
          ts: new Date().toISOString(),
          agentName: "Conductor",
        };
        setMessages((prev) => [...prev, conductorMsg]);
        setTimeout(() => setSpeaking(false), 2000);
      }
    })();
  }, [input]);

  const toggleMic = useCallback(() => {
    setSpeaking((prev) => !prev);
  }, []);

  // Live status derived from store.
  const liveStatus = (() => {
    const agentList = Object.values(agents);
    const active = agentList.filter((a) => a.status !== "idle" && a.status !== "offline").length;
    const msgs = agentMessages.length;
    return `${active}/${agentList.length} agents · ${msgs} msgs · ${Object.keys(tasks).length} tasks`;
  })();

  return (
    <section className="mc-surface flex flex-col overflow-hidden">
      {/* Header bar — always visible */}
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5">
        {/* Conductor emblem */}
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center">
          <ConductorEmblem size={32} active={thinking || speaking} />
        </div>

        {/* Status text */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold uppercase tracking-[0.15em] text-foreground">
              Conductor
            </span>
            {thinking ? (
              <span className="font-mono text-[9px] uppercase tracking-wider text-violet-300">
                thinking…
              </span>
            ) : speaking ? (
              <span className="font-mono text-[9px] uppercase tracking-wider text-cyan-300">
                speaking…
              </span>
            ) : (
              <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-emerald-300">
                <Dot status="ok" blink size={5} /> online
              </span>
            )}
          </div>
          <div className="truncate font-mono text-[9px] text-muted-foreground">
            {liveStatus}
          </div>
        </div>

        {/* Waveform (compact, always visible when speaking) */}
        <div className="flex h-6 items-center gap-px">
          {waveform.map((h, i) => (
            <motion.div
              key={i}
              className="w-0.5"
              animate={{ height: `${h * 100}%`, opacity: speaking ? 1 : 0.2 }}
              transition={{ duration: 0.05 }}
              style={{
                background: speaking
                  ? "oklch(0.78 0.16 195)"
                  : "oklch(0.4 0.01 250)",
                minHeight: "2px",
              }}
            />
          ))}
        </div>

        {/* Expand/collapse */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex h-7 w-7 items-center justify-center border border-border/60 text-muted-foreground transition-colors hover:text-foreground"
          style={{ borderRadius: 0 }}
          aria-label={expanded ? "Collapse chat" : "Expand chat"}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Expanded chat history */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div
              ref={scrollRef}
              className="mc-scroll max-h-48 space-y-2 overflow-y-auto p-3"
            >
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "operator" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] border px-2.5 py-1.5 font-mono text-[11px] leading-relaxed ${
                      msg.role === "operator"
                        ? "border-cyan-500/30 bg-cyan-500/5 text-foreground"
                        : "border-violet-500/30 bg-violet-500/5 text-foreground/90"
                    }`}
                    style={{ borderRadius: 0 }}
                  >
                    {msg.role === "conductor" && msg.agentName && (
                      <div className="mb-0.5 flex items-center gap-1 font-mono text-[8px] uppercase tracking-wider text-violet-300">
                        <Sparkles className="h-2 w-2" />
                        {msg.agentName}
                      </div>
                    )}
                    {msg.text}
                  </div>
                </div>
              ))}
              {thinking && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1 border border-violet-500/30 bg-violet-500/5 px-2.5 py-1.5" style={{ borderRadius: 0 }}>
                    <span className="font-mono text-[10px] text-violet-300">processing</span>
                    <div className="flex gap-0.5">
                      {[0, 1, 2].map((i) => (
                        <motion.span
                          key={i}
                          className="h-1 w-1 bg-violet-400"
                          initial={{ opacity: 0.3 }} animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input bar — always visible */}
      <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2">
        <button
          onClick={toggleMic}
          className={`flex h-7 w-7 shrink-0 items-center justify-center border transition-colors ${
            speaking
              ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
              : "border-border/60 text-muted-foreground hover:text-foreground"
          }`}
          style={{ borderRadius: 0 }}
          aria-label="Toggle voice mode"
        >
          <Mic className="h-3.5 w-3.5" />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask the Conductor…"
          className="flex-1 bg-transparent font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <button
          onClick={send}
          disabled={!input.trim()}
          className="flex h-7 w-7 shrink-0 items-center justify-center border border-violet-500/40 bg-violet-500/10 text-violet-300 transition-colors hover:bg-violet-500/20 disabled:opacity-30"
          style={{ borderRadius: 0 }}
          aria-label="Send"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </section>
  );
}
