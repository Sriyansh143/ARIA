"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  MessagesSquare,
  Loader2,
  Play,
  ChevronDown,
  ChevronRight,
  Brain,
} from "lucide-react";
import { relTime } from "@/hooks/use-clock";

const PARTICIPANTS = [
  { id: "zai", label: "Z-AI (GLM-4.6)" },
  { id: "groq", label: "Groq (Llama-3.3-70b)" },
  { id: "nvidia", label: "NVIDIA (Nemotron-70b)" },
  { id: "ollama", label: "Ollama (Qwen2.5)" },
];

interface DebateEntry {
  id: string;
  topic: string;
  participants: string;
  rounds: number;
  consensus: string;
  confidence: number;
  status: string;
  createdAt: string;
  transcript?: string;
}

interface DebateListResponse {
  debates: DebateEntry[];
}

export function DebatePanel() {
  const [debates, setDebates] = useState<DebateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [selected, setSelected] = useState<string[]>(["zai", "groq", "ollama"]);
  const [rounds, setRounds] = useState(3);

  const fetchDebates = useCallback(async () => {
    try {
      const res = await fetch("/api/debate");
      if (!res.ok) throw new Error("fetch failed");
      const json = (await res.json()) as DebateListResponse;
      setDebates(json.debates ?? []);
    } catch {
      setDebates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDebates();
  }, [fetchDebates]);

  function toggleParticipant(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  async function startDebate() {
    if (!topic.trim()) {
      toast.error("Topic required");
      return;
    }
    if (selected.length < 2) {
      toast.error("Select at least 2 participants");
      return;
    }
    setStarting(true);
    try {
      const res = await fetch("/api/debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, participants: selected, rounds }),
      });
      if (!res.ok) throw new Error("start failed");
      const result = (await res.json()) as {
        id: string;
        consensus: string;
        confidence: number;
        status: string;
      };
      toast.success("Debate completed", {
        description: `Confidence: ${(result.confidence * 100).toFixed(0)}%`,
      });
      setTopic("");
      await fetchDebates();
    } catch {
      toast.error("Debate failed to start");
    } finally {
      setStarting(false);
    }
  }

  function getTranscript(d: DebateEntry): Array<{
    round: number;
    model: string;
    argument: string;
    confidence: number;
    error?: string;
  }> {
    try {
      return JSON.parse(d.transcript ?? "[]");
    } catch {
      return [];
    }
  }

  return (
    <section className="mc-surface flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessagesSquare className="h-4 w-4 text-cyan-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Multi-Model Debate
          </h2>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {debates.length} sessions
        </span>
      </div>

      <div className="mc-scroll max-h-96 flex-1 overflow-y-auto p-3">
        {/* Start form */}
        <div className="mb-3 rounded-md border border-border/50 bg-card/40 p-2.5">
          <label className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            Topic
          </label>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Should ARIA prioritize self-hosting over cloud providers for production LLM calls?"
            className="mt-1 w-full resize-none rounded border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-[11px] text-foreground outline-none focus:border-cyan-500/40"
            rows={2}
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {PARTICIPANTS.map((p) => {
              const on = selected.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggleParticipant(p.id)}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors ${
                    on
                      ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                      : "border-border/40 bg-background/40 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Rounds
            </span>
            <input
              type="range"
              min={1}
              max={5}
              value={rounds}
              onChange={(e) => setRounds(parseInt(e.target.value, 10))}
              className="flex-1 accent-cyan-400"
            />
            <span className="font-mono text-[10px] text-foreground">{rounds}</span>
            <button
              onClick={() => void startDebate()}
              disabled={starting}
              className="flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-cyan-300 transition-colors hover:bg-cyan-500/15 disabled:opacity-50"
            >
              {starting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Play className="h-2.5 w-2.5" />}
              {starting ? "debating…" : "start"}
            </button>
          </div>
        </div>

        {/* Debate list */}
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded bg-border/30" />
            ))}
          </div>
        ) : debates.length === 0 ? (
          <div className="flex h-20 items-center justify-center font-mono text-xs text-muted-foreground">
            no debates yet — start one above
          </div>
        ) : (
          <ul className="space-y-1.5">
            {debates.map((d) => {
              const isOpen = expanded === d.id;
              const transcript = getTranscript(d);
              const confPct = Math.round(d.confidence * 100);
              return (
                <motion.li
                  key={d.id}
                  layout
                  className="rounded-md border border-border/50 bg-card/50 p-2"
                >
                  <button
                    onClick={() => setExpanded(isOpen ? null : d.id)}
                    className="flex w-full items-start justify-between gap-2 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {isOpen ? (
                          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate font-mono text-xs font-medium text-foreground">
                          {d.topic}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 pl-4 font-mono text-[10px] text-muted-foreground">
                        {d.consensus}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                          d.status === "completed"
                            ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
                            : d.status === "failed"
                            ? "border-rose-500/30 bg-rose-500/5 text-rose-300"
                            : "border-amber-500/30 bg-amber-500/5 text-amber-300"
                        }`}
                      >
                        {d.status}
                      </span>
                      <span className="font-mono text-[9px] text-muted-foreground">
                        {relTime(d.createdAt)}
                      </span>
                    </div>
                  </button>

                  {/* Confidence bar */}
                  <div className="mt-1.5 flex items-center gap-2 pl-4">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-border/40">
                      <div
                        className={`h-full rounded-full ${
                          confPct >= 66
                            ? "bg-emerald-400"
                            : confPct >= 33
                            ? "bg-amber-400"
                            : "bg-rose-400"
                        }`}
                        style={{ width: `${Math.max(2, confPct)}%` }}
                      />
                    </div>
                    <span className="font-mono text-[9px] tabular-nums text-muted-foreground">
                      {confPct}%
                    </span>
                  </div>

                  <AnimatePresence initial={false}>
                    {isOpen && transcript.length > 0 && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <ul className="mt-2 space-y-1 border-l border-border/40 pl-3">
                          {transcript.map((t, i) => (
                            <li key={i} className="font-mono text-[10px]">
                              <div className="flex items-center gap-1.5">
                                <Brain className="h-2.5 w-2.5 text-violet-300" />
                                <span className="font-semibold text-violet-300">
                                  {t.model}
                                </span>
                                <span className="text-muted-foreground">
                                  · R{t.round} · {(t.confidence * 100).toFixed(0)}%
                                </span>
                              </div>
                              {t.error ? (
                                <p className="mt-0.5 pl-4 text-rose-300">
                                  error: {t.error}
                                </p>
                              ) : (
                                <p className="mt-0.5 pl-4 text-muted-foreground">
                                  {t.argument}
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
