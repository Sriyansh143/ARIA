'use client';

import {
  GraduationCap,
  DollarSign,
  Award,
  BarChart3,
  Trophy,
  Wand2,
  Shuffle,
  Brain,
  Loader2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useApi, postJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, EmptyState, Pill } from '@/components/jarvis/shared';
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Cell,
} from 'recharts';
import TeachSourceCard from './TeachSourceCard';
import { useToast } from '@/hooks/use-toast';
import {
  autoCategorize,
  type TargetSection,
  TARGET_SECTION_LABELS,
} from '@/lib/categorize';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

interface Record {
  id: string;
  agentCodename: string;
  skillKey: string;
  proficiency: number;
  learnedFrom: string | null;
  earnings: number;
  lastUsed: string | null;
  updatedAt: string;
}

interface Stats {
  total: number;
  totalEarnings: number;
  avgProficiency: number;
  mastered: number;
}

interface MemoryItemRow {
  id: string;
  key: string;
  scope: string;
  value: string;
  tags: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  suggestedSection?: TargetSection;
  confidence?: number;
  reason?: string;
}

interface MoveDetail {
  id: string;
  key: string;
  from: string;
  to: string;
  reason: string;
  confidence: number;
}

interface AutoMoveResult {
  dryRun: boolean;
  scanned: number;
  moved: number;
  skipped: number;
  details: MoveDetail[];
}

const PROFICIENCY_COLOR = (v: number) => {
  if (v >= 90) return JARVIS.colors.green;
  if (v >= 60) return JARVIS.colors.cyan;
  if (v >= 30) return JARVIS.colors.amber;
  return JARVIS.colors.red;
};

const SECTION_COLOR: Record<string, string> = {
  skill: JARVIS.colors.cyan,
  plugin: JARVIS.colors.violet,
  memory: JARVIS.colors.amber,
  knowledge: JARVIS.colors.green,
  intelligence: JARVIS.colors.red,
  learning: JARVIS.colors.cyanDim,
};

function SectionBadge({
  section,
  suggested,
  current,
}: {
  section: TargetSection;
  suggested?: boolean;
  current?: string;
}) {
  const color = SECTION_COLOR[section] ?? JARVIS.colors.textMute;
  const label = TARGET_SECTION_LABELS[section] ?? section;
  const mismatches = suggested && current && current !== section;
  return (
    <span
      className="jarvis-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border"
      style={{
        color,
        borderColor: `${color}55`,
        background: `${color}10`,
        textDecoration: mismatches ? 'none' : 'none',
      }}
      title={mismatches ? `currently in ${current} — suggested ${section}` : label}
    >
      {suggested ? '→ ' : ''}
      {label}
    </span>
  );
}

export default function LearningTab() {
  const { toast } = useToast();
  const { data, loading, refresh } = useApi<{
    records: Record[];
    stats: Stats;
    earningsByAgent: Array<{ agent: string; earnings: number }>;
    proficiencyBySkill: Array<{ skill: string; proficiency: number }>;
  }>('/api/learning', 15000);

  // Separate fetch for MemoryItems (the teach-source ingestions).
  const mem = useApi<{ items: MemoryItemRow[] }>('/api/learning/teach', 15000);

  // Auto-categorize preview state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState('');
  const [previewResult, setPreviewResult] = useState<{
    suggestedSection: TargetSection;
    confidence: number;
    reason: string;
  } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  // Auto-move state
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveResult, setMoveResult] = useState<AutoMoveResult | null>(null);

  const stats = data?.stats ?? { total: 0, totalEarnings: 0, avgProficiency: 0, mastered: 0 };
  const records = data?.records ?? [];
  const earningsByAgent = data?.earningsByAgent ?? [];
  const proficiencyBySkill = data?.proficiencyBySkill ?? [];
  const memoryItems = mem.data?.items ?? [];

  const runPreview = async () => {
    if (!previewText.trim()) {
      toast({ title: 'Paste some content first', variant: 'destructive' });
      return;
    }
    setPreviewBusy(true);
    try {
      const r = await postJson<{
        suggestedSection: TargetSection;
        confidence: number;
        reason: string;
      }>('/api/learning/auto-categorize', { content: previewText });
      setPreviewResult(r);
    } catch (e) {
      toast({
        title: 'Categorize failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    } finally {
      setPreviewBusy(false);
    }
  };

  const runAutoMove = async (dryRun: boolean) => {
    setMoveBusy(true);
    try {
      const r = await postJson<AutoMoveResult>('/api/learning/auto-move', {
        dryRun,
        limit: 500,
      });
      setMoveResult(r);
      toast({
        title: dryRun
          ? `Dry-run: would move ${r.moved} of ${r.scanned}`
          : `Moved ${r.moved} of ${r.scanned}`,
        description: r.skipped > 0 ? `${r.skipped} already in place` : undefined,
      });
      if (!dryRun) {
        mem.refresh();
        refresh();
      }
    } catch (e) {
      toast({
        title: 'Auto-move failed',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      });
    } finally {
      setMoveBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle title="Learn & Earn" icon={GraduationCap} accent={JARVIS.colors.cyan} />

      <TeachSourceCard onTaught={() => { refresh(); mem.refresh(); }} />

      {/* Auto-categorize + auto-move controls */}
      <div className="jarvis-panel p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-[var(--j-violet)]" />
            <div>
              <div className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text)]">
                Auto-Categorize & Move
              </div>
              <div className="text-[11px] text-[var(--j-text-dim)]">
                Scan all learning memories and re-file each to its best section
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="border-[var(--j-border)] bg-[var(--j-panel-soft)]"
              onClick={() => setPreviewOpen((v) => !v)}
            >
              <Wand2 className="h-3.5 w-3.5 mr-1.5" /> Auto-Categorize
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-[var(--j-border)] bg-[var(--j-panel-soft)]"
              onClick={() => runAutoMove(true)}
              disabled={moveBusy}
            >
              {moveBusy ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Shuffle className="h-3.5 w-3.5 mr-1.5" />
              )}
              Dry-Run
            </Button>
            <Button
              size="sm"
              className="jarvis-btn-accent border-0"
              onClick={() => runAutoMove(false)}
              disabled={moveBusy}
            >
              {moveBusy ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Shuffle className="h-3.5 w-3.5 mr-1.5" />
              )}
              Auto-Move All
            </Button>
          </div>
        </div>

        {/* Auto-categorize preview panel */}
        {previewOpen && (
          <div className="mb-3 p-3 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)] space-y-2">
            <div className="flex items-center justify-between">
              <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
                Paste content to preview its suggested section
              </span>
              <button
                onClick={() => setPreviewOpen(false)}
                className="p-1 rounded hover:bg-[var(--j-border-soft)] text-[var(--j-text-mute)]"
                aria-label="close preview"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <Textarea
              value={previewText}
              onChange={(e) => setPreviewText(e.target.value)}
              placeholder="Paste any text — the analyzer will suggest skill / plugin / memory / knowledge / intelligence / learning"
              className="bg-[var(--j-panel)] border-[var(--j-border)] min-h-[80px] jarvis-mono text-xs"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={runPreview} disabled={previewBusy}>
                {previewBusy ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                )}
                Analyze
              </Button>
              {/* Instant client-side preview */}
              {previewText.trim() && (
                <span className="text-[10px] text-[var(--j-text-mute)]">
                  live:{' '}
                  <SectionBadge
                    section={autoCategorize(previewText).suggestedSection}
                  />
                </span>
              )}
            </div>
            {previewResult && (
              <div className="mt-2 p-2 rounded-md border border-[var(--j-border)] bg-[var(--j-panel)]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
                    Suggested:
                  </span>
                  <SectionBadge section={previewResult.suggestedSection} />
                  <span className="jarvis-mono text-[10px] text-[var(--j-text-dim)]">
                    conf {(previewResult.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="text-[11px] text-[var(--j-text-dim)] mt-1">
                  {previewResult.reason}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Auto-move results */}
        {moveResult && (
          <div className="p-3 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]">
            <div className="flex items-center justify-between mb-2">
              <span className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">
                {moveResult.dryRun ? 'Dry-run result' : 'Move result'} —{' '}
                scanned {moveResult.scanned}, moved {moveResult.moved}, skipped{' '}
                {moveResult.skipped}
              </span>
              <button
                onClick={() => setMoveResult(null)}
                className="p-1 rounded hover:bg-[var(--j-border-soft)] text-[var(--j-text-mute)]"
                aria-label="clear result"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {moveResult.details.length === 0 ? (
              <div className="text-[11px] text-[var(--j-text-mute)] py-2">
                Nothing to move — every memory is already in its best-fit section.
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto jarvis-scroll space-y-1">
                {moveResult.details.map((d, i) => (
                  <div
                    key={`${d.id}-${i}`}
                    className="flex items-center gap-2 p-1.5 rounded border border-[var(--j-border-soft)] bg-[var(--j-panel)]"
                  >
                    <div className="flex items-center gap-1 shrink-0">
                      <SectionBadge section={d.from as TargetSection} />
                      <span className="text-[var(--j-text-mute)] text-[10px]">→</span>
                      <SectionBadge section={d.to as TargetSection} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="jarvis-mono text-[10px] truncate text-[var(--j-text-dim)]">
                        {d.key}
                      </div>
                      <div className="text-[10px] text-[var(--j-text-mute)] truncate">
                        {d.reason} · conf {(d.confidence * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Records" value={stats.total} icon={GraduationCap} accent={JARVIS.colors.cyan} />
        <StatCard
          label="Total Earnings"
          value={`$${stats.totalEarnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={DollarSign}
          accent={JARVIS.colors.green}
        />
        <StatCard
          label="Avg Proficiency"
          value={`${stats.avgProficiency}%`}
          icon={BarChart3}
          accent={JARVIS.colors.violet}
        />
        <StatCard label="Mastered" value={stats.mastered} icon={Award} accent={JARVIS.colors.amber} />
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="jarvis-panel h-64 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="jarvis-panel p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text)]">
                Earnings by Agent
              </div>
              <DollarSign className="h-3.5 w-3.5 text-[var(--j-green)]" />
            </div>
            {earningsByAgent.length === 0 ? (
              <EmptyState icon={DollarSign} message="No earnings yet" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={earningsByAgent} margin={{ top: 5, right: 10, left: 0, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="agent" tick={{ fill: JARVIS.colors.textDim, fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fill: JARVIS.colors.textDim, fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: JARVIS.colors.panel, border: `1px solid ${JARVIS.colors.border}`, borderRadius: 6, color: JARVIS.colors.text }}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    formatter={(v: number) => [`$${v.toFixed(2)}`, 'earnings']}
                  />
                  <Bar dataKey="earnings" radius={[4, 4, 0, 0]}>
                    {earningsByAgent.map((_, i) => (
                      <Cell key={i} fill={i === 0 ? JARVIS.colors.amber : JARVIS.colors.green} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="jarvis-panel p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text)]">
                Avg Proficiency by Skill
              </div>
              <Trophy className="h-3.5 w-3.5 text-[var(--j-amber)]" />
            </div>
            {proficiencyBySkill.length === 0 ? (
              <EmptyState icon={Trophy} message="No skills tracked yet" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={proficiencyBySkill} margin={{ top: 5, right: 10, left: 0, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="skill" tick={{ fill: JARVIS.colors.textDim, fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fill: JARVIS.colors.textDim, fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{ background: JARVIS.colors.panel, border: `1px solid ${JARVIS.colors.border}`, borderRadius: 6, color: JARVIS.colors.text }}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    formatter={(v: number) => [`${v}%`, 'avg proficiency']}
                  />
                  <Bar dataKey="proficiency" radius={[4, 4, 0, 0]}>
                    {proficiencyBySkill.map((d, i) => (
                      <Cell key={i} fill={PROFICIENCY_COLOR(d.proficiency)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      <div className="jarvis-panel p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text)]">
            Learning Records
          </div>
          <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)]">{records.length}</span>
        </div>
        {records.length === 0 ? (
          <EmptyState icon={GraduationCap} message="No learning records yet — teach an agent above" />
        ) : (
          <div className="max-h-96 overflow-y-auto jarvis-scroll space-y-2">
            {records.map((r, i) => {
              const color = PROFICIENCY_COLOR(r.proficiency);
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between p-3 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]"
                  style={{ animationDelay: `${i * 20}ms` }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md shrink-0"
                      style={{ background: `${color}1a`, border: `1px solid ${color}33`, color }}>
                      <span className="jarvis-mono text-xs font-semibold">{r.proficiency}%</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="jarvis-mono text-xs text-[var(--j-cyan)]">{r.agentCodename}</span>
                        <span className="text-xs text-[var(--j-text-dim)]">→</span>
                        <span className="jarvis-mono text-xs text-[var(--j-violet)]">{r.skillKey}</span>
                      </div>
                      <div className="text-[11px] text-[var(--j-text-mute)] mt-0.5">
                        {r.learnedFrom ? `from ${r.learnedFrom}` : 'no source recorded'}
                        {r.lastUsed && ` · last used ${new Date(r.lastUsed).toLocaleDateString()}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.proficiency >= 90 && <Pill color={JARVIS.colors.green}>MASTERED</Pill>}
                    {r.earnings > 0 && (
                      <span className="jarvis-mono text-xs text-[var(--j-green)]">
                        +${r.earnings.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Learning Memories (MemoryItems stored by TeachSourceCard) */}
      <div className="jarvis-panel p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <div className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text)]">
              Learning Memories
            </div>
            <div className="text-[11px] text-[var(--j-text-dim)]">
              Ingested text / URL / video / document / audio — with auto-suggested section
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mem.loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--j-text-dim)]" />}
            <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)]">
              {memoryItems.length}
            </span>
          </div>
        </div>
        {memoryItems.length === 0 ? (
          <EmptyState icon={Brain} message="No learning memories yet — use the Teach panel above to ingest content" />
        ) : (
          <div className="max-h-96 overflow-y-auto jarvis-scroll space-y-2">
            {memoryItems.map((m, i) => {
              const isMeta = m.key.endsWith('__meta');
              if (isMeta) return null;
              const currentSection = (m.scope as TargetSection) ?? 'learning';
              const suggested = m.suggestedSection ?? autoCategorize(m.value).suggestedSection;
              const mismatches = suggested !== currentSection;
              return (
                <div
                  key={m.id}
                  className="p-3 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]"
                  style={{ animationDelay: `${i * 20}ms` }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <SectionBadge section={currentSection} />
                        {mismatches && (
                          <SectionBadge section={suggested} suggested current={currentSection} />
                        )}
                        {m.pinned && <Pill color={JARVIS.colors.amber}>PINNED</Pill>}
                      </div>
                      <div className="jarvis-mono text-[11px] text-[var(--j-text-dim)] truncate">
                        {m.key}
                      </div>
                      <div className="text-[11px] text-[var(--j-text)] mt-1 line-clamp-2">
                        {m.value.length > 240 ? m.value.slice(0, 240) + '…' : m.value}
                      </div>
                      <div className="text-[10px] text-[var(--j-text-mute)] mt-1">
                        {new Date(m.createdAt).toLocaleString()}
                        {m.reason && ` · ${m.reason}`}
                        {typeof m.confidence === 'number' &&
                          ` · conf ${(m.confidence * 100).toFixed(0)}%`}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
