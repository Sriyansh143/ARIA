'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Send, Trash2, Sparkles, Zap, Bot, User } from 'lucide-react';
import { useApi, postJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, Pill } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import ReactMarkdown from 'react-markdown';

interface Msg {
  id: string;
  role: string;
  content: string;
  latency?: number;
  model?: string;
  createdAt: string;
}

const QUICK_PROMPTS = [
  'Summarize the current fleet status',
  'Decompose a goal: ship a pricing page',
  'Write a Python function to dedupe a list',
  'What should I monitor for the ATLAS agent?',
];

export default function ChatTab() {
  const { data, refresh } = useApi<{ messages: Msg[] }>('/api/chat?limit=30', 0);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Msg | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const messages = data?.messages ?? [];

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, draft]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput('');
    setBusy(true);
    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content, createdAt: new Date().toISOString() };
    setDraft(userMsg);
    try {
      const history = messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
      const res = await postJson<{ message: Msg }>('/api/chat', { message: content, history });
      setDraft(null);
      refresh();
      void res;
    } catch (e) {
      setDraft(null);
      toast({ title: 'Chat error', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    // Soft-clear: just refetch (history persists server-side; provide a visual reset)
    refresh();
    toast({ title: 'Chat refreshed' });
  };

  const shown: Msg[] = [...messages];
  if (draft) shown.push(draft);
  if (busy && draft) {
    shown.push({ id: 'typing', role: 'assistant', content: '', createdAt: new Date().toISOString() });
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      <SectionTitle
        title="JARVIS Chat"
        icon={MessageSquare}
        accent={JARVIS.colors.violet}
        action={
          <div className="flex items-center gap-2">
            <Pill color={JARVIS.colors.green}>AI Engine</Pill>
            <Button size="sm" variant="outline" onClick={clear} className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)]">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        }
      />

      <div className="flex-1 min-h-0 jarvis-panel flex flex-col overflow-hidden">
        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto jarvis-scroll p-4 space-y-4 min-h-[300px]">
          {shown.length === 0 && !busy && (
            <div className="flex flex-col items-center justify-center h-full text-center py-10">
              <div className="relative mb-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl jarvis-btn-accent">
                  <Bot className="h-7 w-7" />
                </div>
                <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[var(--j-green)] jarvis-blink" />
              </div>
              <h3 className="text-lg font-semibold jarvis-text-gradient">JARVIS Online</h3>
              <p className="text-sm text-[var(--j-text-dim)] mt-1 max-w-sm">
                Autonomous orchestration assistant powered by the AI engine. Ask me to plan, decompose, analyze, or coordinate the fleet.
              </p>
              <div className="flex flex-wrap gap-2 mt-5 justify-center max-w-lg">
                {QUICK_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => send(p)}
                    className="text-xs px-3 py-1.5 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] hover:border-[var(--j-cyan)] hover:text-[var(--j-cyan)] transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          <AnimatePresence initial={false}>
            {shown.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                  style={{
                    background: m.role === 'user' ? `${JARVIS.colors.cyan}1a` : `${JARVIS.colors.violet}1a`,
                    border: `1px solid ${m.role === 'user' ? JARVIS.colors.cyan : JARVIS.colors.violet}33`,
                    color: m.role === 'user' ? JARVIS.colors.cyan : JARVIS.colors.violet,
                  }}
                >
                  {m.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                </div>
                <div className={`max-w-[80%] ${m.role === 'user' ? 'items-end text-right' : ''} flex flex-col`}>
                  <div
                    className={`rounded-lg px-3.5 py-2.5 text-sm ${m.role === 'user' ? 'bg-[var(--j-cyan)]/10 border border-[var(--j-cyan)]/30' : 'bg-[var(--j-panel-soft)] border border-[var(--j-border)]'}`}
                    style={{ color: 'var(--j-text)' }}
                  >
                    {m.id === 'typing' ? (
                      <div className="flex items-center gap-1 py-1">
                        <span className="jarvis-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--j-violet)]" style={{ animationDelay: '0s' }} />
                        <span className="jarvis-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--j-violet)]" style={{ animationDelay: '0.2s' }} />
                        <span className="jarvis-typing-dot h-1.5 w-1.5 rounded-full bg-[var(--j-violet)]" style={{ animationDelay: '0.4s' }} />
                      </div>
                    ) : m.role === 'assistant' ? (
                      <div className="prose-chat">
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    )}
                  </div>
                  {m.latency != null && (
                    <div className="jarvis-mono text-[9px] text-[var(--j-text-mute)] mt-1 flex items-center gap-1.5">
                      <Zap className="h-2.5 w-2.5" /> {m.latency}ms · {m.model}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Composer */}
        <div className="border-t border-[var(--j-border)] p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              placeholder="Message JARVIS…  (⏎ to send, ⇧⏎ for newline)"
              className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[44px] max-h-32 resize-none text-sm"
              rows={1}
            />
            <Button onClick={() => send()} disabled={busy || !input.trim()} className="jarvis-btn-accent border-0 h-11 w-11 p-0 shrink-0">
              {busy ? <Sparkles className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
