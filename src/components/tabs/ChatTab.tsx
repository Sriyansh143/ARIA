'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare, Send, Trash2, Sparkles, Zap, Bot, User, ArrowRight,
  CheckCircle, AlertCircle, Mic, MicOff, Volume2, VolumeX, Undo2, Loader2,
} from 'lucide-react';
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
  'Plan: decompose Q3 roadmap into agent tasks',
  'Search for: latest Next.js 16 features',
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
  'make-plan': Sparkles,
  chat: Bot,
};

const WAKE_WORDS = ['orion', 'aria', 'hey orion', 'hey aria'];

export default function ChatTab() {
  const { data, refresh } = useApi<{ messages: Msg[] }>('/api/chat?limit=30', 0);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Msg | null>(null);
  const [aiResponse, setAiResponse] = useState<Msg | null>(null);
  const [undoInfo, setUndoInfo] = useState<{ resourceId?: string; resourceType?: string; description: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const navigate = useNavStore((s) => s.navigate);

  // Voice state
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [interimText, setInterimText] = useState('');
  const recognitionRef = useRef<any>(null);
  const shouldListenRef = useRef(false);
  const finalBufRef = useRef('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const messages = data?.messages ?? [];

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, draft, aiResponse, interimText]);

  // Detect speech API support + load voice preferences
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    setVoiceSupported(!!SR);
    try {
      const v = localStorage.getItem('jarvis-chat-voice');
      if (v === '1') setVoiceEnabled(true);
      const m = localStorage.getItem('jarvis-chat-muted');
      if (m === '1') setMuted(true);
    } catch { /* ignore */ }
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
      }
    };
  }, []);

  // TTS
  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis || muted) return;
    window.speechSynthesis.cancel();
    const clean = text.replace(/[#*`_>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 600);
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.rate = 1.02;
    u.pitch = 1.0;
    if (window.speechSynthesis.getVoices) {
      const voices = window.speechSynthesis.getVoices();
      const pref = voices.find((v) => /en[-_]?US/i.test(v.lang) && /female|samantha|aria|jenny|zira/i.test(v.name))
        || voices.find((v) => /en[-_]?US/i.test(v.lang));
      if (pref) u.voice = pref;
    }
    window.speechSynthesis.speak(u);
  }, [muted]);

  // Start voice recognition with wake word detection
  const startListening = useCallback(() => {
    if (!voiceSupported) return;
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) return;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    shouldListenRef.current = true;
    setListening(true);

    rec.onresult = (e: any) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      setInterimText(interim);

      if (final) {
        finalBufRef.current = (finalBufRef.current + ' ' + final).trim();
        const lower = finalBufRef.current.toLowerCase();

        // Check for wake word
        let cmd: string | null = null;
        for (const w of WAKE_WORDS) {
          const idx = lower.indexOf(w);
          if (idx >= 0) {
            const after = finalBufRef.current.slice(idx + w.length).replace(/^[\s,.:!?]+/, '').trim();
            if (after) cmd = after;
            break;
          }
        }

        if (cmd) {
          finalBufRef.current = '';
          setInterimText('');
          void send(cmd);
        } else if (!lower.includes('orion') && !lower.includes('aria')) {
          // No wake word — if voice is enabled and there's a pause, send as direct command
          if (debounceRef.current) clearTimeout(debounceRef.current);
          const snapshot = finalBufRef.current;
          debounceRef.current = setTimeout(() => {
            if (snapshot && shouldListenRef.current) {
              finalBufRef.current = '';
              setInterimText('');
              void send(snapshot);
            }
          }, 1500);
        }
      }
    };

    rec.onerror = (e: any) => {
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        toast({ title: 'Microphone permission denied', variant: 'destructive' });
        setVoiceEnabled(false);
      }
    };

    rec.onend = () => {
      if (shouldListenRef.current) {
        try { rec.start(); } catch { /* ignore */ }
      } else {
        setListening(false);
      }
    };

    try {
      rec.start();
      recognitionRef.current = rec;
    } catch { /* ignore */ }
  }, [voiceSupported]);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    setListening(false);
    setInterimText('');
  }, []);

  // Toggle voice on/off
  const toggleVoice = useCallback(() => {
    if (voiceEnabled) {
      setVoiceEnabled(false);
      stopListening();
      try { localStorage.setItem('jarvis-chat-voice', '0'); } catch { /* ignore */ }
    } else {
      setVoiceEnabled(true);
      try { localStorage.setItem('jarvis-chat-voice', '1'); } catch { /* ignore */ }
      startListening();
    }
  }, [voiceEnabled, startListening, stopListening]);

  // Auto-start voice if enabled
  useEffect(() => {
    if (voiceSupported && voiceEnabled && !listening) {
      const timer = setTimeout(() => startListening(), 300);
      return () => clearTimeout(timer);
    }
  }, [voiceSupported, voiceEnabled, listening, startListening]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput('');
    setBusy(true);
    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content, createdAt: new Date().toISOString() };
    setDraft(userMsg);
    setAiResponse(null);
    setUndoInfo(null);

    try {
      const res = await postJson<{
        intent: string;
        response: string;
        latencyMs: number;
        tab?: string;
        task?: { id?: string; title?: string };
        agent?: { id?: string; codename?: string };
        message?: { id?: string; subject?: string };
        error?: string;
      }>('/api/orion/command', { text: content, sessionId: 'chat' });

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

      // Navigate if intent is navigate
      if (res.intent === 'navigate' && res.tab) {
        setTimeout(() => {
          navigate(res.tab as never);
          toast({ title: `Navigated to ${res.tab}` });
        }, 800);
      }

      // Set undo info for reversible actions
      if (res.intent === 'create-task' && res.task?.id) {
        setUndoInfo({ resourceId: res.task.id, resourceType: 'task', description: `Delete task "${res.task.title || 'Untitled'}"` });
      } else if (res.intent === 'create-agent' && res.agent?.id) {
        setUndoInfo({ resourceId: res.agent.id, resourceType: 'agent', description: `Remove agent ${res.agent.codename || 'sub-agent'}` });
      } else if (res.intent === 'send-comms' && res.message?.id) {
        setUndoInfo({ resourceId: res.message.id, resourceType: 'comms', description: `Delete message "${res.message.subject || ''}"` });
      }

      // Speak the response if voice is on
      if (!res.error) speak(res.response);

      // Persist to chat history (best-effort)
      try {
        await postJson('/api/chat', {
          message: content,
          history: messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        }).catch(() => {});
      } catch { /* best-effort */ }

      setDraft(null);
      refresh();
    } catch (e) {
      setDraft(null);
      toast({ title: 'Command failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const undoLastCommand = async () => {
    if (!undoInfo?.resourceId) return;
    const { resourceId, resourceType, description } = undoInfo;
    try {
      const endpoint =
        resourceType === 'task' ? `/api/tasks/${resourceId}` :
        resourceType === 'agent' ? `/api/agents/${resourceId}` :
        resourceType === 'comms' ? `/api/comms/${resourceId}` : null;
      if (!endpoint) return;
      await fetch(endpoint, { method: 'DELETE' });
      setUndoInfo(null);
      toast({ title: `Undone: ${description}` });
      speak(`Undone. ${description}`);
    } catch (e) {
      toast({ title: 'Undo failed', variant: 'destructive' });
    }
  };

  const clear = async () => {
    try {
      await fetch('/api/chat', { method: 'DELETE' });
      setAiResponse(null);
      setUndoInfo(null);
      refresh();
      toast({ title: 'Chat history deleted' });
    } catch {
      toast({ title: 'Failed to delete chat', variant: 'destructive' });
    }
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
        title="ARIA Command Center"
        icon={MessageSquare}
        accent={JARVIS.colors.violet}
        action={
          <div className="flex items-center gap-2">
            <Pill color={JARVIS.colors.cyan}>Smart Router</Pill>
            {voiceEnabled && (
              <span className="flex items-center gap-1 jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-[var(--j-green)]/15 text-[var(--j-green)] border border-[var(--j-green)]/30">
                <span className={`h-1.5 w-1.5 rounded-full bg-[var(--j-green)] ${listening ? 'jarvis-pulse-dot' : ''}`} />
                {listening ? 'Listening' : 'Voice On'}
              </span>
            )}
            {/* Voice toggle */}
            {voiceSupported && (
              <button
                onClick={toggleVoice}
                className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${
                  voiceEnabled
                    ? 'border-[var(--j-green)] bg-[var(--j-green)]/10 text-[var(--j-green)]'
                    : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-green)] hover:border-[var(--j-green)]'
                }`}
                title={voiceEnabled ? 'Voice mode on — say "Orion, ..." to command' : 'Enable voice mode (hands-free)'}
              >
                {voiceEnabled ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
              </button>
            )}
            {/* Mute toggle */}
            <button
              onClick={() => {
                const next = !muted;
                setMuted(next);
                try { localStorage.setItem('jarvis-chat-muted', next ? '1' : '0'); } catch { /* ignore */ }
              }}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)] hover:border-[var(--j-cyan)] transition-colors"
              title={muted ? 'Unmute TTS' : 'Mute TTS'}
            >
              {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
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
              <h3 className="text-lg font-semibold jarvis-text-gradient">ARIA Command Center</h3>
              <p className="text-sm text-[var(--j-text-dim)] mt-1 max-w-md">
                Unified command panel — type or speak to navigate tabs, create tasks, spawn agents, run skills, query fleet/revenue, plan complex tasks, and more.
                {voiceSupported && ' Enable voice mode (🎤) for hands-free "Orion, ..." commands.'}
              </p>
              <div className="flex flex-wrap gap-2 mt-5 justify-center max-w-2xl">
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

          {/* Interim voice transcript */}
          {interimText && (
            <div className="flex gap-3 opacity-60">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--j-cyan)]/10 border border-[var(--j-cyan)]/30 text-[var(--j-cyan)]">
                <Mic className="h-4 w-4 animate-pulse" />
              </div>
              <div className="rounded-lg px-3.5 py-2.5 text-sm bg-[var(--j-panel-soft)] border border-[var(--j-border)] italic text-[var(--j-text-dim)]">
                {interimText}…
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
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--j-violet)]" />
                          <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] ml-1">Processing command…</span>
                        </div>
                      ) : m.role === 'assistant' ? (
                        <div className="prose-chat">
                          <ReactMarkdown>{m.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <span className="whitespace-pre-wrap">{m.content}</span>
                      )}
                    </div>
                    {/* Intent + action + undo badge */}
                    {m.intent && m.intent !== 'chat' && (
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
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
                        {/* Undo button */}
                        {undoInfo && m.id === aiResponse?.id && (
                          <button
                            onClick={undoLastCommand}
                            className="flex items-center gap-1 jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded border border-[var(--j-amber)]/40 text-[var(--j-amber)] hover:bg-[var(--j-amber)]/10 transition-colors"
                            title={undoInfo.description}
                          >
                            <Undo2 className="h-2.5 w-2.5" /> Undo
                          </button>
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
          {listening && (
            <div className="mb-2 flex items-center gap-2 text-xs text-[var(--j-green)]">
              <span className="h-2 w-2 rounded-full bg-[var(--j-green)] jarvis-pulse-dot" />
              <span className="jarvis-mono uppercase">Listening — say "Orion, ..." or just speak your command</span>
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              placeholder="Ask ARIA to do anything… type or speak  (⏎ to send, ⇧⏎ for newline)"
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
    case 'make-plan':
      return 'Plan generated';
    default:
      return '';
  }
}
