"use client";

/**
 * /playground — public, no-login LLM playground (LMArena / AutoGPT-style).
 *
 * Anyone with network access to the app can hit this page and chat with
 * the configured LLM providers. The server-side `/api/playground/chat`
 * endpoint enforces strict per-IP rate limits and audits every call to
 * the LlmCall table — so abuse is traceable but the page itself never
 * requires authentication.
 *
 * The page deliberately has NO access to the dashboard, agent fleet,
 * approvals, or any other private data. It is a single chat window.
 */
import { useState, useRef, useEffect, FormEvent } from "react";
import { Send, Sparkles, AlertTriangle, Loader2, Zap } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
}

export default function PlaygroundPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [complexity, setComplexity] = useState<"low" | "medium" | "high">("low");
  const [status, setStatus] = useState<{
    enabled: boolean;
    rateLimitPerMin: number;
    maxPromptChars: number;
    maxResponseChars: number;
    providers: { zai: boolean; groq: boolean; nvidia: boolean; ollama: boolean };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch the playground status banner on first render.
  useEffect(() => {
    fetch("/api/playground/chat")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  // Auto-scroll to bottom on new message.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const userMessage = input.trim();
    setInput("");
    setError(null);
    setMessages((m) => [...m, { role: "user", content: userMessage }]);
    setLoading(true);

    try {
      const res = await fetch("/api/playground/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, complexity }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errMsg = data.error || `request failed (${res.status})`;
        setError(errMsg);
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: `[error: ${errMsg}${data.detail ? ` — ${data.detail}` : ""}]`,
          },
        ]);
      } else {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: data.reply,
            provider: data.provider,
            model: data.model,
            latencyMs: data.latencyMs,
          },
        ]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `[network error: ${msg}]` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const providerLabels = status
    ? [
        status.providers.zai && "Z-AI",
        status.providers.groq && "Groq",
        status.providers.nvidia && "NVIDIA",
        status.providers.ollama && "Ollama",
      ]
        .filter(Boolean)
        .join(" · ")
    : "loading…";

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800/80 bg-zinc-900/60 backdrop-blur px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-violet-500/20 p-1.5">
              <Sparkles className="h-4 w-4 text-violet-300" />
            </div>
            <div>
              <h1 className="text-sm font-semibold">ARIA Playground</h1>
              <p className="text-[10px] text-muted-foreground">
                Public · No login · {providerLabels}
              </p>
            </div>
          </div>
          <a
            href="/"
            className="text-[10px] text-muted-foreground hover:text-zinc-200 underline-offset-2 hover:underline"
          >
            ← back to ARIA
          </a>
        </div>
      </header>

      {/* Status banner */}
      {status && !status.enabled && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-center text-[11px] text-amber-300">
          <AlertTriangle className="inline h-3 w-3 mr-1" />
          The playground has been disabled by the operator.
        </div>
      )}

      {/* Chat window */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6"
      >
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground mt-12">
              <Sparkles className="h-8 w-8 mx-auto mb-3 text-violet-400/60" />
              <p className="text-sm">
                Ask anything. Responses come from the same 4-provider failover
                chain that powers ARIA&apos;s 37-agent fleet.
              </p>
              <p className="text-[10px] mt-2 text-zinc-600">
                Rate-limited to {status?.rateLimitPerMin ?? "…"} requests / min per IP.
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-violet-600/80 text-white"
                    : "bg-muted/80 text-foreground"
                }`}
              >
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
                {m.provider && (
                  <div className="mt-1.5 text-[9px] text-muted-foreground flex items-center gap-2">
                    <span>
                      {m.provider} · {m.model}
                    </span>
                    {m.latencyMs !== undefined && (
                      <span className="text-muted-foreground">{m.latencyMs}ms</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted/80 rounded-lg px-3 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-zinc-800/80 bg-zinc-900/60 backdrop-blur px-4 py-3"
      >
        <div className="max-w-3xl mx-auto">
          {error && (
            <div className="mb-2 text-[10px] text-rose-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {error}
            </div>
          )}
          <div className="flex items-end gap-2">
            <select
              value={complexity}
              onChange={(e) => setComplexity(e.target.value as "low" | "medium" | "high")}
              className="bg-muted border border-border rounded-md px-2 py-2 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
              title="Complexity tier (routes to larger/smaller models)"
            >
              <option value="low">fast</option>
              <option value="medium">balanced</option>
              <option value="high">strong</option>
            </select>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e as unknown as FormEvent);
                }
              }}
              placeholder="Ask ARIA anything…  (Enter to send, Shift+Enter for newline)"
              rows={1}
              maxLength={status?.maxPromptChars ?? 4000}
              className="flex-1 resize-none bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-violet-500 max-h-32"
              disabled={loading || status?.enabled === false}
            />
            <button
              type="submit"
              disabled={loading || !input.trim() || status?.enabled === false}
              className="rounded-md bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 disabled:text-muted-foreground px-3 py-2 text-sm font-medium text-white transition-colors"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Zap className="h-3 w-3" />
              Server-side LLM · No login · Audited
            </span>
            <span>
              {input.length} / {status?.maxPromptChars ?? 4000}
            </span>
          </div>
        </div>
      </form>
    </main>
  );
}
