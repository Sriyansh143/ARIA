'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  FileSearch,
  Brain,
  Target,
  TrendingUp,
  Lightbulb,
  Scale,
  ChevronDown,
  ChevronRight,
  Send,
} from 'lucide-react';
import { useApi, postJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, Pill } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type VerificationStatus = 'unverified' | 'verified' | 'disputed' | 'partial' | 'false';
type ClaimType = 'research' | 'analysis' | 'plan' | 'fact' | 'forecast' | 'recommendation';

interface VerificationRecord {
  id: string;
  claimType: ClaimType;
  claimText: string;
  claimSource: string | null;
  evidence: string;
  verificationStatus: VerificationStatus;
  verifierMethod: string | null;
  verifierNote: string | null;
  confidenceScore: number;
  questioned: boolean;
  questionNote: string | null;
  improvedVersion: string | null;
  linkedTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  questioned: number;
  avgConfidence: number;
  trustedCount: number;
}

const STATUS_META: Record<
  VerificationStatus,
  { color: string; icon: typeof ShieldCheck; label: string }
> = {
  unverified: { color: JARVIS.colors.textMute, icon: HelpCircle, label: 'Unverified' },
  verified: { color: JARVIS.colors.green, icon: CheckCircle2, label: 'Verified' },
  disputed: { color: JARVIS.colors.amber, icon: AlertTriangle, label: 'Disputed' },
  partial: { color: JARVIS.colors.cyan, icon: ShieldQuestion, label: 'Partial' },
  false: { color: JARVIS.colors.red, icon: XCircle, label: 'False' },
};

const CLAIM_TYPE_META: Record<ClaimType, { color: string; icon: typeof Brain }> = {
  research: { color: JARVIS.colors.cyan, icon: FileSearch },
  analysis: { color: JARVIS.colors.violet, icon: Brain },
  plan: { color: JARVIS.colors.amber, icon: Target },
  fact: { color: JARVIS.colors.green, icon: CheckCircle2 },
  forecast: { color: JARVIS.colors.cyan, icon: TrendingUp },
  recommendation: { color: JARVIS.colors.red, icon: Lightbulb },
};

export default function VerificationTab() {
  const { data: statsData, refresh: refreshStats } = useApi<Stats>('/api/verifications?stats=1', 30000);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // New claim form
  const [newClaimType, setNewClaimType] = useState<ClaimType>('fact');
  const [newClaimText, setNewClaimText] = useState('');
  const [newClaimSource, setNewClaimSource] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Question form
  const [questioningId, setQuestioningId] = useState<string | null>(null);
  const [questionNote, setQuestionNote] = useState('');
  const [improvedVersion, setImprovedVersion] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: '50' });
    if (filterStatus !== 'all') params.set('status', filterStatus);
    if (filterType !== 'all') params.set('claimType', filterType);
    return `/api/verifications?${params.toString()}`;
  }, [filterStatus, filterType]);

  const { data, refresh: refreshList } = useApi<{ records: VerificationRecord[]; total: number }>(query, 15000);

  const stats = statsData ?? {
    total: 0,
    byStatus: {},
    byType: {},
    questioned: 0,
    avgConfidence: 0,
    trustedCount: 0,
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitClaim = async () => {
    if (!newClaimText.trim()) return;
    setSubmitting(true);
    try {
      const res = await postJson('/api/verifications', {
        claimType: newClaimType,
        claimText: newClaimText,
        claimSource: newClaimSource || undefined,
        crossCheck: true,
      });
      const result = res as { id: string; status: string; confidenceScore: number; verifierNote: string };
      // success
      setNewClaimText('');
      setNewClaimSource('');
      refreshList();
      refreshStats();
      // Use toast via hook
    } catch {
      // error
    } finally {
      setSubmitting(false);
    }
  };

  const submitQuestion = async (id: string) => {
    if (!questionNote.trim()) return;
    try {
      await postJson(`/api/verifications/${id}/question`, {
        questionNote,
        improvedVersion: improvedVersion || undefined,
      });
      setQuestioningId(null);
      setQuestionNote('');
      setImprovedVersion('');
      refreshList();
      refreshStats();
    } catch {
      // error
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="No-Assumption Verification"
        icon={Scale}
        accent={JARVIS.colors.cyan}
        action={<Pill color={JARVIS.colors.cyan}>{stats.total} claims logged</Pill>}
      />

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total" value={stats.total} icon={ShieldCheck} color={JARVIS.colors.cyan} />
        <StatCard label="Trusted" value={stats.trustedCount} icon={CheckCircle2} color={JARVIS.colors.green} />
        <StatCard label="Questioned" value={stats.questioned} icon={HelpCircle} color={JARVIS.colors.amber} />
        <StatCard label="Disputed" value={stats.byStatus.disputed ?? 0} icon={AlertTriangle} color={JARVIS.colors.amber} />
        <StatCard label="False" value={stats.byStatus.false ?? 0} icon={XCircle} color={JARVIS.colors.red} />
        <StatCard label="Avg Confidence" value={`${stats.avgConfidence}%`} icon={TrendingUp} color={JARVIS.colors.violet} />
      </div>

      {/* New claim form */}
      <Card className="p-4 jarvis-panel border-[var(--j-border)] bg-[var(--j-panel)]">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert className="h-4 w-4" style={{ color: JARVIS.colors.red }} />
          <h3 className="jarvis-mono text-xs uppercase tracking-widest text-[var(--j-text)]">
            Log a New Claim for Verification
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Claim Type</Label>
            <Select value={newClaimType} onValueChange={(v) => setNewClaimType(v as ClaimType)}>
              <SelectTrigger className="bg-[var(--j-panel-soft)] border-[var(--j-border)] text-[var(--j-text)] text-xs h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="research">Research</SelectItem>
                <SelectItem value="analysis">Analysis</SelectItem>
                <SelectItem value="plan">Plan</SelectItem>
                <SelectItem value="fact">Fact</SelectItem>
                <SelectItem value="forecast">Forecast</SelectItem>
                <SelectItem value="recommendation">Recommendation</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Claim Source (agent / operator)</Label>
            <Input
              value={newClaimSource}
              onChange={(e) => setNewClaimSource(e.target.value)}
              placeholder="e.g. agent:vega or operator"
              className="bg-[var(--j-panel-soft)] border-[var(--j-border)] text-[var(--j-text)] text-xs h-9"
            />
          </div>
        </div>
        <div className="space-y-1.5 mt-3">
          <Label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Claim Text</Label>
          <Textarea
            value={newClaimText}
            onChange={(e) => setNewClaimText(e.target.value)}
            placeholder="Paste the claim that needs to be verified. The system will cross-check it with an LLM fact-checker and assign a confidence score."
            className="bg-[var(--j-panel-soft)] border-[var(--j-border)] text-[var(--j-text)] min-h-[80px] text-xs"
          />
        </div>
        <div className="flex justify-end mt-3">
          <Button
            size="sm"
            onClick={submitClaim}
            disabled={submitting || !newClaimText.trim()}
            className="jarvis-btn-accent border-0"
          >
            {submitting ? 'Verifying…' : 'Verify Claim'}
          </Button>
        </div>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[160px] bg-[var(--j-panel-soft)] border-[var(--j-border)] text-[var(--j-text)] text-xs h-9">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="unverified">Unverified</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="disputed">Disputed</SelectItem>
            <SelectItem value="false">False</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[160px] bg-[var(--j-panel-soft)] border-[var(--j-border)] text-[var(--j-text)] text-xs h-9">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="research">Research</SelectItem>
            <SelectItem value="analysis">Analysis</SelectItem>
            <SelectItem value="plan">Plan</SelectItem>
            <SelectItem value="fact">Fact</SelectItem>
            <SelectItem value="forecast">Forecast</SelectItem>
            <SelectItem value="recommendation">Recommendation</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto text-[11px] text-[var(--j-text-mute)] jarvis-mono">
          {data?.total ?? 0} records
        </div>
      </div>

      {/* Records list */}
      <div className="space-y-2">
        {data?.records?.length === 0 && (
          <Card className="p-8 jarvis-panel border-[var(--j-border)] bg-[var(--j-panel)] text-center">
            <ShieldCheck className="h-8 w-8 mx-auto mb-2 text-[var(--j-text-mute)]" />
            <div className="text-sm text-[var(--j-text-dim)]">No verification records yet.</div>
            <div className="text-[11px] text-[var(--j-text-mute)] mt-1">
              Log a claim above to start the no-assumption audit trail.
            </div>
          </Card>
        )}
        {data?.records?.map((rec, idx) => {
          const sm = STATUS_META[rec.verificationStatus] ?? STATUS_META.unverified;
          const tm = CLAIM_TYPE_META[rec.claimType] ?? CLAIM_TYPE_META.fact;
          const StatusIcon = sm.icon;
          const TypeIcon = tm.icon;
          const isExpanded = expanded.has(rec.id);
          const isQuestioning = questioningId === rec.id;
          return (
            <motion.div
              key={rec.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(idx * 0.02, 0.4) }}
            >
              <Card className="p-3 jarvis-panel border-[var(--j-border)] bg-[var(--j-panel)]">
                <button
                  onClick={() => toggleExpand(rec.id)}
                  className="flex items-start gap-3 w-full text-left"
                >
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md mt-0.5"
                    style={{ background: `${sm.color}1a`, border: `1px solid ${sm.color}33`, color: sm.color }}
                  >
                    <StatusIcon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Pill color={tm.color}>
                        <TypeIcon className="h-2.5 w-2.5 inline mr-1" />
                        {rec.claimType}
                      </Pill>
                      <span className="text-[11px] text-[var(--j-text-mute)] jarvis-mono">
                        {rec.claimSource ?? 'unknown'}
                      </span>
                      {rec.questioned && (
                        <Pill color={JARVIS.colors.amber}>questioned</Pill>
                      )}
                      <span className="text-[10px] text-[var(--j-text-mute)] ml-auto jarvis-mono">
                        {rec.confidenceScore}% conf
                      </span>
                    </div>
                    <div className="text-xs text-[var(--j-text)] mt-1 line-clamp-2">
                      {rec.claimText}
                    </div>
                  </div>
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-[var(--j-text-mute)] mt-1" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-[var(--j-text-mute)] mt-1" />
                  )}
                </button>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-[var(--j-border-soft)] space-y-2">
                    {rec.verifierNote && (
                      <div>
                        <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-0.5">
                          Verifier Note ({rec.verifierMethod ?? 'none'})
                        </div>
                        <div className="text-[11px] text-[var(--j-text-dim)]">{rec.verifierNote}</div>
                      </div>
                    )}
                    {rec.evidence && rec.evidence !== '[]' && (
                      <div>
                        <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-0.5">
                          Evidence
                        </div>
                        <pre className="text-[10px] text-[var(--j-text-dim)] bg-[var(--j-panel-soft)] rounded p-2 overflow-x-auto max-h-32">
                          {rec.evidence}
                        </pre>
                      </div>
                    )}
                    {rec.questionNote && (
                      <div>
                        <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-0.5">
                          Question
                        </div>
                        <div className="text-[11px] text-[var(--j-text-dim)] italic">
                          {rec.questionNote}
                        </div>
                      </div>
                    )}
                    {rec.improvedVersion && (
                      <div>
                        <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] mb-0.5">
                          Improved Version
                        </div>
                        <div className="text-[11px] text-[var(--j-green)]">
                          {rec.improvedVersion}
                        </div>
                      </div>
                    )}

                    {!isQuestioning ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setQuestioningId(rec.id);
                          setQuestionNote('');
                          setImprovedVersion('');
                        }}
                        className="border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)] h-7 text-[11px]"
                      >
                        <HelpCircle className="h-3 w-3 mr-1" /> Question this claim
                      </Button>
                    ) : (
                      <div className="space-y-2 p-2 bg-[var(--j-panel-soft)] rounded border border-[var(--j-border)]">
                        <Textarea
                          value={questionNote}
                          onChange={(e) => setQuestionNote(e.target.value)}
                          placeholder="What is wrong or questionable about this claim?"
                          className="bg-[var(--j-panel)] border-[var(--j-border)] text-[var(--j-text)] min-h-[60px] text-xs"
                        />
                        <Textarea
                          value={improvedVersion}
                          onChange={(e) => setImprovedVersion(e.target.value)}
                          placeholder="Improved version (optional)"
                          className="bg-[var(--j-panel)] border-[var(--j-border)] text-[var(--j-text)] min-h-[60px] text-xs"
                        />
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setQuestioningId(null)}
                            className="text-[var(--j-text-mute)] h-7 text-[11px]"
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => submitQuestion(rec.id)}
                            disabled={!questionNote.trim()}
                            className="jarvis-btn-accent border-0 h-7 text-[11px]"
                          >
                            <Send className="h-3 w-3 mr-1" /> Submit Question
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: typeof ShieldCheck;
  color: string;
}) {
  return (
    <Card className="p-3 jarvis-panel border-[var(--j-border)] bg-[var(--j-panel)]">
      <div className="flex items-center justify-between mb-1">
        <div
          className="flex h-6 w-6 items-center justify-center rounded"
          style={{ background: `${color}1a`, border: `1px solid ${color}33`, color }}
        >
          <Icon className="h-3 w-3" />
        </div>
      </div>
      <div className="text-lg font-bold text-[var(--j-text)]">{value}</div>
      <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{label}</div>
    </Card>
  );
}
