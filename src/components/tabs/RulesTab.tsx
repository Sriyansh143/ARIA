'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Gavel, Plus, X, Trash2, Edit3, ShieldAlert } from 'lucide-react';
import { useApi, postJson, patchJson, deleteJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, EmptyState, PriorityBadge } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Rule {
  id: string;
  key: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  enabled: boolean;
  updatedAt: string;
}

const CATEGORIES = ['all', 'operational', 'safety', 'financial', 'legal', 'custom'] as const;
const CATEGORY_COLOR: Record<string, string> = {
  operational: JARVIS.colors.cyan,
  safety: JARVIS.colors.red,
  financial: JARVIS.colors.green,
  legal: JARVIS.colors.violet,
  custom: JARVIS.colors.amber,
};

export default function RulesTab() {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('all');
  const { data, loading, refresh } = useApi<{ rules: Rule[] }>(`/api/rules?category=${category === 'all' ? '' : category}`, 15000);
  const { toast } = useToast();
  const [editing, setEditing] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);

  const rules = data?.rules ?? [];
  const enabledCount = rules.filter((r) => r.enabled).length;
  const criticalCount = rules.filter((r) => r.priority === 'critical').length;

  const toggle = async (r: Rule) => {
    await patchJson(`/api/rules/${r.id}`, { enabled: !r.enabled });
    toast({ title: `${r.key} ${r.enabled ? 'disabled' : 'enabled'}` });
    refresh();
  };
  const remove = async (r: Rule) => {
    await deleteJson(`/api/rules/${r.id}`);
    toast({ title: 'Rule deleted' });
    refresh();
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Operator Rules"
        icon={Gavel}
        accent={JARVIS.colors.amber}
        action={
          <Button size="sm" variant="outline" className="jarvis-btn-accent border-0" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New Rule
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Rules" value={rules.length} icon={Gavel} accent={JARVIS.colors.amber} />
        <StatCard label="Enabled" value={enabledCount} icon={Gavel} accent={JARVIS.colors.green} />
        <StatCard label="Critical" value={criticalCount} icon={ShieldAlert} accent={JARVIS.colors.red} />
        <StatCard label="Categories" value={CATEGORIES.length - 1} icon={Gavel} accent={JARVIS.colors.cyan} />
      </div>

      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`jarvis-mono text-[10px] uppercase px-3 py-1.5 rounded-md border transition-colors ${category === c ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'}`}
          >
            {c}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="jarvis-panel h-20 animate-pulse" />)}</div>
      ) : rules.length ? (
        <div className="space-y-2">
          {rules.map((r, i) => {
            const color = CATEGORY_COLOR[r.category] ?? JARVIS.colors.textDim;
            return (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                className={`jarvis-panel p-4 ${r.enabled ? '' : 'opacity-50'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span
                        className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded"
                        style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}
                      >
                        {r.category}
                      </span>
                      <PriorityBadge priority={r.priority} />
                      <span className="jarvis-mono text-xs text-[var(--j-cyan)]">{r.key}</span>
                      {!r.enabled && (
                        <span className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded text-[var(--j-text-mute)] border border-[var(--j-border-soft)]">
                          disabled
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-medium text-[var(--j-text)]">{r.title}</div>
                    <p className="text-xs text-[var(--j-text-dim)] mt-1">{r.description}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => toggle(r)}
                      className={`relative h-5 w-9 rounded-full transition-colors ${r.enabled ? 'bg-[var(--j-green)]' : 'bg-[var(--j-border)]'}`}
                      aria-label="toggle"
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${r.enabled ? 'left-[18px]' : 'left-0.5'}`}
                      />
                    </button>
                    <button onClick={() => setEditing(r)} className="text-[var(--j-text-mute)] hover:text-[var(--j-cyan)] p-1">
                      <Edit3 className="h-3 w-3" />
                    </button>
                    <button onClick={() => remove(r)} className="text-[var(--j-text-mute)] hover:text-[var(--j-red)] p-1">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Gavel} message="No rules yet — create one to constrain agent behavior" />
      )}

      <AnimatePresence>
        {(creating || editing) && (
          <RuleModal
            rule={editing}
            onClose={() => { setCreating(false); setEditing(null); }}
            onDone={() => { setCreating(false); setEditing(null); refresh(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function RuleModal({ rule, onClose, onDone }: { rule: Rule | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [key, setKey] = useState(rule?.key ?? '');
  const [title, setTitle] = useState(rule?.title ?? '');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [category, setCategory] = useState(rule?.category ?? 'operational');
  const [priority, setPriority] = useState(rule?.priority ?? 'medium');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!key || !title) {
      toast({ title: 'Key and title required', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      if (rule) {
        await patchJson(`/api/rules/${rule.id}`, { title, description, category, priority, enabled });
      } else {
        await postJson('/api/rules', { key, title, description, category, priority, enabled });
      }
      toast({ title: rule ? 'Rule updated' : 'Rule created' });
      onDone();
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="relative w-full max-w-md jarvis-panel p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="jarvis-mono text-sm uppercase text-[var(--j-amber)]">
            {rule ? 'Edit Rule' : 'New Rule'}
          </h3>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Key</label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} disabled={!!rule} placeholder="non-investment-only" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Non-Investment Only" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="The system must never invest money…" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[80px]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['operational', 'safety', 'financial', 'legal', 'custom'].map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['low', 'medium', 'high', 'critical'].map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--j-text-dim)] cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-[var(--j-green)]" />
            Enabled
          </label>
          <Button onClick={save} disabled={busy} className="w-full jarvis-btn-accent border-0">
            {busy ? 'Saving…' : rule ? 'Update Rule' : 'Create Rule'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
