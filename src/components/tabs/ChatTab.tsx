'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Send, Trash2, Sparkles, Zap, Bot, User, ArrowRight, CheckCircle, AlertCircle } from 'lucide-react';
import { useApi, postJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, Pill } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import ReactMarkdown from 'react-markdown';
import { useNavStore } from '@/lib/nav-store';

interface Msg {
  id: string;
  role: string;
  content: string;
  latency?: number;
  model?: string;
  createdAt: string;
  intent?: string;
  actionTaken?: string;
}

const QUICK_PROMPTS = [
  'Show fleet status',
  'Create a task to review the API',
  'What\'s the revenue today?',
  'Navigate to fleet health',
];

const INTENT_ICONS: Record<string, typeof Zap> = {
  navigate: ArrowRight,
  'create-task': CheckCircle,
  'create-agent': Bot,
  'run-skill': Sparkles,
  'send-comms': MessageSquare,
  'health-check': CheckCircle,
  'sync-models': Zap,
  'query-fleet': Bot,
  'query-revenue': Zap,
  'query-tasks': CheckCircle,
  'set-theme': Sparkles,
  search: ArrowRight,
  help: MessageSquare,
  chat: Bot,
};

export default function ChatTab() {
  const { data, refresh } = useApi<{ messages: Msg[] }>('/api/chat?limit=30', 0);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Msg | null>(null);
  const [aiResponse, setAiResponse] = useState<Msg | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const navigate = useNavStore((s) => s.navigate);

  const messages = data?.messages ?? [];

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, draft, aiResponse]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput('');
    setBusy(true);
    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content, createdAt: new Date().toISOString() };
    setDraft(userMsg);
    setAiResponse(null);

    try {
      // Use the smart router (/api/orion/command) instead of basic chat.
      // The smart router parses intents, executes actions (create tasks,
      // spawn agents, navigate tabs, query fleet/revenue, etc.), and
      // returns a structured response.
      const res = await postJson<{
        intent: string;
        response: string;
        latencyMs: number;
        tab?: string;
        task?: unknown;
        agent?: unknown;
        summary?: unknown;
        error?: string;
      }>('/api/orion/command', { text: content, sessionId: 'chat' });

      // Build the assistant message with intent + action metadata.
      const actionDesc = buildActionDescription(res.intent, res);
      const assistantMsg: Msg = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: res.response,
        latency: res.latencyMs,
        model: 'smart-router',
        createdAt: new Date().toISOString(),
        intent: res.intent,
        actionTaken: actionDesc,
      };
      setAiResponse(assistantMsg);

      // If the intent is navigate, actually switch tabs.
      if (res.intent === 'navigate' && res.tab) {
        setTimeout(() => {
          navigate(res.tab as never);
          toast({ title: `Navigated to ${res.tab}` });
        }, 800);
      }

      // Also persist to chat history via the basic chat API (for history display on reload).
      try {
        await postJson('/api/chat', {
          message: content,
          history: messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        }).catch(() => {});
      } catch { /* history save is best-effort */ }

      setDraft(null);
      refresh();
    } catch (e) {
      setDraft(null);
      toast({ title: 'Command failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    refresh();
    setAiResponse(null);
    toast({ title: 'Chat refreshed' });
  };

  const shown: Msg[] = [...messages];
  if (draft) shown.push(draft);
  if (aiResponse) shown.push(aiResponse);
  if (busy && draft && !aiResponse) {
    shown.push({ id: 'typing', role: 'assistant', content: '', createdAt: new Date().toISOString() });
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      <SectionTitle
        title="ARIA Chat"
        icon={MessageSquare}
        accent={JARVIS.colors.violet}
        action={
          <div className="flex items-center gap-2">
            <Pill color={JARVIS.colors.cyan}>Smart Router</Pill>
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
              <h3 className="text-lg font-semibold jarvis-text-gradient">ARIA Online</h3>
              <p className="text-sm text-[var(--j-text-dim)] mt-1 max-w-sm">
                Smart router assistant — I can navigate tabs, create tasks, spawn agents, run skills, query fleet status, and more. Just ask naturally.
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
            {shown.map((m) => {
              const IntentIcon = m.intent ? INTENT_ICONS[m.intent] ?? Bot : null;
              return (
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
                    {/* Intent + action badge for smart router responses */}
                    {m.intent && m.intent !== 'chat' && (
                      <div className="flex items-center gap-2 mt-1">
                        {IntentIcon && (
                          <span className="flex items-center gap-1 jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-[var(--j-cyan)]/15 text-[var(--j-cyan)] border border-[var(--j-cyan)]/30">
                            <IntentIcon className="h-2.5 w-2.5" /> {m.intent}
                          </span>
                        )}
                        {m.actionTaken && (
                          <span className="flex items-center gap-1 jarvis-mono text-[9px] text-[var(--j-green)]">
                            <CheckCircle className="h-2.5 w-2.5" /> {m.actionTaken}
                          </span>
                        )}
                      </div>
                    )}
                    {m.latency != null && (
                      <div className="jarvis-mono text-[9px] text-[var(--j-text-mute)] mt-1 flex items-center gap-1.5">
                        <Zap className="h-2.5 w-2.5" /> {m.latency}ms · {m.model}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
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
              placeholder="Ask ARIA to do anything…  (⏎ to send, ⇧⏎ for newline)"
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

/**
 * Build a human-readable description of the action taken by the smart router.
 */
function buildActionDescription(intent: string, res: Record<string, unknown>): string {
  switch (intent) {
    case 'navigate':
      return `Switched to ${res.tab} tab`;
    case 'create-task':
      return res.task ? 'Task created' : 'Task creation attempted';
    case 'create-agent':
      return res.agent ? 'Agent spawned' : 'Spawn attempted';
    case 'send-comms':
      return res.message ? 'Message sent' : 'Send attempted';
    case 'run-skill':
      return res.skillResult ? 'Skill executed' : 'Execution attempted';
    case 'health-check':
      return 'Health check completed';
    case 'sync-models':
      return res.report ? 'Model sync triggered' : 'Sync attempted';
    case 'query-fleet':
      return 'Fleet status retrieved';
    case 'query-revenue':
      return 'Revenue data retrieved';
    case 'query-tasks':
      return 'Task status retrieved';
    case 'set-theme':
      return 'Theme toggled';
    case 'search':
      return 'Search initiated';
    case 'help':
      return 'Help shown';
    default:
      return '';
  }
}
