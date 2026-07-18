'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Database, Plus, X, Pin, Trash2, Search, UploadCloud } from 'lucide-react';
import { useApi, postJson, patchJson, deleteJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import FileUpload from '@/components/jarvis/FileUpload';

interface Mem {
  id: string; scope: string; key: string; value: string; tags: string;
  pinned: boolean; updatedAt: string;
}

const SCOPES = ['all', 'semantic', 'episodic', 'working', 'conversation'] as const;
const SCOPE_COLORS: Record<string, string> = {
  semantic: JARVIS.colors.cyan,
  episodic: JARVIS.colors.violet,
  working: JARVIS.colors.amber,
  conversation: JARVIS.colors.green,
};

export default function MemoryTab() {
  const [scope, setScope] = useState<(typeof SCOPES)[number]>('all');
  const [q, setQ] = useState('');
  const { data, loading, refresh } = useApi<{ items: Mem[] }>(`/api/memory?scope=${scope === 'all' ? '' : scope}&q=${encodeURIComponent(q)}`, 10000);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const items = data?.items ?? [];

  const togglePin = async (m: Mem) => {
    await patchJson(`/api/memory/${m.id}`, { pinned: !m.pinned });
    refresh();
  };
  const remove = async (m: Mem) => {
    await deleteJson(`/api/memory/${m.id}`);
    toast({ title: 'Memory deleted' });
    refresh();
  };

  const scopeCounts = SCOPES.slice(1).map((s) => ({ s, n: items.filter((m) => m.scope === s).length }));

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Memory Store"
        icon={Database}
        accent={JARVIS.colors.violet}
        action={<Button size="sm" variant="outline" className="jarvis-btn-accent border-0" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Store Memory</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {SCOPES.slice(1).map((s, i) => (
          <StatCard key={s} label={s} value={scopeCounts.find((c) => c.s === s)?.n ?? 0} icon={Database} accent={SCOPE_COLORS[s]} delay={i * 0.04} />
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {SCOPES.map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`jarvis-mono text-[10px] uppercase px-3 py-1.5 rounded-md border transition-colors ${scope === s ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--j-text-mute)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search memory…"
            className="jarvis-mono text-xs pl-8 pr-3 py-1.5 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text)] placeholder:text-[var(--j-text-mute)] outline-none focus:border-[var(--j-violet)] w-full"
          />
        </div>
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="jarvis-panel h-28 animate-pulse" />)}</div>
      ) : items.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((m, i) => {
            const color = SCOPE_COLORS[m.scope] ?? JARVIS.colors.cyan;
            const tags: string[] = JSON.parse(m.tags || '[]');
            return (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                className={`jarvis-panel jarvis-card-hover p-4 ${m.pinned ? 'border-[var(--j-violet)]/40' : ''}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="jarvis-mono text-[10px] uppercase px-1.5 py-0.5 rounded" style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}>{m.scope}</span>
                    <span className="jarvis-mono text-xs text-[var(--j-cyan)]">{m.key}</span>
                    {m.pinned && <Pin className="h-3 w-3 text-[var(--j-violet)] fill-[var(--j-violet)]" />}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => togglePin(m)} className="text-[var(--j-text-mute)] hover:text-[var(--j-violet)] p-1"><Pin className="h-3 w-3" /></button>
                    <button onClick={() => remove(m)} className="text-[var(--j-text-mute)] hover:text-[var(--j-red)] p-1"><Trash2 className="h-3 w-3" /></button>
                  </div>
                </div>
                <p className="text-xs text-[var(--j-text-dim)] mb-2">{m.value}</p>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tags.map((t) => <span key={t} className="jarvis-mono text-[9px] px-1.5 py-0.5 rounded bg-[var(--j-panel-soft)] text-[var(--j-text-mute)] border border-[var(--j-border-soft)]">#{t}</span>)}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Database} message="No memories stored" />
      )}

      {open && <NewMemoryModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); refresh(); }} />}

      {/* Universal file upload — accepts any file type, stores under /uploads/memory */}
      <div className="space-y-2 pt-2">
        <SectionTitle title="Memory File Upload" icon={UploadCloud} accent={JARVIS.colors.cyan} />
        <FileUpload scope="memory" />
      </div>
    </div>
  );
}

function NewMemoryModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [scope, setScope] = useState('semantic');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!key || !value) { toast({ title: 'Key and value required', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      await postJson('/api/memory', { scope, key, value, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) });
      toast({ title: 'Memory stored' });
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
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-md jarvis-panel p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="jarvis-mono text-sm uppercase text-[var(--j-violet)]">Store Memory</h3>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Scope</label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue /></SelectTrigger>
              <SelectContent>{['semantic', 'episodic', 'working', 'conversation'].map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Key</label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. project-status" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Value</label>
            <Textarea value={value} onChange={(e) => setValue(e.target.value)} placeholder="The memory content…" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[80px]" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Tags (comma-separated)</label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="project, status" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <Button onClick={submit} disabled={busy} className="w-full jarvis-btn-accent border-0">{busy ? 'Storing…' : 'Store'}</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
