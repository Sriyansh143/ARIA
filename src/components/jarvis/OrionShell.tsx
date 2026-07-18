'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic, MicOff, Volume2, VolumeX, Radio, Zap, Activity, X,
  Maximize2, Brain, Cpu, MemoryStick, Gauge, Loader2, Sparkles,
  Compass, ListTodo, Bot, Wallet, HeartPulse, RefreshCw, HelpCircle,
  MessagesSquare, Moon, Sun, Search, Terminal, CheckCircle2, AlertCircle,
  History, ChevronUp, ChevronDown, CornerDownLeft, Lightbulb, Undo2,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Cell, Tooltip,
} from 'recharts';
import { JARVIS } from '@/lib/config';
import { cn } from '@/lib/utils';
import { useTabNav, useNavStore } from '@/lib/nav-store';
import {
  parseIntent,
  filterPalette,
  detectContext,
  INTENT_CATALOG,
  PROACTIVE_PROMPTS,
  QUICK_COMMANDS_V2,
  type IntentName,
  type PaletteEntry,
  type QuickCommand,
} from '@/lib/orion-intent';

/* ============================================================
   Orion Shell — intelligent command-center overlay
   ============================================================

   Evolved from a voice-first chat widget into a full intent-routing
   command center. New capabilities:

   • Intent routing via /api/orion/command — 14 intents (navigate,
     create-task, create-agent, run-skill, send-comms, health-check,
     sync-models, query-fleet, query-revenue, query-tasks, set-theme,
     search, help, chat).
   • Command palette typeahead (filter as you type, Arrow/Enter).
   • Contextual follow-up suggestions after every command.
   • Action visualizer — success/error card with structured payload.
   • "What can I say?" help panel — full intent catalog with examples.
   • Proactive prompts — rotating suggestion after 30s of idle.
   • Multi-turn context chip — "fleet discussion", "revenue discussion".
   • Enhanced orb — 6 states: idle/listening/processing/speaking/
     success/error (green pulse / red shake).
   • Mini bar graph for structured responses (fleet/health/revenue).
   • Keyboard shortcuts overlay (?) with Esc to close.
   • Wired navigation — `navigate` intent calls useTabNav().
   • Wired action execution — POST /api/orion/command + show result card.
   • Persisted history (last 50 commands) via localStorage.
   • Terminal-style command log toggle.

   All original voice features retained (wake word, TTS, push-to-talk,
   continuous mode, mute toggle, mini live metrics).
   ============================================================ */

type ShellState = 'idle' | 'listening' | 'processing' | 'speaking' | 'success' | 'error';

interface VoiceTurn {
  id: string;
  prompt: string;
  response: string;
  intent?: IntentName;
  latency?: number;
  at: number;
  graph?: { label: string; value: number }[];
  ok?: boolean;
}

interface LogEntry {
  id: string;
  prompt: string;
  response: string;
  intent?: IntentName;
  at: number;
  latencyMs?: number;
  ok: boolean;
}

interface MetricsSnapshot {
  cpu: number;
  mem: number;
  latency: number;
  tokens: number;
}

interface ActionResult {
  intent: IntentName;
  ok: boolean;
  title: string;
  details: string;
  payload?: unknown;
  at: number;
}

interface CommandApiResponse {
  intent: IntentName;
  response: string;
  latencyMs: number;
  confidence?: number;
  sessionId?: string;
  tab?: string;
  action?: { type: string; [k: string]: unknown };
  params?: Record<string, unknown>;
  suggestions?: string[];
  graph?: { label: string; value: number }[];
  task?: unknown;
  agent?: unknown;
  message?: unknown;
  skillResult?: unknown;
  summary?: unknown;
  report?: unknown;
  error?: string;
}

const WAKE_WORDS = ['orion', 'aria', 'hey orion', 'hey aria'];
const HISTORY_STORAGE_KEY = 'jarvis-orion-history';
const LOG_STORAGE_KEY = 'jarvis-orion-log';
const MAX_HISTORY_UI = 12;
const MAX_HISTORY_LS = 50;
const MAX_LOG = 100;
const IDLE_PROACTIVE_MS = 30_000;

/* ---------- lucide icon lookup for dynamic palette/help entries ---------- */
const ICONS: Record<string, typeof Cpu> = {
  Compass, ListTodo, Bot, Wallet, HeartPulse, RefreshCw, HelpCircle,
  MessagesSquare, Moon, Sun, Search, Terminal, Sparkles, Activity,
  Mic, Zap, Brain, Gauge,
};
function getIcon(name: string): typeof Cpu {
  return ICONS[name] || Sparkles;
}

/* ---------- parse numeric data out of a free-form response ---------- */
function parseGraphData(text: string): { label: string; value: number }[] | null {
  const matches: { label: string; value: number }[] = [];
  const lines = text.split(/\n|\.|;/);
  for (const line of lines) {
    const pct = line.match(/([A-Za-z][A-Za-z\s\-]{0,24}?)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*%/);
    if (pct) {
      const label = (pct[1] || 'metric').trim().slice(0, 16) || 'metric';
      matches.push({ label, value: parseFloat(pct[2]) });
      continue;
    }
    const cnt = line.match(/(\d+(?:\.\d+)?)\s*([A-Za-z][A-Za-z]{2,14})/);
    if (cnt) {
      const val = parseFloat(cnt[1]);
      const label = cnt[2].toLowerCase();
      if (val > 0 && val < 1_000_000) {
        matches.push({ label, value: val });
      }
    }
  }
  const seen = new Set<string>();
  const out: { label: string; value: number }[] = [];
  for (const m of matches) {
    const key = m.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
    if (out.length >= 6) break;
  }
  return out.length >= 2 ? out : null;
}

/* ============================================================
   Component
   ============================================================ */
export default function OrionShell({ onClose }: { onClose: () => void }) {
  const navigate = useTabNav();
  const currentTab = useNavStore((s) => s.tab);

  /* ---------- core state ---------- */
  const [supported, setSupported] = useState<boolean | null>(null);
  const [continuous, setContinuous] = useState(true); // auto-start listening on open
  const [wakeRequired, setWakeRequired] = useState(true);
  const [state, setState] = useState<ShellState>('idle');
  const [interim, setInterim] = useState('');
  const [muted, setMuted] = useState(false);
  const [response, setResponse] = useState<string>('');
  const [typed, setTyped] = useState('');
  const [latency, setLatency] = useState<number | null>(null);
  const [graph, setGraph] = useState<{ label: string; value: number }[] | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [history, setHistory] = useState<VoiceTurn[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [undoInfo, setUndoInfo] = useState<{ intent: string; resourceId?: string; resourceType?: string; description: string } | null>(null);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [awake, setAwake] = useState(false);

  /* ---------- new smart-shell state ---------- */
  const [typed2, setTyped2] = useState(''); // text-input value (renamed to avoid clash)
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [actionResult, setActionResult] = useState<ActionResult | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [contextChip, setContextChip] = useState<string | null>(null);
  const [proactiveIdx, setProactiveIdx] = useState(0);
  const [lastActivity, setLastActivity] = useState<number>(Date.now());

  /* ---------- conversation state machine ---------- */
  // Tracks the current phase of the conversation cycle:
  // listening → processing → speaking → pause → listening
  // This prevents the mic from picking up TTS output (feedback loop).
  const [conversationPhase, setConversationPhase] = useState<'listening' | 'processing' | 'speaking' | 'paused'>('listening');
  const conversationPhaseRef = useRef<'listening' | 'processing' | 'speaking' | 'paused'>('listening');

  // Pending clarification: when the AI asks a question, we store it here.
  // The next user input is treated as the answer (not a new command).
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const pendingQuestionRef = useRef<string | null>(null);

  // Task monitoring: after creating tasks, poll until they complete.
  const [monitoredTasks, setMonitoredTasks] = useState<Array<{ id: string; title: string; status: string; assignee?: string }>>([]);
  const monitorTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const recognitionRef = useRef<any>(null);
  const shouldListenRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalBufRef = useRef('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const proactiveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ---------- palette entries (filtered by typed2) ---------- */
  const paletteEntries: PaletteEntry[] = useMemo(
    () => filterPalette(typed2),
    [typed2],
  );

  /* ---------- mount: feature-detect speech APIs + restore history ---------- */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    setSupported(!!SR);
    try {
      const m = localStorage.getItem('jarvis-orion-muted');
      if (m === '1') setMuted(true);
      const h = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (h) setHistory(JSON.parse(h).slice(0, MAX_HISTORY_UI));
      const l = localStorage.getItem(LOG_STORAGE_KEY);
      if (l) setLog(JSON.parse(l).slice(0, MAX_LOG));
    } catch { /* ignore */ }
    return () => {
      stopRecognition();
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (awakeTimerRef.current) clearTimeout(awakeTimerRef.current);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      if (proactiveTimerRef.current) clearInterval(proactiveTimerRef.current);
    };
    // stopRecognition is a stable useCallback (empty deps); safe to omit.
  }, []);

  /* ---------- Escape to exit / close overlays ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (shortcutsOpen) { setShortcutsOpen(false); e.preventDefault(); e.stopPropagation(); return; }
        if (helpOpen) { setHelpOpen(false); e.preventDefault(); e.stopPropagation(); return; }
        if (paletteOpen) { setPaletteOpen(false); e.preventDefault(); e.stopPropagation(); return; }
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
      if (e.key === '?' && !(e.ctrlKey || e.metaKey) && (e.target as HTMLElement)?.tagName !== 'INPUT') {
        e.preventDefault();
        setShortcutsOpen((s) => !s);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, shortcutsOpen, helpOpen, paletteOpen]);

  /* ---------- live metrics poll ---------- */
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetch('/api/metrics', { cache: 'no-store' });
        const json = await res.json();
        if (!alive) return;
        const c = json.current;
        if (c) setMetrics({ cpu: c.cpu, mem: c.mem, latency: c.latency, tokens: c.tokens });
      } catch { /* ignore */ }
    };
    pull();
    const id = setInterval(pull, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  /* ---------- proactive prompt rotation (every 30s of idle) ---------- */
  useEffect(() => {
    if (proactiveTimerRef.current) clearInterval(proactiveTimerRef.current);
    proactiveTimerRef.current = setInterval(() => {
      if (Date.now() - lastActivity > IDLE_PROACTIVE_MS && state === 'idle') {
        setProactiveIdx((i) => (i + 1) % PROACTIVE_PROMPTS.length);
      }
    }, 5000);
    return () => { if (proactiveTimerRef.current) clearInterval(proactiveTimerRef.current); };
  }, [lastActivity, state]);

  /* ---------- TTS ---------- */
  // The speak function is the KEY to the conversation state machine.
  // When speaking starts: pause speech recognition (prevent mic feedback).
  // When speaking ends: resume listening after a short delay.
  // startRecognitionRef is a ref to startRecognition so speak() can call it
  // without creating a circular dependency (speak depends on startRecognition,
  // startRecognition depends on sendCommand, sendCommand depends on speak).
  const startRecognitionRef = useRef<() => void>(() => {});
  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    if (muted) {
      // If muted, skip TTS but still cycle through the conversation phases.
      setConversationPhase('speaking');
      conversationPhaseRef.current = 'speaking';
      setState('speaking');
      // Simulate end of speech after a short delay.
      setTimeout(() => {
        setConversationPhase('listening');
        conversationPhaseRef.current = 'listening';
        setState(shouldListenRef.current ? 'listening' : 'idle');
        // Resume recognition after speaking.
        if (shouldListenRef.current && !recognitionRef.current) {
          startRecognitionRef.current();
        }
      }, 500);
      return;
    }
    window.speechSynthesis.cancel();
    const clean = text.replace(/[#*`_>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 600);
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.rate = 1.02;
    u.pitch = 1.0;
    u.volume = 1.0;
    if (window.speechSynthesis.getVoices) {
      const voices = window.speechSynthesis.getVoices();
      const pref = voices.find((v) => /en[-_]?US/i.test(v.lang) && /female|samantha|aria|jenny|zira/i.test(v.name))
        || voices.find((v) => /en[-_]?US/i.test(v.lang))
        || voices.find((v) => /^en/i.test(v.lang));
      if (pref) u.voice = pref;
    }
    // PAUSE recognition while speaking — prevents mic from picking up TTS.
    u.onstart = () => {
      setConversationPhase('speaking');
      conversationPhaseRef.current = 'speaking';
      setState('speaking');
      // Stop the mic while speaking.
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
      }
    };
    // RESUME listening after speaking ends.
    u.onend = () => {
      setConversationPhase('listening');
      conversationPhaseRef.current = 'listening';
      setState(shouldListenRef.current ? 'listening' : 'idle');
      // Restart recognition after a 300ms delay (let the room go quiet).
      if (shouldListenRef.current) {
        setTimeout(() => {
          if (shouldListenRef.current && conversationPhaseRef.current === 'listening') {
            startRecognitionRef.current();
          }
        }, 300);
      }
    };
    u.onerror = () => {
      setConversationPhase('listening');
      conversationPhaseRef.current = 'listening';
      setState(shouldListenRef.current ? 'listening' : 'idle');
      if (shouldListenRef.current) {
        setTimeout(() => startRecognitionRef.current(), 300);
      }
    };
    window.speechSynthesis.speak(u);
  }, [muted]);

  /* ---------- typing animation for the response ---------- */
  useEffect(() => {
    if (!response) { setTyped(''); return; }
    setTyped('');
    let i = 0;
    const id = setInterval(() => {
      i += 3;
      setTyped(response.slice(0, i));
      if (i >= response.length) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, [response]);

  /* ---------- brief success/error orb flash ---------- */
  const flashOrb = useCallback((kind: 'success' | 'error') => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    setState(kind);
    successTimerRef.current = setTimeout(() => {
      setState((s) => (s === kind ? (shouldListenRef.current ? 'listening' : 'idle') : s));
    }, kind === 'success' ? 1800 : 2400);
  }, []);

  /* ---------- apply theme action ---------- */
  const applyTheme = useCallback((theme: string) => {
    if (typeof document === 'undefined') return;
    const isDark = theme === 'dark' ? true :
      theme === 'light' ? false :
      !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.classList.toggle('light', !isDark);
    try { localStorage.setItem('jarvis-theme', isDark ? 'dark' : 'light'); } catch { /* ignore */ }
  }, []);

  /* ---------- wire follow-up suggestion → re-send as command ---------- */
  const sendCommand = useCallback(async (prompt: string) => {
    const clean = prompt.trim();
    if (!clean) return;
    setError(null);
    setInterim('');
    setGraph(null);
    setResponse('');
    setLatency(null);
    setActionResult(null);
    setSuggestions([]);
    setPaletteOpen(false);
    setLastActivity(Date.now());
    setState('processing');

    // Optimistic: parse locally for instant ack (orb pulse + spoken preview)
    const localParsed = parseIntent(clean);
    if (localParsed.response && localParsed.intent !== 'chat') {
      // Briefly speak the optimistic ack BEFORE the API responds.
      // (We will speak the full response once it lands.)
    }

    const t0 = performance.now();
    try {
      const res = await fetch('/api/orion/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean, sessionId: `orion-${Date.now()}` }),
      });
      const json: CommandApiResponse = await res.json();
      if (!res.ok) throw new Error(json.error || `orion ${res.status}`);
      const content = json.response || '(no response)';
      const lat = json.latencyMs ?? Math.round(performance.now() - t0);
      setResponse(content);
      setLatency(lat);
      setGraph(json.graph ?? parseGraphData(content));
      setSuggestions(json.suggestions ?? []);
      setContextChip(detectContext(clean));

      const turn: VoiceTurn = {
        id: `t-${Date.now()}`,
        prompt: clean,
        response: content,
        intent: json.intent,
        latency: lat,
        at: Date.now(),
        graph: json.graph ?? parseGraphData(content) ?? undefined,
        ok: !json.error,
      };
      const newHistory = [turn, ...history].slice(0, MAX_HISTORY_UI);
      setHistory(newHistory);
      try { localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify([turn, ...history].slice(0, MAX_HISTORY_LS))); } catch { /* ignore */ }

      const logEntry: LogEntry = {
        id: turn.id,
        prompt: clean,
        response: content,
        intent: json.intent,
        at: turn.at,
        latencyMs: lat,
        ok: !json.error,
      };
      const newLog = [logEntry, ...log].slice(0, MAX_LOG);
      setLog(newLog);
      try { localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(newLog)); } catch { /* ignore */ }

      /* ---------- client-side action execution ---------- */
      let actionOk = !json.error;
      let actionTitle = '';
      let actionDetails = '';
      let actionPayload: unknown = undefined;

      if (json.intent === 'navigate' && json.tab) {
        navigate(json.tab);
        actionTitle = `Navigated → ${json.tab}`;
        actionDetails = `Switched to the ${json.tab} tab.`;
        actionPayload = { tab: json.tab };
      } else if (json.intent === 'create-task' && json.task) {
        actionTitle = 'Task Created';
        actionDetails = (json.task as { title?: string; priority?: string }).title || 'Untitled task';
        actionPayload = json.task;
      } else if (json.intent === 'create-agent' && json.agent) {
        const a = json.agent as { codename?: string; role?: string };
        actionTitle = 'Agent Spawned';
        actionDetails = `${a.codename || 'sub-agent'} — ${a.role || 'Sub Agent'}`;
        actionPayload = json.agent;
      } else if (json.intent === 'send-comms' && json.message) {
        const m = json.message as { toAgent?: string; subject?: string };
        actionTitle = 'Message Sent';
        actionDetails = `${m.toAgent === 'BROADCAST' ? 'All agents' : m.toAgent}: ${m.subject || ''}`;
        actionPayload = json.message;
      } else if (json.intent === 'run-skill' && json.skillResult) {
        actionTitle = 'Skill Executed';
        actionDetails = `${(json.skillResult as { status?: string }).status || 'done'}`;
        actionPayload = json.skillResult;
      } else if (json.intent === 'set-theme') {
        const theme = (json.action as { theme?: string })?.theme || 'toggle';
        applyTheme(theme);
        actionTitle = 'Theme Applied';
        actionDetails = theme === 'toggle' ? 'Toggled' : `${theme} mode`;
      } else if (json.intent === 'help') {
        setHelpOpen(true);
        actionTitle = 'Help Opened';
        actionDetails = 'Showing the intent catalog.';
      } else if (json.intent === 'search') {
        const q = (json.action as { query?: string })?.query || '';
        actionTitle = 'Search Dispatched';
        actionDetails = `"${q}" — open the relevant tab to view results.`;
        // Best-effort: emit a window event the page-client could listen for.
        try { window.dispatchEvent(new CustomEvent('orion:search', { detail: { query: q } })); } catch { /* ignore */ }
      } else if (json.intent === 'chat') {
        actionTitle = 'Conversational Reply';
        actionDetails = content.slice(0, 80) + (content.length > 80 ? '…' : '');
      } else {
        actionTitle = json.intent.replace('-', ' ');
        actionTitle = actionTitle.charAt(0).toUpperCase() + actionTitle.slice(1);
        actionDetails = content.slice(0, 100);
      }

      if (json.error) actionOk = false;
      setActionResult({
        intent: json.intent,
        ok: actionOk,
        title: actionTitle,
        details: actionDetails,
        payload: actionPayload,
        at: Date.now(),
      });

      // Set undo info for reversible actions (create-task, create-agent, send-comms).
      if (json.intent === 'create-task' && json.task) {
        const t = json.task as { id?: string; title?: string };
        setUndoInfo({ intent: 'create-task', resourceId: t.id, resourceType: 'task', description: `Delete task "${t.title || 'Untitled'}"` });
      } else if (json.intent === 'create-agent' && json.agent) {
        const a = json.agent as { id?: string; codename?: string };
        setUndoInfo({ intent: 'create-agent', resourceId: a.id, resourceType: 'agent', description: `Remove agent ${a.codename || 'sub-agent'}` });
      } else if (json.intent === 'send-comms' && json.message) {
        const m = json.message as { id?: string; subject?: string };
        setUndoInfo({ intent: 'send-comms', resourceId: m.id, resourceType: 'comms', description: `Delete message "${m.subject || ''}"` });
      } else {
        setUndoInfo(null);
      }

      flashOrb(actionOk ? 'success' : 'error');
      if (content && actionOk) speak(content);
      else if (!actionOk) {
        speak('That action failed. ' + (json.error || content));
      } else {
        setState(shouldListenRef.current ? 'listening' : 'idle');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error';
      setError(msg);
      setActionResult({
        intent: 'chat',
        ok: false,
        title: 'Request Failed',
        details: msg,
        at: Date.now(),
      });
      flashOrb('error');
      setState(shouldListenRef.current ? 'listening' : 'idle');
    }
  }, [applyTheme, flashOrb, history, log, navigate, speak]);

  /* ---------- undo last command ---------- */
  const undoLastCommand = useCallback(async () => {
    if (!undoInfo || !undoInfo.resourceId) return;
    const { resourceId, resourceType, description } = undoInfo;
    try {
      const endpoint =
        resourceType === 'task' ? `/api/tasks/${resourceId}` :
        resourceType === 'agent' ? `/api/agents/${resourceId}` :
        resourceType === 'comms' ? `/api/comms/${resourceId}` :
        null;
      if (!endpoint) return;
      const res = await fetch(endpoint, { method: 'DELETE' });
      if (!res.ok) throw new Error(`undo failed: ${res.status}`);
      setUndoInfo(null);
      setResponse(`Undone: ${description}`);
      speak(`Undone. ${description}`);
      flashOrb('success');
    } catch (e) {
      setError(`Undo failed: ${e instanceof Error ? e.message : 'unknown'}`);
      flashOrb('error');
    }
  }, [undoInfo, speak, flashOrb]);

  /* ---------- speech recognition lifecycle ---------- */
  const stopRecognition = useCallback(() => {
    shouldListenRef.current = false;
    const rec = recognitionRef.current;
    if (rec) {
      try { rec.onresult = null; rec.onend = null; rec.onerror = null; rec.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    setState('idle');
    setInterim('');
    setAwake(false);
  }, []);

  const startRecognition = useCallback(() => {
    if (typeof window === 'undefined') return;
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) { setSupported(false); return; }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    shouldListenRef.current = true;
    finalBufRef.current = '';
    setState('listening');

    rec.onresult = (event: any) => {
      let interimText = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        const t = r[0].transcript;
        if (r.isFinal) finalText += t;
        else interimText += t;
      }
      setInterim(interimText || finalText);

      if (finalText) {
        finalBufRef.current = (finalBufRef.current + ' ' + finalText).trim();
        const lower = finalBufRef.current.toLowerCase();

        if (wakeRequired) {
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
            setAwake(true);
            if (awakeTimerRef.current) clearTimeout(awakeTimerRef.current);
            awakeTimerRef.current = setTimeout(() => setAwake(false), 6000);
            finalBufRef.current = '';
            void sendCommand(cmd);
          } else if (WAKE_WORDS.some((w) => lower.includes(w))) {
            setAwake(true);
            if (awakeTimerRef.current) clearTimeout(awakeTimerRef.current);
            awakeTimerRef.current = setTimeout(() => setAwake(false), 6000);
            finalBufRef.current = '';
          }
        } else {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          const snapshot = finalBufRef.current;
          debounceRef.current = setTimeout(() => {
            if (snapshot && shouldListenRef.current) {
              finalBufRef.current = '';
              void sendCommand(snapshot);
            }
          }, 1400);
        }
      }
    };

    rec.onerror = (e: any) => {
      const err = e?.error || 'speech-error';
      if (err === 'no-speech' || err === 'aborted') return;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setError('Microphone permission denied. Enable mic access to use voice mode.');
        setSupported(false);
      } else {
        setError(`Speech error: ${err}`);
      }
    };

    rec.onend = () => {
      if (shouldListenRef.current) {
        try {
          rec.start();
        } catch { /* will retry on next user action */ }
      } else {
        setState('idle');
      }
    };

    try {
      rec.start();
      recognitionRef.current = rec;
    } catch {
      try { rec.stop(); setTimeout(() => { try { rec.start(); recognitionRef.current = rec; } catch { /* ignore */ } }, 250); } catch { /* ignore */ }
    }
  }, [sendCommand, wakeRequired]);

  /* ---------- toggle continuous listening ---------- */
  const toggleListening = useCallback(() => {
    if (continuous) {
      setContinuous(false);
      stopRecognition();
    } else {
      setContinuous(true);
      startRecognition();
    }
  }, [continuous, startRecognition, stopRecognition]);

  /* ---------- auto-start listening on mount (hands-free) ---------- */
  // When Orion mode opens, automatically start listening for the wake word.
  // No button press required — the user just says "Orion, ..." to give a command.
  const autoStartRef = useRef(false);
  useEffect(() => {
    if (autoStartRef.current) return; // only once
    if (supported === true && continuous) {
      autoStartRef.current = true;
      const timer = setTimeout(() => {
        shouldListenRef.current = true;
        startRecognition();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [supported, continuous, startRecognition]);

  /* ---------- single-shot push-to-talk ---------- */
  const pushToTalk = useCallback(() => {
    if (!supported) return;
    if (recognitionRef.current) {
      stopRecognition();
    }
    const prevWake = wakeRequired;
    setWakeRequired(false);
    startRecognition();
    setTimeout(() => {
      if (!finalBufRef.current) {
        stopRecognition();
      }
    }, 8000);
    setTimeout(() => setWakeRequired(prevWake), 8500);
  }, [supported, wakeRequired, startRecognition, stopRecognition]);

  /* ---------- persist mute ---------- */
  useEffect(() => {
    try { localStorage.setItem('jarvis-orion-muted', muted ? '1' : '0'); } catch { /* ignore */ }
  }, [muted]);

  /* ---------- text input + command palette handlers ---------- */
  const onInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (paletteOpen && paletteEntries.length) {
        e.preventDefault();
        setPaletteIdx((i) => (i + 1) % paletteEntries.length);
      }
    } else if (e.key === 'ArrowUp') {
      if (paletteOpen && paletteEntries.length) {
        e.preventDefault();
        setPaletteIdx((i) => (i - 1 + paletteEntries.length) % paletteEntries.length);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (paletteOpen && paletteEntries.length && paletteEntries[paletteIdx]) {
        const entry = paletteEntries[paletteIdx];
        // If the typed text exactly matches the entry prompt, send it.
        // Otherwise, fill the prompt into the input for editing.
        if (typed2.trim().toLowerCase() === entry.prompt.trim().toLowerCase()) {
          void sendCommand(entry.prompt);
          setTyped2('');
        } else if (typed2.trim() === '' || typed2.trim().toLowerCase() === entry.label.toLowerCase()) {
          setTyped2(entry.prompt);
          inputRef.current?.focus();
          // auto-send prompts that are already complete (no trailing space)
          if (!/\s$/.test(entry.prompt) && entry.prompt.split(/\s+/).length > 1) {
            // send immediately for fully-formed prompts like "Fleet status"
            setTimeout(() => { void sendCommand(entry.prompt); setTyped2(''); }, 0);
          }
        } else {
          // User has partial text — just send the typed text as a command.
          void sendCommand(typed2);
          setTyped2('');
        }
      } else {
        void sendCommand(typed2);
        setTyped2('');
      }
    } else if (e.key === 'Tab') {
      if (paletteOpen && paletteEntries[paletteIdx]) {
        e.preventDefault();
        setTyped2(paletteEntries[paletteIdx].prompt);
      }
    }
  }, [paletteOpen, paletteEntries, paletteIdx, sendCommand, typed2]);

  // Reset palette index when filter changes
  useEffect(() => { setPaletteIdx(0); }, [typed2]);

  // Open palette whenever input is focused & non-empty
  const onInputChange = useCallback((v: string) => {
    setTyped2(v);
    setPaletteOpen(v.trim().length > 0);
  }, []);

  /* ---------- orb visual config ---------- */
  const orbConfig = useMemo(() => {
    switch (state) {
      case 'listening':
        return { color: JARVIS.colors.cyan, glow: 0.55, scale: 1.06, dur: 1.1, label: 'LISTENING' };
      case 'processing':
        return { color: JARVIS.colors.violet, glow: 0.7, scale: 1.1, dur: 1.6, label: 'PROCESSING' };
      case 'speaking':
        return { color: JARVIS.colors.green, glow: 0.6, scale: 1.04, dur: 0.45, label: 'SPEAKING' };
      case 'success':
        return { color: JARVIS.colors.green, glow: 0.85, scale: 1.12, dur: 0.6, label: 'SUCCESS' };
      case 'error':
        return { color: JARVIS.colors.red, glow: 0.85, scale: 1.06, dur: 0.18, label: 'ERROR' };
      default:
        return { color: JARVIS.colors.cyan, glow: 0.18, scale: 1.0, dur: 3.2, label: 'STANDBY' };
    }
  }, [state]);

  const showProactive =
    state === 'idle' && !interim && !response && !actionResult &&
    Date.now() - lastActivity > IDLE_PROACTIVE_MS;

  /* ============================================================
     Render
     ============================================================ */
  return (
    <motion.div
      className="fixed inset-0 z-[60] flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      style={{ background: 'rgba(4,5,8,0.96)', backdropFilter: 'blur(18px)' }}
    >
      {/* subtle radial backdrop */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(circle at 50% 42%, ${orbConfig.color}14, transparent 55%)` }}
      />

      {/* ---------------- Top bar ---------------- */}
      <header className="relative z-10 flex items-center justify-between px-4 lg:px-6 h-14 border-b border-[var(--j-border)] bg-[rgba(8,10,14,0.6)]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md jarvis-btn-accent">
            <Brain className="h-4 w-4" />
          </div>
          <div className="leading-none">
            <div className="text-sm font-bold tracking-tight jarvis-text-gradient">ORION SHELL</div>
            <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
              voice · intent · command-center · {supported === false ? 'unsupported' : awake ? 'awake' : 'standby'}
            </div>
          </div>
          {/* multi-turn context chip */}
          {contextChip && (
            <span
              className="ml-2 jarvis-mono text-[9px] uppercase px-2 py-0.5 rounded-full"
              style={{ background: `${JARVIS.colors.violet}1a`, border: `1px solid ${JARVIS.colors.violet}55`, color: JARVIS.colors.violet }}
            >
              ctx: {contextChip}
            </span>
          )}
          {/* current-tab chip */}
          <span className="hidden md:inline ml-2 jarvis-mono text-[9px] uppercase px-2 py-0.5 rounded-full border border-[var(--j-border)] text-[var(--j-text-mute)]">
            tab: {currentTab}
          </span>
        </div>

        {/* mini metrics */}
        <div className="hidden md:flex items-center gap-4">
          <MiniMetric icon={Cpu} label="CPU" value={metrics ? `${Math.round(metrics.cpu)}%` : '—'} color={JARVIS.colors.cyan} />
          <MiniMetric icon={MemoryStick} label="MEM" value={metrics ? `${Math.round(metrics.mem)}%` : '—'} color={JARVIS.colors.violet} />
          <MiniMetric icon={Gauge} label="LAT" value={metrics ? `${metrics.latency}ms` : '—'} color={JARVIS.colors.amber} />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setLogOpen((v) => !v)}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
              logOpen
                ? 'border-[var(--j-green)] bg-[var(--j-green)]/10 text-[var(--j-green)]'
                : 'border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] hover:text-[var(--j-green)] hover:border-[var(--j-green)]',
            )}
            aria-label="Toggle command log"
            title="Command log (terminal view)"
          >
            <Terminal className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setHelpOpen((v) => !v)}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
              helpOpen
                ? 'border-[var(--j-amber)] bg-[var(--j-amber)]/10 text-[var(--j-amber)]'
                : 'border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] hover:text-[var(--j-amber)] hover:border-[var(--j-amber)]',
            )}
            aria-label="What can I say?"
            title="What can I say?"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShortcutsOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)] hover:border-[var(--j-cyan)] transition-colors"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            <span className="jarvis-mono text-[11px] font-bold">?</span>
          </button>
          <button
            onClick={() => setMuted((m) => !m)}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)] hover:border-[var(--j-cyan)] transition-colors"
            aria-label={muted ? 'Unmute voice' : 'Mute voice'}
            title={muted ? 'Unmute voice' : 'Mute voice'}
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] hover:text-[var(--j-red)] hover:border-[var(--j-red)] transition-colors"
            aria-label="Exit Orion mode"
            title="Exit Orion mode (Ctrl+Shift+O)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ---------------- Main stage ---------------- */}
      <div className="relative z-10 flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_340px]">
        {/* Center: orb + transcript + response + action visualizer + input */}
        <section className="flex flex-col items-center justify-start px-4 py-4 lg:py-6 overflow-y-auto jarvis-scroll min-h-0">
          {/* Orb */}
          <div className="relative flex items-center justify-center mb-4" style={{ width: 200, height: 200 }}>
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="absolute rounded-full"
                style={{ border: `1px solid ${orbConfig.color}33` }}
                animate={{
                  scale: state === 'listening' ? [1, 1.35 + i * 0.18, 1] : [1, 1.08 + i * 0.06, 1],
                  opacity: state === 'listening' ? [0.5, 0, 0.5] : [0.35, 0.12, 0.35],
                }}
                transition={{
                  duration: orbConfig.dur,
                  repeat: Infinity,
                  delay: i * 0.18,
                  ease: 'easeInOut',
                }}
              />
            ))}

            <motion.div
              className="absolute rounded-full"
              style={{ width: 170, height: 170 }}
              animate={{
                boxShadow: `0 0 ${60 + orbConfig.glow * 80}px ${orbConfig.glow * 30}px ${orbConfig.color}40, inset 0 0 ${40 + orbConfig.glow * 40}px ${orbConfig.color}30`,
                background: `radial-gradient(circle, ${orbConfig.color}22, transparent 70%)`,
              }}
              transition={{ duration: 0.6 }}
            />

            <motion.div
              className="relative rounded-full flex items-center justify-center"
              style={{
                width: 120,
                height: 120,
                background: `radial-gradient(circle at 35% 30%, ${orbConfig.color}cc, ${orbConfig.color}33 55%, transparent 80%)`,
                border: `1.5px solid ${orbConfig.color}aa`,
                boxShadow: `0 0 30px ${orbConfig.color}80, inset 0 0 25px ${orbConfig.color}40`,
              }}
              animate={state === 'error'
                ? { x: [-4, 4, -3, 3, 0] }
                : state === 'success'
                  ? { scale: [1, 1.15, 0.95, 1.1, 1] }
                  : state === 'speaking'
                    ? { scale: [1, 1.08, 0.96, 1.05, 1] }
                    : { scale: [1, orbConfig.scale, 1] }}
              transition={{
                duration: orbConfig.dur,
                repeat: state === 'error' ? 3 : Infinity,
                ease: 'easeInOut',
              }}
            >
              {state === 'speaking' && (
                <div className="flex items-center gap-1">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <motion.div
                      key={i}
                      style={{ width: 3, background: JARVIS.colors.green, borderRadius: 2 }}
                      animate={{ height: [8, 28, 14, 32, 10] }}
                      transition={{ duration: 0.55, repeat: Infinity, delay: i * 0.06, ease: 'easeInOut' }}
                    />
                  ))}
                </div>
              )}
              {state === 'success' && (
                <CheckCircle2 className="h-10 w-10" style={{ color: orbConfig.color }} />
              )}
              {state === 'error' && (
                <AlertCircle className="h-10 w-10" style={{ color: orbConfig.color }} />
              )}
              {state !== 'speaking' && state !== 'success' && state !== 'error' && (
                <motion.div
                  animate={{ rotate: state === 'processing' ? 360 : 0 }}
                  transition={{ duration: state === 'processing' ? 2 : 0, repeat: state === 'processing' ? Infinity : 0, ease: 'linear' }}
                >
                  {state === 'processing' ? (
                    <Loader2 className="h-9 w-9" style={{ color: orbConfig.color }} />
                  ) : continuous ? (
                    <Radio className="h-8 w-8" style={{ color: orbConfig.color }} />
                  ) : (
                    <Mic className="h-8 w-8" style={{ color: orbConfig.color }} />
                  )}
                </motion.div>
              )}
            </motion.div>

            <AnimatePresence>
              {awake && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="absolute -bottom-1 jarvis-mono text-[9px] uppercase px-2 py-0.5 rounded-full"
                  style={{ background: `${JARVIS.colors.green}1a`, border: `1px solid ${JARVIS.colors.green}55`, color: JARVIS.colors.green }}
                >
                  awake · speak your command
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* state label */}
          <div className="flex items-center gap-2 mb-3">
            <span className="h-1.5 w-1.5 rounded-full jarvis-blink" style={{ background: orbConfig.color }} />
            <span className="jarvis-mono text-[10px] uppercase tracking-widest" style={{ color: orbConfig.color }}>
              {orbConfig.label}
            </span>
            {latency !== null && (
              <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">· {latency}ms</span>
            )}
          </div>

          {/* interim transcript */}
          <div className="w-full max-w-2xl min-h-[2.5rem] text-center mb-3">
            {interim ? (
              <motion.p
                key={interim.slice(0, 16)}
                initial={{ opacity: 0.4 }}
                animate={{ opacity: 1 }}
                className="text-lg lg:text-xl text-[var(--j-text-dim)] italic"
              >
                “{interim}”
              </motion.p>
            ) : showProactive ? (
              <motion.p
                key={proactiveIdx}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-sm text-[var(--j-amber)] jarvis-mono uppercase tracking-wider flex items-center justify-center gap-1.5"
              >
                <Lightbulb className="h-3.5 w-3.5" /> {PROACTIVE_PROMPTS[proactiveIdx]}
              </motion.p>
            ) : (
              <p className="text-sm text-[var(--j-text-mute)] jarvis-mono uppercase tracking-widest">
                {supported === false
                  ? 'voice not supported — type below'
                  : continuous
                    ? wakeRequired
                      ? 'say “orion” or “aria” followed by your command'
                      : 'speak — your words become commands'
                    : 'tap the mic, push-to-talk, or type below'}
              </p>
            )}
          </div>

          {/* action visualizer card (success/error confirmation) */}
          <AnimatePresence>
            {actionResult && (
              <motion.div
                key={actionResult.at}
                initial={{ opacity: 0, y: -8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
                className="w-full max-w-2xl mb-3 jarvis-panel p-3 lg:p-3.5 flex items-start gap-3"
                style={{
                  borderColor: actionResult.ok ? `${JARVIS.colors.green}66` : `${JARVIS.colors.red}66`,
                  boxShadow: `0 0 20px ${actionResult.ok ? JARVIS.colors.green : JARVIS.colors.red}22`,
                }}
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
                  style={{
                    background: actionResult.ok ? `${JARVIS.colors.green}1a` : `${JARVIS.colors.red}1a`,
                    border: `1px solid ${actionResult.ok ? JARVIS.colors.green : JARVIS.colors.red}55`,
                  }}
                >
                  {actionResult.ok
                    ? <CheckCircle2 className="h-4 w-4" style={{ color: JARVIS.colors.green }} />
                    : <AlertCircle className="h-4 w-4" style={{ color: JARVIS.colors.red }} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="jarvis-mono text-[9px] uppercase tracking-wider" style={{ color: actionResult.ok ? JARVIS.colors.green : JARVIS.colors.red }}>
                      {actionResult.intent} · {actionResult.ok ? 'done' : 'failed'}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-[var(--j-text)] truncate">{actionResult.title}</div>
                  <div className="text-xs text-[var(--j-text-dim)] line-clamp-2">{actionResult.details}</div>
                  {actionResult.payload && (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] hover:text-[var(--j-cyan)]">
                        view payload
                      </summary>
                      <pre className="mt-1 text-[10px] text-[var(--j-text-dim)] overflow-x-auto max-h-40 jarvis-scroll bg-[var(--j-panel-soft)] rounded p-2 border border-[var(--j-border-soft)]">
                        {JSON.stringify(actionResult.payload, null, 2)}
                      </pre>
                    </details>
                  )}
                  {/* Undo button — shown for reversible actions (create-task, create-agent, send-comms) */}
                  {undoInfo && actionResult.ok && (
                    <button
                      onClick={undoLastCommand}
                      className="mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] jarvis-mono uppercase border border-[var(--j-amber)]/40 text-[var(--j-amber)] hover:bg-[var(--j-amber)]/10 transition-colors"
                      title={undoInfo.description}
                    >
                      <Undo2 className="h-3 w-3" /> Undo {undoInfo.resourceType}
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setActionResult(null)}
                  className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"
                  aria-label="Dismiss action card"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* response card */}
          <AnimatePresence>
            {(response || error) && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="w-full max-w-2xl jarvis-panel p-4 lg:p-5"
              >
                {error ? (
                  <div className="flex items-start gap-2 text-sm" style={{ color: JARVIS.colors.red }}>
                    <X className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4" style={{ gridTemplateColumns: graph ? '1fr 200px' : '1fr' }}>
                    <div className="min-w-0">
                      <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1.5 flex items-center gap-1.5">
                        <Sparkles className="h-3 w-3" style={{ color: JARVIS.colors.cyan }} /> orion response
                      </div>
                      <div className="text-sm text-[var(--j-text)] whitespace-pre-wrap leading-relaxed">
                        {typed}
                        {typed.length < response.length && (
                          <span className="inline-block w-1.5 h-4 ml-0.5 align-middle jarvis-blink" style={{ background: JARVIS.colors.cyan }} />
                        )}
                      </div>
                    </div>
                    {graph && (
                      <div className="border-l border-[var(--j-border-soft)] pl-3">
                        <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1">data</div>
                        <div style={{ width: '100%', height: 140 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={graph} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                              <XAxis dataKey="label" tick={{ fontSize: 8, fill: 'var(--j-text-mute)' }} interval={0} angle={-30} textAnchor="end" height={28} />
                              <YAxis tick={{ fontSize: 8, fill: 'var(--j-text-mute)' }} width={32} />
                              <Tooltip
                                cursor={{ fill: 'rgba(125,211,252,0.08)' }}
                                contentStyle={{ background: 'var(--j-panel)', border: '1px solid var(--j-border)', borderRadius: 6, fontSize: 11 }}
                                labelStyle={{ color: 'var(--j-text-dim)' }}
                              />
                              <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                                {graph.map((g, i) => (
                                  <Cell key={i} fill={[JARVIS.colors.cyan, JARVIS.colors.green, JARVIS.colors.violet, JARVIS.colors.amber][i % 4]} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* contextual follow-up suggestions */}
          <AnimatePresence>
            {suggestions.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="w-full max-w-2xl mt-3"
              >
                <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-1.5 flex items-center gap-1.5">
                  <Lightbulb className="h-3 w-3" style={{ color: JARVIS.colors.amber }} /> next steps
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestions.slice(0, 4).map((s) => (
                    <button
                      key={s}
                      onClick={() => void sendCommand(s)}
                      className="jarvis-mono text-[10px] uppercase px-2.5 py-1.5 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] hover:text-[var(--j-amber)] hover:border-[var(--j-amber)] transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* text input + command palette */}
          <div className="w-full max-w-2xl mt-5 relative">
            {/* command palette dropdown */}
            <AnimatePresence>
              {paletteOpen && paletteEntries.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="absolute bottom-full mb-2 left-0 right-0 jarvis-panel p-1.5 max-h-72 overflow-y-auto jarvis-scroll z-20"
                >
                  <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] px-2 py-1 flex items-center gap-1.5">
                    <Compass className="h-3 w-3" /> command palette · {paletteEntries.length}
                  </div>
                  {paletteEntries.slice(0, 8).map((e, i) => {
                    const Icon = getIcon(e.icon);
                    return (
                      <button
                        key={e.id}
                        onMouseEnter={() => setPaletteIdx(i)}
                        onClick={() => {
                          if (e.prompt.endsWith(' ')) {
                            setTyped2(e.prompt);
                            setPaletteOpen(false);
                            inputRef.current?.focus();
                          } else {
                            void sendCommand(e.prompt);
                            setTyped2('');
                            setPaletteOpen(false);
                          }
                        }}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-left transition-colors',
                          i === paletteIdx ? 'bg-[var(--j-cyan)]/10 border border-[var(--j-cyan)]/40' : 'border border-transparent hover:bg-[var(--j-panel-soft)]',
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: e.color }} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] text-[var(--j-text)] truncate">{e.label}</div>
                          <div className="text-[10px] text-[var(--j-text-mute)] truncate">{e.prompt}</div>
                        </div>
                        <span className="jarvis-mono text-[8px] uppercase px-1.5 py-0.5 rounded border border-[var(--j-border-soft)] text-[var(--j-text-mute)]">
                          {e.hint}
                        </span>
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>

            {/* input row */}
            <div className="flex items-center gap-2 jarvis-panel px-3 py-2">
              <Sparkles className="h-4 w-4 shrink-0" style={{ color: JARVIS.colors.cyan }} />
              <input
                ref={inputRef}
                value={typed2}
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={onInputKeyDown}
                onFocus={() => typed2.trim() && setPaletteOpen(true)}
                onBlur={() => setTimeout(() => setPaletteOpen(false), 150)}
                placeholder="type a command, or pick from the palette…"
                className="flex-1 bg-transparent border-0 outline-none text-sm text-[var(--j-text)] placeholder:text-[var(--j-text-mute)] jarvis-mono"
                aria-label="Orion command input"
              />
              {paletteOpen && paletteEntries.length > 0 && (
                <span className="hidden sm:flex items-center gap-1 jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">
                  <kbd className="px-1 py-0.5 rounded border border-[var(--j-border-soft)]"><ChevronUp className="h-2.5 w-2.5" /></kbd>
                  <kbd className="px-1 py-0.5 rounded border border-[var(--j-border-soft)]"><ChevronDown className="h-2.5 w-2.5" /></kbd>
                  <kbd className="px-1 py-0.5 rounded border border-[var(--j-border-soft)] flex items-center gap-0.5"><CornerDownLeft className="h-2.5 w-2.5" /></kbd>
                </span>
              )}
              <button
                onClick={() => { void sendCommand(typed2); setTyped2(''); }}
                disabled={!typed2.trim()}
                className="jarvis-mono text-[10px] uppercase px-2.5 py-1 rounded-md border border-[var(--j-cyan)]/40 bg-[var(--j-cyan)]/10 text-[var(--j-cyan)] hover:bg-[var(--j-cyan)]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
              >
                <CornerDownLeft className="h-3 w-3" /> send
              </button>
            </div>

            {/* quick commands (enhanced, 8 chips) */}
            <div className="mt-3">
              <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-2 text-center">quick commands</div>
              <div className="flex flex-wrap justify-center gap-1.5">
                {QUICK_COMMANDS_V2.map((q) => {
                  const Icon = getIcon(q.icon);
                  return (
                    <button
                      key={q.id}
                      onClick={() => {
                        // For prompts ending in a space, focus the input and let the user complete.
                        if (q.prompt.endsWith(' ')) {
                          setTyped2(q.prompt);
                          setPaletteOpen(false);
                          setTimeout(() => inputRef.current?.focus(), 0);
                        } else {
                          void sendCommand(q.prompt);
                        }
                      }}
                      className="jarvis-mono text-[10px] uppercase px-2.5 py-1.5 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] hover:bg-[var(--j-panel-soft)]/80 transition-colors flex items-center gap-1.5"
                      style={{ borderColor: `${q.color}33` }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${q.color}aa`; e.currentTarget.style.color = q.color; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${q.color}33`; e.currentTarget.style.color = ''; }}
                    >
                      <Icon className="h-3 w-3" style={{ color: q.color }} />
                      {q.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Right rail: controls + history + (optional) log */}
        <aside className="border-t lg:border-t-0 lg:border-l border-[var(--j-border)] bg-[rgba(8,10,14,0.55)] flex flex-col min-h-0 max-h-[42vh] lg:max-h-none">
          {/* controls */}
          <div className="p-3 lg:p-4 border-b border-[var(--j-border)] space-y-2.5">
            <button
              onClick={toggleListening}
              disabled={supported === false}
              className={cn(
                'w-full flex items-center justify-center gap-2 h-10 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                continuous
                  ? 'border-[var(--j-green)] bg-[var(--j-green)]/10 text-[var(--j-green)] hover:bg-[var(--j-green)]/20'
                  : 'border-[var(--j-cyan)] bg-[var(--j-cyan)]/10 text-[var(--j-cyan)] hover:bg-[var(--j-cyan)]/20',
              )}
            >
              {continuous ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              <span className="jarvis-mono text-[11px] uppercase tracking-wider">
                {continuous ? 'stop listening' : 'start listening'}
              </span>
            </button>

            <button
              onClick={pushToTalk}
              disabled={supported === false}
              className="w-full flex items-center justify-center gap-2 h-9 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] hover:text-[var(--j-violet)] hover:border-[var(--j-violet)] transition-colors disabled:opacity-40"
            >
              <Zap className="h-3.5 w-3.5" />
              <span className="jarvis-mono text-[10px] uppercase tracking-wider">push to talk</span>
            </button>

            <label className="flex items-center justify-between gap-2 cursor-pointer select-none">
              <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-dim)] flex items-center gap-1.5">
                <Radio className="h-3 w-3" /> wake word required
              </span>
              <button
                onClick={() => setWakeRequired((w) => !w)}
                className={cn(
                  'relative h-5 w-9 rounded-full transition-colors',
                  wakeRequired ? 'bg-[var(--j-cyan)]/70' : 'bg-[var(--j-border)]',
                )}
                role="switch"
                aria-checked={wakeRequired}
                aria-label="Toggle wake word requirement"
              >
                <motion.span
                  className="absolute top-0.5 h-4 w-4 rounded-full bg-white"
                  animate={{ left: wakeRequired ? 18 : 2 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              </button>
            </label>

            {supported === false && (
              <div className="text-[11px] text-[var(--j-amber)] leading-snug jarvis-panel p-2.5" style={{ borderColor: 'var(--j-amber)' }}>
                Web Speech API is unavailable. Type commands below — all intents still work.
              </div>
            )}
          </div>

          {/* history OR log (toggleable) */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-3 lg:px-4 py-2 border-b border-[var(--j-border)] flex items-center justify-between">
              <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] flex items-center gap-1.5">
                {logOpen
                  ? <><Terminal className="h-3 w-3" /> command log</>
                  : <><Activity className="h-3 w-3" /> command history</>}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLogOpen((v) => !v)}
                  className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] hover:text-[var(--j-cyan)]"
                >
                  {logOpen ? 'history' : 'log'}
                </button>
                {(logOpen ? log.length > 0 : history.length > 0) && (
                  <button
                    onClick={() => {
                      if (logOpen) {
                        setLog([]);
                        try { localStorage.removeItem(LOG_STORAGE_KEY); } catch { /* ignore */ }
                      } else {
                        setHistory([]);
                        try { localStorage.removeItem(HISTORY_STORAGE_KEY); } catch { /* ignore */ }
                      }
                    }}
                    className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] hover:text-[var(--j-red)]"
                  >
                    clear
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto jarvis-scroll p-2 space-y-1.5">
              {logOpen ? (
                log.length === 0 ? (
                  <div className="px-3 py-8 text-center jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
                    no log entries yet
                  </div>
                ) : (
                  log.map((l) => (
                    <div
                      key={l.id}
                      className="font-mono text-[10px] p-2 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]/50"
                    >
                      <div className="flex items-center justify-between text-[var(--j-text-mute)] mb-1">
                        <span className="uppercase">{l.intent || 'chat'}</span>
                        <span>{new Date(l.at).toLocaleTimeString()}</span>
                      </div>
                      <div className={cn('flex items-start gap-1', l.ok ? 'text-[var(--j-text)]' : 'text-[var(--j-red)]')}>
                        <span style={{ color: l.ok ? JARVIS.colors.green : JARVIS.colors.red }}>{l.ok ? '✓' : '✗'}</span>
                        <span className="text-[var(--j-cyan)]">{'> '}</span>
                        <span className="break-all">{l.prompt}</span>
                      </div>
                      <div className="text-[var(--j-text-dim)] mt-1 break-words line-clamp-3">
                        {l.response.slice(0, 200)}
                      </div>
                      {l.latencyMs !== undefined && (
                        <div className="text-[var(--j-text-mute)] mt-0.5">{l.latencyMs}ms</div>
                      )}
                    </div>
                  ))
                )
              ) : history.length === 0 ? (
                <div className="px-3 py-8 text-center jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
                  no commands yet
                </div>
              ) : (
                history.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => { setResponse(h.response); setGraph(h.graph ?? null); setLatency(h.latency ?? null); speak(h.response); }}
                    className="w-full text-left p-2 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]/50 hover:border-[var(--j-cyan)] hover:bg-[var(--j-panel-soft)] transition-colors"
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Mic className="h-2.5 w-2.5 text-[var(--j-cyan)] shrink-0" />
                      <span className="text-[11px] text-[var(--j-text)] truncate">{h.prompt}</span>
                      {h.intent && (
                        <span className="jarvis-mono text-[8px] uppercase px-1 py-0.5 rounded border border-[var(--j-border-soft)] text-[var(--j-text-mute)] ml-auto">
                          {h.intent}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-[var(--j-text-dim)] line-clamp-2">{h.response.slice(0, 120)}</div>
                    {h.latency !== undefined && (
                      <div className="jarvis-mono text-[8px] uppercase text-[var(--j-text-mute)] mt-0.5">{h.latency}ms · {new Date(h.at).toLocaleTimeString()}</div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* ---------------- Footer hint ---------------- */}
      <footer className="relative z-10 border-t border-[var(--j-border)] bg-[rgba(8,10,14,0.6)] px-4 lg:px-6 h-9 flex items-center justify-between jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <Maximize2 className="h-3 w-3" /> orion mode
          </span>
          <span className="hidden sm:inline">ctrl+shift+o to exit</span>
          <span className="hidden md:inline">? for shortcuts</span>
        </div>
        <div className="flex items-center gap-3">
          {metrics && <span>tok {metrics.tokens.toLocaleString()}</span>}
          <span>{JARVIS.codename} v{JARVIS.version}</span>
        </div>
      </footer>

      {/* ---------------- "What can I say?" help panel ---------------- */}
      <AnimatePresence>
        {helpOpen && (
          <HelpPanel onClose={() => setHelpOpen(false)} onPick={(p) => { setHelpOpen(false); void sendCommand(p); }} />
        )}
      </AnimatePresence>

      {/* ---------------- Keyboard shortcuts overlay ---------------- */}
      <AnimatePresence>
        {shortcutsOpen && (
          <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ============================================================
   Sub-components
   ============================================================ */

function MiniMetric({ icon: Icon, label, value, color }: { icon: typeof Cpu; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-3 w-3" style={{ color }} />
      <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{label}</span>
      <span className="jarvis-mono text-[11px] tabular-nums" style={{ color }}>{value}</span>
    </div>
  );
}

/* ---------- "What can I say?" help panel ---------- */
function HelpPanel({ onClose, onPick }: { onClose: () => void; onPick: (prompt: string) => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ background: 'rgba(4,5,8,0.85)', backdropFilter: 'blur(10px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
        className="jarvis-panel max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        style={{ borderColor: `${JARVIS.colors.amber}55` }}
      >
        <header className="flex items-center justify-between px-4 lg:px-5 py-3 border-b border-[var(--j-border)]">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4" style={{ color: JARVIS.colors.amber }} />
            <span className="text-sm font-bold jarvis-text-gradient">What can I say?</span>
            <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{INTENT_CATALOG.length} intents</span>
          </div>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-red)]" aria-label="Close help">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto jarvis-scroll p-4 lg:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {INTENT_CATALOG.map((cat) => {
              const Icon = getIcon(cat.icon);
              return (
                <div
                  key={cat.intent}
                  className="rounded-md border p-3"
                  style={{ borderColor: `${cat.color}33`, background: `${cat.color}08` }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-md"
                      style={{ background: `${cat.color}1a`, border: `1px solid ${cat.color}55` }}
                    >
                      <Icon className="h-3.5 w-3.5" style={{ color: cat.color }} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-[var(--j-text)] truncate">{cat.label}</div>
                      <div className="jarvis-mono text-[8px] uppercase text-[var(--j-text-mute)]">{cat.intent}</div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {cat.examples.map((ex) => (
                      <button
                        key={ex}
                        onClick={() => onPick(ex)}
                        className="block w-full text-left text-[11px] text-[var(--j-text-dim)] hover:text-[var(--j-text)] hover:bg-[var(--j-panel-soft)] rounded px-1.5 py-0.5 transition-colors"
                      >
                        <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] mr-1">›</span>{ex}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <footer className="px-4 lg:px-5 py-2.5 border-t border-[var(--j-border)] jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] flex items-center justify-between">
          <span>click any example to run it</span>
          <span>esc to close</span>
        </footer>
      </motion.div>
    </motion.div>
  );
}

/* ---------- Keyboard shortcuts overlay ---------- */
function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const shortcuts: Array<{ keys: string; label: string; icon?: typeof Cpu }> = [
    { keys: 'Ctrl + Shift + O', label: 'Toggle Orion Shell', icon: Maximize2 },
    { keys: 'Esc', label: 'Close overlay / exit', icon: X },
    { keys: '?', label: 'Show this shortcuts panel', icon: HelpCircle },
    { keys: 'Ctrl + K', label: 'Open app command palette (global)', icon: Compass },
    { keys: '↑ ↓', label: 'Navigate command palette', icon: ChevronUp },
    { keys: 'Enter', label: 'Send command / pick palette entry', icon: CornerDownLeft },
    { keys: 'Tab', label: 'Autocomplete palette entry', icon: CornerDownLeft },
    { keys: 'Space', label: 'Push to talk (when input unfocused)', icon: Mic },
    { keys: 'M', label: 'Mute / unmute TTS', icon: VolumeX },
    { keys: 'L', label: 'Toggle command log', icon: Terminal },
  ];
  return (
    <motion.div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ background: 'rgba(4,5,8,0.85)', backdropFilter: 'blur(10px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
        className="jarvis-panel max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        style={{ borderColor: `${JARVIS.colors.cyan}55` }}
      >
        <header className="flex items-center justify-between px-4 lg:px-5 py-3 border-b border-[var(--j-border)]">
          <div className="flex items-center gap-2">
            <span className="jarvis-mono text-[12px] font-bold px-1.5 py-0.5 rounded border border-[var(--j-cyan)]/40 text-[var(--j-cyan)]">?</span>
            <span className="text-sm font-bold jarvis-text-gradient">Keyboard Shortcuts</span>
          </div>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-red)]" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto jarvis-scroll p-4 lg:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {shortcuts.map((s) => {
              const Icon = s.icon || History;
              return (
                <div key={s.keys} className="flex items-center gap-3 p-2 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]/50">
                  <Icon className="h-3.5 w-3.5 text-[var(--j-text-mute)] shrink-0" />
                  <span className="text-[11px] text-[var(--j-text-dim)] flex-1">{s.label}</span>
                  <kbd className="jarvis-mono text-[10px] px-1.5 py-0.5 rounded border border-[var(--j-border)] bg-[var(--j-panel)] text-[var(--j-cyan)]">{s.keys}</kbd>
                </div>
              );
            })}
          </div>
        </div>
        <footer className="px-4 lg:px-5 py-2.5 border-t border-[var(--j-border)] jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] flex items-center justify-between">
          <span>esc to close</span>
          <span>{shortcuts.length} shortcuts</span>
        </footer>
      </motion.div>
    </motion.div>
  );
}
