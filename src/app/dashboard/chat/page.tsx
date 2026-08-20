"use client";

/**
 * src/app/dashboard/chat/page.tsx — Phase 32
 *
 * Chat tab that consumes the SSE streaming endpoint at /api/chat/stream.
 * Renders tokens as they arrive (like ChatGPT), with markdown + code
 * syntax highlighting.
 *
 * INFRASTRUCTURE (already in place from v81)
 * - /api/chat/stream SSE endpoint (172 lines) — emits {type:"token",content}
 * - use-sse-stream.ts hook (58 lines) — EventSource wrapper
 * - react-markdown + react-syntax-highlighter — installed
 *
 * This route wires it all together into a chat UI.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, Square } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [partialResponse, setPartialResponse] = React.useState("");
  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new content.
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, partialResponse]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || streaming) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setStreaming(true);
    setPartialResponse("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Stream failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          try {
            const event = JSON.parse(data) as {
              type: "token" | "done" | "error" | "connected" | "heartbeat";
              content?: string;
              fullResponse?: string;
              error?: string;
              latencyMs?: number;
            };

            if (event.type === "token" && event.content) {
              fullResponse += event.content;
              setPartialResponse(fullResponse);
            } else if (event.type === "done") {
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: event.fullResponse ?? fullResponse,
                  timestamp: new Date().toISOString(),
                },
              ]);
              setPartialResponse("");
            } else if (event.type === "error") {
              setMessages((prev) => [
                ...prev,
                {
                  role: "system",
                  content: `Error: ${event.error}`,
                  timestamp: new Date().toISOString(),
                },
              ]);
              setPartialResponse("");
            }
          } catch {
            // Ignore unparseable lines (keepalives, etc.)
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: `Stream failed: ${(err as Error).message}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    } finally {
      setStreaming(false);
      setPartialResponse("");
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setStreaming(false);
    if (partialResponse) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: partialResponse + " [stopped]",
          timestamp: new Date().toISOString(),
        },
      ]);
      setPartialResponse("");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e as unknown as React.FormEvent);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div>
          <h1 className="text-lg font-semibold">Chat</h1>
          <p className="text-xs text-muted-foreground">
            SSE token streaming · powered by the LLM router (Z-AI → Groq → Ollama)
          </p>
        </div>
        <button
          onClick={() => router.push("/dashboard")}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Back to Dashboard
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !partialResponse && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 text-white">
                <Send className="h-5 w-5" />
              </div>
              <h2 className="mb-2 text-lg font-medium">Chat with ARIA</h2>
              <p className="text-sm text-muted-foreground">
                Ask anything. Responses stream token-by-token via Server-Sent Events.
                The LLM router automatically falls back across providers.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}

        {partialResponse && (
          <MessageBubble
            message={{
              role: "assistant",
              content: partialResponse,
              timestamp: new Date().toISOString(),
            }}
            streaming
          />
        )}
      </div>

      {/* Input */}
      <div className="border-t border-white/5 px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message… (Enter to send, Shift+Enter for newline)"
            rows={2}
            disabled={streaming}
            className="flex-1 resize-none rounded-lg border border-white/10 bg-background/60 px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 disabled:opacity-50"
          />
          {streaming ? (
            <button
              onClick={handleStop}
              className="flex h-10 items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 text-sm font-medium text-red-400 hover:bg-red-500/20"
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="flex h-10 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MessageBubble ───────────────────────────────────────────────────

function MessageBubble({
  message,
  streaming,
}: {
  message: ChatMessage;
  streaming?: boolean;
}) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  return (
    <div className={`flex ${isUser ? "justify-end" : isSystem ? "justify-center" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 ${
          isUser
            ? "bg-emerald-500/15 border border-emerald-500/30"
            : isSystem
              ? "bg-red-500/10 border border-red-500/20 text-center text-xs"
              : "bg-cyan-500/10 border border-cyan-500/20"
        }`}
      >
        <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider opacity-60">
          <span>{message.role}</span>
          <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          {streaming && <Loader2 className="h-3 w-3 animate-spin" />}
        </div>
        <div className="text-sm prose prose-invert prose-sm max-w-none">
          <ReactMarkdown
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className ?? "");
                const isInline = !match;
                return isInline ? (
                  <code className="px-1 py-0.5 rounded bg-black/40 text-xs" {...props}>
                    {children}
                  </code>
                ) : (
                  <SyntaxHighlighter
                    style={oneDark as React.CSSProperties}
                    language={match[1]}
                    PreTag="div"
                    customStyle={{ margin: 0, background: "transparent", fontSize: "12px" }}
                  >
                    {String(children).replace(/\n$/, "")}
                  </SyntaxHighlighter>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
