'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessagesSquare, Send, X, Trash2, Mail, Radio, ArrowRight, Inbox, CornerDownRight, Sparkles, Loader2 } from 'lucide-react';
import { useApi, postJson, patchJson, deleteJson } from '@/lib/hooks/use-api';
import { JARVIS, timeAgo } from '@/lib/config';
import { SectionTitle, StatCard, Pill, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Msg {
  id: string; fromAgent: string; toAgent: string; subject: string; body: string;
  priority: string; read: boolean; thread: string; createdAt: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  normal: JARVIS.colors.cyan,
  high: JARVIS.colors.amber,
  urgent: JARVIS.colors.red,
};

const THREAD_COLORS: Record<string, string> = {
  engineering: JARVIS.colors.violet,
  research: JARVIS.colors.green,
  standup: JARVIS.colors.cyan,
  ops: JARVIS.colors.amber,
  analytics: JARVIS.colors.green,
  sales: JARVIS.colors.red,
  general: JARVIS.colors.textDim,
};

export default function CommsTab() {
  const { data, loading, refresh } = useApi<{ messages: Msg[]; unread: number }>('/api/comms', 10000);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedThread, setSelectedThread] = useState<string>('all');
  const [active, setActive] = useState<Msg | null>(null);
  const [replying, setReplying] = useState(false);

  const messages = data?.messages ?? [];
  const threads = useMemo(() => {
    const m: Record<string, number> = {};
    for (const msg of messages) m[msg.thread] = (m[msg.thread] ?? 0) + 1;
    return m;
  }, [messages]);

  const filtered = selectedThread === 'all' ? messages : messages.filter((m) => m.thread === selectedThread);

  const markRead = async (m: Msg) => {
    if (!m.read) {
      await patchJson(`/api/comms/${m.id}`, { read: true });
      refresh();
    }
    setActive(m);
  };

  const autoReply = async (m: Msg) => {
    setReplying(true);
    try {
      await postJson('/api/comms/reply', { messageId: m.id });
      toast({ title: 'AI reply sent', description: `${m.toAgent === 'BROADCAST' ? 'ORION' : m.toAgent} replied via AI engine` });
      refresh();
    } catch (e) {
      toast({ title: 'Auto-reply failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setReplying(false);
    }
  };
  const remove = async (m: Msg) => {
    await deleteJson(`/api/comms/${m.id}`);
    toast({ title: 'Message deleted' });
    if (active?.id === m.id) setActive(null);
    refresh();
  };

  const fromMe = messages.filter((m) => m.fromAgent === 'ORION').length;
  const toMe = messages.filter((m) => m.toAgent === 'ORION' || m.toAgent === 'BROADCAST').length;

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Agent Comms Bus"
        icon={MessagesSquare}
        accent={JARVIS.colors.violet}
        action={
          <Button size="sm" variant="outline" className="jarvis-btn-accent border-0" onClick={() => setOpen(true)}>
            <Send className="h-3.5 w-3.5 mr-1" /> New Message
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Messages" value={messages.length} icon={MessagesSquare} accent={JARVIS.colors.cyan} />
        <StatCard label="Unread" value={data?.unread ?? 0} icon={Inbox} accent={JARVIS.colors.amber} />
        <StatCard label="Sent (ORION)" value={fromMe} icon={Send} accent={JARVIS.colors.violet} />
        <StatCard label="Received" value={toMe} icon={Mail} accent={JARVIS.colors.green} />
      </div>

      {/* Thread filter chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedThread('all')}
          className={`jarvis-mono text-[10px] uppercase px-3 py-1.5 rounded-md border transition-colors ${selectedThread === 'all' ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'}`}
        >
          all threads <span className="opacity-60">{messages.length}</span>
        </button>
        {Object.entries(threads).map(([t, n]) => {
          const color = THREAD_COLORS[t] ?? JARVIS.colors.textDim;
          const isActive = selectedThread === t;
          return (
            <button
              key={t}
              onClick={() => setSelectedThread(t)}
              className="jarvis-mono text-[10px] uppercase px-3 py-1.5 rounded-md border transition-colors flex items-center gap-1.5"
              style={isActive ? { background: `${color}1a`, borderColor: color, color } : { borderColor: 'var(--j-border)', color: 'var(--j-text-dim)' }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
              {t} <span className="opacity-60">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Message list */}
        <div className="lg:col-span-1 jarvis-panel p-0 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[var(--j-border)] flex items-center justify-between bg-[var(--j-panel-soft)]/40">
            <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Inbox · {filtered.length}</span>
            {data && data.unread > 0 && <Pill color={JARVIS.colors.amber}>{data.unread} unread</Pill>}
          </div>
          <div className="max-h-[60vh] overflow-y-auto jarvis-scroll">
            {loading && !data ? (
              <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 rounded bg-[var(--j-panel-soft)] animate-pulse" />)}</div>
            ) : filtered.length ? (
              filtered.map((m, i) => {
                const pColor = PRIORITY_COLORS[m.priority] ?? JARVIS.colors.cyan;
                const isActive = active?.id === m.id;
                const isBroadcast = m.toAgent === 'BROADCAST';
                return (
                  <motion.button
                    key={m.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    onClick={() => markRead(m)}
                    className={`w-full text-left px-3 py-2.5 border-b border-[var(--j-border-soft)] hover:bg-[var(--j-panel-soft)]/60 transition-colors relative ${isActive ? 'bg-[var(--j-panel-soft)]' : ''} ${!m.read ? 'bg-[var(--j-violet)]/5' : ''}`}
                  >
                    {!m.read && <span className="absolute left-0 top-0 bottom-0 w-[2px]" style={{ background: JARVIS.colors.violet }} />}
                    <div className="flex items-center gap-2 mb-1">
                      {isBroadcast ? <Radio className="h-3 w-3 text-[var(--j-cyan)] shrink-0" /> : <CornerDownRight className="h-3 w-3 text-[var(--j-text-mute)] shrink-0" />}
                      <span className="jarvis-mono text-[10px] text-[var(--j-cyan)] shrink-0">{m.fromAgent}</span>
                      <ArrowRight className="h-2.5 w-2.5 text-[var(--j-text-mute)]" />
                      <span className="jarvis-mono text-[10px] text-[var(--j-green)] shrink-0">{isBroadcast ? 'ALL' : m.toAgent}</span>
                      <span className="ml-auto jarvis-mono text-[9px] text-[var(--j-text-mute)] shrink-0">{timeAgo(m.createdAt)}</span>
                    </div>
                    <div className="text-xs text-[var(--j-text)] truncate pl-5">{m.subject}</div>
                    <div className="flex items-center gap-1.5 mt-1 pl-5">
                      <span className="jarvis-mono text-[9px] uppercase px-1 py-0.5 rounded" style={{ color: pColor, background: `${pColor}1a`, border: `1px solid ${pColor}33` }}>{m.priority}</span>
                      <span className="jarvis-mono text-[9px] uppercase px-1 py-0.5 rounded" style={{ color: THREAD_COLORS[m.thread] ?? JARVIS.colors.textDim, background: `${THREAD_COLORS[m.thread] ?? JARVIS.colors.textDim}1a` }}>{m.thread}</span>
                    </div>
                  </motion.button>
                );
              })
            ) : (
              <EmptyState icon={MessagesSquare} message="No messages" />
            )}
          </div>
        </div>

        {/* Message detail */}
        <div className="lg:col-span-2 jarvis-panel p-0 overflow-hidden">
          <AnimatePresence mode="wait">
            {active ? (
              <motion.div key={active.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="px-5 py-3 border-b border-[var(--j-border)] flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="jarvis-mono text-[10px] uppercase px-1.5 py-0.5 rounded" style={{ color: PRIORITY_COLORS[active.priority], background: `${PRIORITY_COLORS[active.priority]}1a`, border: `1px solid ${PRIORITY_COLORS[active.priority]}33` }}>{active.priority}</span>
                      <span className="jarvis-mono text-[10px] uppercase px-1.5 py-0.5 rounded" style={{ color: THREAD_COLORS[active.thread] ?? JARVIS.colors.textDim, background: `${THREAD_COLORS[active.thread] ?? JARVIS.colors.textDim}1a` }}>{active.thread}</span>
                      <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">{timeAgo(active.createdAt)}</span>
                    </div>
                    <h3 className="text-base font-semibold text-[var(--j-text)]">{active.subject}</h3>
                  </div>
                  <button onClick={() => remove(active)} className="text-[var(--j-text-mute)] hover:text-[var(--j-red)] p-1 shrink-0"><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="px-5 py-4 border-b border-[var(--j-border)] flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${JARVIS.colors.cyan}1a`, border: `1px solid ${JARVIS.colors.cyan}33`, color: JARVIS.colors.cyan }}>
                    <span className="jarvis-mono text-[10px] font-bold">{active.fromAgent.slice(0, 2)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="jarvis-mono text-xs text-[var(--j-cyan)]">{active.fromAgent}</div>
                    <div className="text-[10px] text-[var(--j-text-mute)] flex items-center gap-1"><ArrowRight className="h-2.5 w-2.5" /> {active.toAgent === 'BROADCAST' ? 'All agents (broadcast)' : active.toAgent}</div>
                  </div>
                  <div className="jarvis-mono text-[9px] text-[var(--j-text-mute)] text-right">
                    <div>{new Date(active.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</div>
                  </div>
                </div>
                <div className="px-5 py-5">
                  <p className="text-sm text-[var(--j-text)] leading-relaxed whitespace-pre-wrap">{active.body}</p>
                </div>
                <div className="px-5 py-3 border-t border-[var(--j-border)] bg-[var(--j-panel-soft)]/40 flex items-center gap-2">
                  <Button size="sm" variant="outline" className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)]" onClick={() => { setOpen(true); }}>
                    <CornerDownRight className="h-3.5 w-3.5 mr-1" /> Reply
                  </Button>
                  <Button size="sm" variant="outline" className="jarvis-btn-accent border-0" onClick={() => autoReply(active)} disabled={replying}>
                    {replying ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Thinking…</> : <><Sparkles className="h-3.5 w-3.5 mr-1" /> Auto-Reply (AI)</>}
                  </Button>
                  <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] ml-auto">thread: {active.thread}</span>
                </div>
              </motion.div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl mb-3" style={{ background: `${JARVIS.colors.violet}1a`, border: `1px solid ${JARVIS.colors.violet}33`, color: JARVIS.colors.violet }}>
                  <Mail className="h-7 w-7" />
                </div>
                <div className="text-sm text-[var(--j-text-dim)]">Select a message to read</div>
                <div className="jarvis-mono text-[10px] text-[var(--j-text-mute)] mt-1">{filtered.length} messages in view</div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {open && <ComposeModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); refresh(); }} defaultThread={active?.thread} defaultTo={active?.fromAgent} />}
      </AnimatePresence>
    </div>
  );
}

function ComposeModal({ onClose, onDone, defaultThread, defaultTo }: { onClose: () => void; onDone: () => void; defaultThread?: string; defaultTo?: string }) {
  const { toast } = useToast();
  const { data } = useApi<{ agents: Array<{ codename: string; name: string }> }>('/api/agents', 0);
  const [fromAgent, setFromAgent] = useState('ORION');
  const [toAgent, setToAgent] = useState(defaultTo && defaultTo !== 'BROADCAST' ? defaultTo : 'ATLAS');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState('normal');
  const [thread, setThread] = useState(defaultThread ?? 'general');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!subject || !body) { toast({ title: 'Subject and body required', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      await postJson('/api/comms', { fromAgent, toAgent, subject, body, priority, thread });
      toast({ title: 'Message sent' });
      onDone();
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} className="relative w-full max-w-lg jarvis-panel p-5 max-h-[90vh] overflow-y-auto jarvis-scroll">
        <div className="flex items-center justify-between mb-4">
          <h3 className="jarvis-mono text-sm uppercase text-[var(--j-violet)]">Compose Message</h3>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">From</label>
              <Select value={fromAgent} onValueChange={setFromAgent}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono"><SelectValue /></SelectTrigger>
                <SelectContent>{data?.agents?.map((a) => <SelectItem key={a.codename} value={a.codename}>{a.codename}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">To</label>
              <Select value={toAgent} onValueChange={setToAgent}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BROADCAST">BROADCAST (all)</SelectItem>
                  {data?.agents?.filter((a) => a.codename !== fromAgent).map((a) => <SelectItem key={a.codename} value={a.codename}>{a.codename}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Subject</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief subject line" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue /></SelectTrigger>
                <SelectContent>{['normal', 'high', 'urgent'].map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Thread</label>
              <Select value={thread} onValueChange={setThread}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono"><SelectValue /></SelectTrigger>
                <SelectContent>{['general', 'engineering', 'research', 'standup', 'ops', 'analytics', 'sales'].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Message</label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Compose your message…" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[120px]" />
          </div>
          <Button onClick={submit} disabled={busy} className="w-full jarvis-btn-accent border-0">
            {busy ? 'Sending…' : <><Send className="h-3.5 w-3.5 mr-1.5" /> Send Message</>}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
