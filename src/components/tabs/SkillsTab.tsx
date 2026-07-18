'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import * as Icons from 'lucide-react';
import {
  Sparkles,
  Play,
  Brain,
  GitBranch,
  Shield,
  TreePine,
  ArrowLeft,
  Layers,
  Wrench,
  FileText,
  RefreshCw,
  UploadCloud,
  type LucideIcon,
} from 'lucide-react';
import { useApi, postJson, patchJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import FileUpload from '@/components/jarvis/FileUpload';

/* ---------- Reasoning Skills (claude-skills port) ---------- */

interface ReasoningSkill {
  key: string;
  name: string;
  description: string;
}

// Map each reasoning-skill key to a lucide icon + accent colour.
const REASONING_ICONS: Record<string, { icon: LucideIcon; accent: string }> = {
  'chain-of-thought': { icon: Brain, accent: JARVIS.colors.cyan },
  'constitutional-ai': { icon: Shield, accent: JARVIS.colors.red },
  'react-pattern': { icon: RefreshCw, accent: JARVIS.colors.green },
  'tree-of-thoughts': { icon: TreePine, accent: JARVIS.colors.green },
  'step-back-prompting': { icon: ArrowLeft, accent: JARVIS.colors.amber },
  'few-shot-learning': { icon: Layers, accent: JARVIS.colors.violet },
  guardrails: { icon: Sparkles, accent: JARVIS.colors.red },
  'tool-use': { icon: Wrench, accent: JARVIS.colors.amber },
  'long-context': { icon: FileText, accent: JARVIS.colors.cyan },
  'self-reflection': { icon: GitBranch, accent: JARVIS.colors.violet },
};

function ReasoningSkillsRow() {
  // Fetch once on mount (no polling).
  const { data, loading } = useApi<{ skills: ReasoningSkill[] }>('/api/reasoning', -1);
  const skills = data?.skills ?? [];
  if (loading && skills.length === 0) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="jarvis-panel h-16 w-56 shrink-0 animate-pulse" />
        ))}
      </div>
    );
  }
  if (skills.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
      {skills.map((s, i) => {
        const meta = REASONING_ICONS[s.key] ?? { icon: Sparkles, accent: JARVIS.colors.cyan };
        const Icon = meta.icon;
        return (
          <motion.div
            key={s.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            className="jarvis-panel p-3 shrink-0 w-60 jarvis-card-hover"
            title={s.description}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-md shrink-0"
                style={{ background: `${meta.accent}1a`, border: `1px solid ${meta.accent}33`, color: meta.accent }}
              >
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-[var(--j-text)] truncate">{s.name}</div>
                <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{s.key}</div>
              </div>
            </div>
            <p className="text-[11px] leading-snug text-[var(--j-text-dim)] line-clamp-2">{s.description}</p>
          </motion.div>
        );
      })}
    </div>
  );
}

interface Skill {
  id: string; key: string; name: string; description: string; category: string;
  icon: string; enabled: boolean; runs: number;
}

const CATEGORIES = ['all', 'general', 'research', 'code', 'comms', 'data', 'security', 'media'] as const;
const CAT_COLORS: Record<string, string> = {
  general: JARVIS.colors.cyan,
  research: JARVIS.colors.green,
  code: JARVIS.colors.violet,
  comms: JARVIS.colors.amber,
  data: JARVIS.colors.cyan,
  security: JARVIS.colors.red,
  media: JARVIS.colors.violet,
};

export default function SkillsTab() {
  const { data, loading, refresh } = useApi<{ skills: Skill[] }>('/api/skills', 12000);
  const { toast } = useToast();
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>('all');
  const [q, setQ] = useState('');

  const skills = (data?.skills ?? []).filter((s) =>
    (cat === 'all' || s.category === cat) &&
    (!q || s.name.toLowerCase().includes(q.toLowerCase()) || s.description.toLowerCase().includes(q.toLowerCase())),
  );
  const enabled = (data?.skills ?? []).filter((s) => s.enabled).length;

  const toggle = async (s: Skill) => {
    await patchJson(`/api/skills/${s.key}`, { enabled: !s.enabled });
    toast({ title: `${s.name} ${s.enabled ? 'disabled' : 'enabled'}` });
    refresh();
  };
  const run = async (s: Skill) => {
    await postJson(`/api/skills/${s.key}`, {});
    toast({ title: `${s.name} executed`, description: `${s.runs + 1} total runs` });
    refresh();
  };

  return (
    <div className="space-y-4">
      <SectionTitle title="Skills Catalog" icon={Sparkles} accent={JARVIS.colors.cyan} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total" value={data?.skills?.length ?? 0} icon={Sparkles} accent={JARVIS.colors.cyan} />
        <StatCard label="Enabled" value={enabled} icon={Sparkles} accent={JARVIS.colors.green} />
        <StatCard label="Categories" value={CATEGORIES.length - 1} icon={Sparkles} accent={JARVIS.colors.violet} />
        <StatCard label="Total Runs" value={(data?.skills ?? []).reduce((a, s) => a + s.runs, 0)} icon={Play} accent={JARVIS.colors.amber} />
      </div>

      {/* Reasoning Skills — ported claude-skills patterns. */}
      <div className="space-y-2">
        <SectionTitle title="Reasoning Skills" icon={Brain} accent={JARVIS.colors.violet} />
        <ReasoningSkillsRow />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`jarvis-mono text-[10px] uppercase px-3 py-1.5 rounded-md border transition-colors ${cat === c ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'}`}
            >
              {c}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search skills…"
          className="jarvis-mono text-xs px-3 py-1.5 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text)] placeholder:text-[var(--j-text-mute)] outline-none focus:border-[var(--j-cyan)] w-full sm:w-56"
        />
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="jarvis-panel h-32 animate-pulse" />)}</div>
      ) : skills.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {skills.map((s, i) => {
            const color = CAT_COLORS[s.category] ?? JARVIS.colors.cyan;
            const Icon = (Icons as unknown as Record<string, LucideIcon>)[s.icon] ?? Sparkles;
            return (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                className={`jarvis-panel jarvis-card-hover p-4 ${s.enabled ? '' : 'opacity-60'}`}
              >
                <div className="flex items-start justify-between mb-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${color}1a`, border: `1px solid ${color}33`, color }}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-[var(--j-text)]">{s.name}</div>
                      <div className="jarvis-mono text-[9px] uppercase" style={{ color }}>{s.category}</div>
                    </div>
                  </div>
                  <Switch checked={s.enabled} onCheckedChange={() => toggle(s)} />
                </div>
                <p className="text-xs text-[var(--j-text-dim)] mb-3 line-clamp-2">{s.description}</p>
                <div className="flex items-center justify-between">
                  <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{s.runs} runs · {s.key}</span>
                  <button onClick={() => run(s)} disabled={!s.enabled} className="jarvis-mono text-[9px] uppercase px-2 py-1 rounded flex items-center gap-1 jarvis-btn-accent border-0 disabled:opacity-40">
                    <Play className="h-2.5 w-2.5" /> run
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Sparkles} message="No skills match" />
      )}

      {/* Universal file upload — accepts any file type, stores under /uploads/skill */}
      <div className="space-y-2 pt-2">
        <SectionTitle title="Skill File Upload" icon={UploadCloud} accent={JARVIS.colors.cyan} />
        <FileUpload scope="skill" />
      </div>
    </div>
  );
}
