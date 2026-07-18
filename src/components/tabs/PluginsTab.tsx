'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Puzzle, Plus, X, Trash2, Settings2, Power, ExternalLink } from 'lucide-react';
import { useApi, postJson, patchJson, deleteJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, EmptyState, Pill } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Plugin {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  version: string;
  enabled: boolean;
  config: string;
  updatedAt: string;
}

const CATEGORIES = ['all', 'general', 'research', 'comms', 'automation', 'integration'] as const;
const CATEGORY_COLOR: Record<string, string> = {
  general: JARVIS.colors.cyan,
  research: JARVIS.colors.violet,
  comms: JARVIS.colors.amber,
  automation: JARVIS.colors.green,
  integration: JARVIS.colors.red,
};

export default function PluginsTab() {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('all');
  const { data, loading, refresh } = useApi<{ plugins: Plugin[] }>(`/api/plugins?category=${category === 'all' ? '' : category}`, 15000);
  const { toast } = useToast();
  const [editing, setEditing] = useState<Plugin | null>(null);
  const [creating, setCreating] = useState(false);

  const plugins = data?.plugins ?? [];
  const enabledCount = plugins.filter((p) => p.enabled).length;

  const toggle = async (p: Plugin) => {
    await patchJson(`/api/plugins/${p.id}`, { enabled: !p.enabled });
    toast({ title: `${p.key} ${p.enabled ? 'disabled' : 'enabled'}` });
    refresh();
  };
  const remove = async (p: Plugin) => {
    await deleteJson(`/api/plugins/${p.id}`);
    toast({ title: 'Plugin removed' });
    refresh();
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Plugins"
        icon={Puzzle}
        accent={JARVIS.colors.violet}
        action={
          <Button size="sm" variant="outline" className="jarvis-btn-accent border-0" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New Plugin
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total" value={plugins.length} icon={Puzzle} accent={JARVIS.colors.violet} />
        <StatCard label="Enabled" value={enabledCount} icon={Power} accent={JARVIS.colors.green} />
        <StatCard label="Disabled" value={plugins.length - enabledCount} icon={Power} accent={JARVIS.colors.textMute} />
        <StatCard label="Categories" value={CATEGORIES.length - 1} icon={Settings2} accent={JARVIS.colors.cyan} />
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="jarvis-panel h-40 animate-pulse" />)}
        </div>
      ) : plugins.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {plugins.map((p, i) => {
            const color = CATEGORY_COLOR[p.category] ?? JARVIS.colors.cyan;
            let configParsed: Record<string, unknown> = {};
            try { configParsed = JSON.parse(p.config || '{}'); } catch { /* ignore */ }
            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className={`jarvis-panel jarvis-card-hover p-4 ${p.enabled ? '' : 'opacity-60'}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-md shrink-0"
                      style={{ background: `${color}1a`, border: `1px solid ${color}33`, color }}
                    >
                      <Puzzle className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--j-text)] truncate">{p.name}</div>
                      <div className="jarvis-mono text-[10px] text-[var(--j-cyan)] truncate">{p.key} · v{p.version}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => toggle(p)}
                    className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${p.enabled ? 'bg-[var(--j-green)]' : 'bg-[var(--j-border)]'}`}
                    aria-label="toggle"
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${p.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                </div>
                <p className="text-xs text-[var(--j-text-dim)] mb-3 line-clamp-2">{p.description}</p>
                <div className="flex items-center justify-between">
                  <span
                    className="jarvis-mono text-[9px] uppercase px-1.5 py-0.5 rounded"
                    style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}
                  >
                    {p.category}
                  </span>
                  <div className="flex gap-1">
                    {Object.keys(configParsed).length > 0 && (
                      <Pill color={JARVIS.colors.textDim}>{Object.keys(configParsed).length} cfg</Pill>
                    )}
                    <button onClick={() => setEditing(p)} className="text-[var(--j-text-mute)] hover:text-[var(--j-cyan)] p-1">
                      <Settings2 className="h-3 w-3" />
                    </button>
                    <button onClick={() => remove(p)} className="text-[var(--j-text-mute)] hover:text-[var(--j-red)] p-1">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Puzzle} message="No plugins installed" />
      )}

      <AnimatePresence>
        {(creating || editing) && (
          <PluginModal
            plugin={editing}
            onClose={() => { setCreating(false); setEditing(null); }}
            onDone={() => { setCreating(false); setEditing(null); refresh(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function PluginModal({ plugin, onClose, onDone }: { plugin: Plugin | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [key, setKey] = useState(plugin?.key ?? '');
  const [name, setName] = useState(plugin?.name ?? '');
  const [description, setDescription] = useState(plugin?.description ?? '');
  const [category, setCategory] = useState(plugin?.category ?? 'general');
  const [version, setVersion] = useState(plugin?.version ?? '1.0.0');
  const [enabled, setEnabled] = useState(plugin?.enabled ?? false);
  const [configText, setConfigText] = useState(plugin?.config ?? '{}');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!key || !name) {
      toast({ title: 'Key and name required', variant: 'destructive' });
      return;
    }
    let config: unknown = configText;
    try {
      config = JSON.parse(configText);
    } catch {
      // keep as string — server will accept either
    }
    setBusy(true);
    try {
      if (plugin) {
        await patchJson(`/api/plugins/${plugin.id}`, { name, description, category, version, enabled, config });
      } else {
        await postJson('/api/plugins', { key, name, description, category, version, enabled, config });
      }
      toast({ title: plugin ? 'Plugin updated' : 'Plugin created' });
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
          <h3 className="jarvis-mono text-sm uppercase text-[var(--j-violet)]">
            {plugin ? 'Edit Plugin' : 'New Plugin'}
          </h3>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Key</label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} disabled={!!plugin} placeholder="web-search" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Web Search" className="bg-[var(--j-panel-soft)] border-[var(--j-border)]" />
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Search the live web…" className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[60px]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['general', 'research', 'comms', 'automation', 'integration'].map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Version</label>
              <Input value={version} onChange={(e) => setVersion(e.target.value)} className="bg-[var(--j-panel-soft)] border-[var(--j-border)] jarvis-mono" />
            </div>
          </div>
          <div>
            <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Config (JSON)</label>
            <Textarea value={configText} onChange={(e) => setConfigText(e.target.value)} placeholder='{"apiKey":""}' className="bg-[var(--j-panel-soft)] border-[var(--j-border)] min-h-[80px] jarvis-mono text-[11px]" />
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--j-text-dim)] cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-[var(--j-green)]" />
            Enabled
          </label>
          <Button onClick={save} disabled={busy} className="w-full jarvis-btn-accent border-0">
            {busy ? 'Saving…' : plugin ? 'Update Plugin' : 'Create Plugin'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
