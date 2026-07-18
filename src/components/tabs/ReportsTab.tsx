'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, Download, Loader2, FileSpreadsheet, Brain, Sparkles, RefreshCw, CheckCircle2, GitCompare, X, History,
} from 'lucide-react';
import { useApi, postJson } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, Pill } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import ReactMarkdown from 'react-markdown';

interface ReportData {
  report: string;
  summary: {
    timestamp: string;
    fleet: { agents: number; working: number; idle: number; avgLoad: number; avgSuccess: number };
    tasks: { total: number; completed: number; inProgress: number; pending: number; failed: number; completionRate: number };
    revenue: number;
    activity: { logs: number; errors: number; comms: number; skillRuns: number; memory: number };
  };
  generatedAt: string;
}

const EXPORTS = [
  { type: 'tasks', label: 'Tasks', icon: FileText, color: JARVIS.colors.amber, desc: 'All tasks with status, priority, assignee' },
  { type: 'payments', label: 'Payments', icon: FileSpreadsheet, color: JARVIS.colors.green, desc: 'Confirmed + pending transactions' },
  { type: 'comms', label: 'Comms', icon: FileText, color: JARVIS.colors.violet, desc: 'Agent messages with threads' },
  { type: 'logs', label: 'Logs', icon: FileText, color: JARVIS.colors.cyan, desc: 'Recent 500 agent log entries' },
  { type: 'agents', label: 'Agents', icon: FileText, color: JARVIS.colors.cyan, desc: 'Agent roster with load + success' },
  { type: 'memory', label: 'Memory', icon: FileText, color: JARVIS.colors.violet, desc: 'All memory items with tags' },
];

export default function ReportsTab() {
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState<ReportData | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const { data: reportsList } = useApi<{ reports: Array<{ id: string; key: string; preview: string; updatedAt: string }> }>('/api/reports/diff', 0);
  const { data: diffHistory, refresh: refreshDiffHistory } = useApi<{ diffs: Array<{ id: string; reportAKey: string; reportBKey: string; diff: string; createdAt: string }> }>('/api/reports/diffs', 15000);

  const downloadCSV = (type: string) => {
    window.open(`/api/export/${type}`, '_blank');
    toast({ title: `Exporting ${type}.csv…` });
  };

  const generateReport = async () => {
    setGenerating(true);
    setReport(null);
    try {
      const res = await fetch('/api/reports/daily', { cache: 'no-store' });
      const json = await res.json();
      setReport(json);
      toast({ title: 'Daily report generated', description: 'Fleet report ready' });
    } catch (e) {
      toast({ title: 'Report failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle title="Export & Reporting" icon={FileText} accent={JARVIS.colors.green} action={<Pill color={JARVIS.colors.violet}>AI Engine</Pill>} />

      {/* Daily report generator */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="jarvis-panel jarvis-scan p-5">
        <div className="flex items-start gap-4 mb-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl jarvis-btn-accent shrink-0">
            <Brain className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="jarvis-mono text-sm uppercase text-[var(--j-cyan)] tracking-widest mb-1">Daily Fleet Report</h3>
            <p className="text-sm text-[var(--j-text-dim)]">The AI engine generates a narrative operations report from live fleet state — executive summary, key metrics, priority tasks, issues, and recommendations.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.open('/api/reports/pdf?print=1', '_blank');
                toast({ title: 'Opening PDF report…', description: 'Use the print dialog to save as PDF' });
              }}
              className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)] text-[var(--j-cyan)]"
              title="Open a print-friendly PDF report in a new tab"
            >
              <FileText className="h-3.5 w-3.5 mr-1.5" /> PDF Report
            </Button>
            <Button onClick={generateReport} disabled={generating} className="jarvis-btn-accent border-0">
              {generating ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Generating…</> : <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Generate</>}
            </Button>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {generating && (
            <motion.div key="gen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin mb-3 text-[var(--j-cyan)]" />
              <div className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">AI engine analyzing fleet state…</div>
            </motion.div>
          )}
          {report && !generating && (
            <motion.div key="report" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {/* Quick stats */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
                <ReportStat label="Agents" value={`${report.summary.fleet.working}/${report.summary.fleet.agents}`} sub="working" color={JARVIS.colors.cyan} />
                <ReportStat label="Tasks" value={`${report.summary.tasks.completionRate}%`} sub={`${report.summary.tasks.completed}/${report.summary.tasks.total} done`} color={JARVIS.colors.green} />
                <ReportStat label="Revenue" value={`₹${report.summary.revenue.toLocaleString()}`} sub="confirmed" color={JARVIS.colors.amber} />
                <ReportStat label="Comms" value={report.summary.activity.comms} sub="messages" color={JARVIS.colors.violet} />
                <ReportStat label="Errors" value={report.summary.activity.errors} sub="log errors" color={report.summary.activity.errors > 0 ? JARVIS.colors.red : JARVIS.colors.green} />
              </div>
              {/* Markdown report */}
              <div className="p-4 rounded-lg border border-[var(--j-border)] bg-[var(--j-bg-soft)] max-h-[400px] overflow-y-auto jarvis-scroll">
                <div className="prose-chat text-sm">
                  <ReactMarkdown>{report.report}</ReactMarkdown>
                </div>
              </div>
              <div className="flex items-center justify-between mt-3">
                <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-[var(--j-green)]" /> generated {new Date(report.generatedAt).toLocaleString()}
                </span>
                <button onClick={generateReport} disabled={generating} className="jarvis-mono text-[9px] uppercase text-[var(--j-cyan)] hover:underline flex items-center gap-1">
                  <RefreshCw className="h-3 w-3" /> regenerate
                </button>
              </div>
            </motion.div>
          )}
          {!report && !generating && (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-8">
              <div className="text-sm text-[var(--j-text-mute)]">No report generated yet</div>
              <div className="jarvis-mono text-[10px] text-[var(--j-text-mute)] mt-1">click "Generate" to create a fleet report</div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* CSV exports */}
      <div className="jarvis-panel p-4">
        <SectionTitle title="CSV Exports" icon={Download} accent={JARVIS.colors.amber} action={<span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">download as .csv</span>} />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {EXPORTS.map((e, i) => {
            const Icon = e.icon;
            return (
              <motion.button
                key={e.type}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => downloadCSV(e.type)}
                className="group p-4 rounded-lg border border-[var(--j-border)] bg-[var(--j-panel-soft)]/40 hover:border-[var(--j-cyan)]/50 transition-all text-left"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0" style={{ background: `${e.color}1a`, border: `1px solid ${e.color}33`, color: e.color }}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--j-text)]">{e.label}</div>
                    <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{e.type}.csv</div>
                  </div>
                  <Download className="h-4 w-4 text-[var(--j-text-mute)] group-hover:text-[var(--j-cyan)] transition-colors" />
                </div>
                <p className="text-[11px] text-[var(--j-text-dim)]">{e.desc}</p>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Report diffing */}
      <div className="jarvis-panel p-4">
        <SectionTitle title="Report Diffing" icon={GitCompare} accent={JARVIS.colors.violet} action={
          <Button size="sm" variant="outline" onClick={() => setDiffOpen(true)} disabled={!reportsList || reportsList.reports.length < 2} className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)] disabled:opacity-40">
            <GitCompare className="h-3.5 w-3.5 mr-1" /> Compare Reports
          </Button>
        } />
        <p className="text-xs text-[var(--j-text-dim)]">Compare 2 stored fleet reports — the AI engine analyzes what changed, improved, regressed, and gives a net assessment. Requires ≥2 generated reports.</p>
        {reportsList && reportsList.reports.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {reportsList.reports.slice(0, 6).map((r) => (
              <span key={r.id} className="jarvis-mono text-[9px] px-2 py-1 rounded bg-[var(--j-panel-soft)] text-[var(--j-text-dim)] border border-[var(--j-border-soft)] truncate max-w-[200px]">
                {r.key.slice(0, 30)}
              </span>
            ))}
            <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] self-center">{reportsList.reports.length} stored</span>
          </div>
        )}
      </div>

      {/* Diff history */}
      {diffHistory && diffHistory.diffs.length > 0 && (
        <div className="jarvis-panel p-4">
          <SectionTitle title="Diff History" icon={History} accent={JARVIS.colors.amber} action={
            <button onClick={async () => { await fetch('/api/reports/diffs', { method: 'DELETE' }); toast({ title: 'Diff history cleared' }); refreshDiffHistory(); }} className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)] hover:text-[var(--j-red)]">clear all</button>
          } />
          <div className="space-y-1.5 max-h-60 overflow-y-auto jarvis-scroll">
            {diffHistory.diffs.map((d, i) => (
              <details key={d.id} className="rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]/40 overflow-hidden">
                <summary className="flex items-center gap-2 p-2.5 cursor-pointer hover:bg-[var(--j-panel-soft)]/60 text-xs">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--j-amber)] shrink-0" />
                  <span className="text-[var(--j-text-dim)] truncate flex-1">{d.reportAKey.slice(0, 24)} ↔ {d.reportBKey.slice(0, 24)}</span>
                  <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)] shrink-0">{new Date(d.createdAt).toLocaleString()}</span>
                </summary>
                <div className="border-t border-[var(--j-border-soft)] px-3 py-2.5 max-h-48 overflow-y-auto jarvis-scroll">
                  <div className="prose-chat text-xs">
                    <ReactMarkdown>{d.diff}</ReactMarkdown>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {diffOpen && <ReportDiffModal reports={reportsList?.reports ?? []} onClose={() => setDiffOpen(false)} onGenerated={() => refreshDiffHistory()} />}
      </AnimatePresence>
    </div>
  );
}

function ReportStat({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="p-2.5 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-panel-soft)]/40 text-center">
      <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{label}</div>
      <div className="text-base font-semibold" style={{ color }}>{value}</div>
      <div className="jarvis-mono text-[8px] text-[var(--j-text-mute)]">{sub}</div>
    </div>
  );
}

function ReportDiffModal({ reports, onClose, onGenerated }: { reports: Array<{ id: string; key: string; preview: string; updatedAt: string }>; onClose: () => void; onGenerated?: () => void }) {
  const { toast } = useToast();
  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!aId || !bId || aId === bId) { toast({ title: 'Select 2 different reports', variant: 'destructive' }); return; }
    setLoading(true);
    setDiff(null);
    try {
      const res = await fetch(`/api/reports/diff?a=${aId}&b=${bId}`, { cache: 'no-store' });
      const json = await res.json();
      setDiff(json.diff);
      onGenerated?.();
    } catch (e) {
      toast({ title: 'Diff failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }} className="relative w-full max-w-2xl jarvis-panel p-5 max-h-[85vh] overflow-y-auto jarvis-scroll">
        <div className="flex items-center justify-between mb-4">
          <h3 className="jarvis-mono text-sm uppercase text-[var(--j-violet)]">Compare Reports</h3>
          <button onClick={onClose} className="text-[var(--j-text-mute)] hover:text-[var(--j-text)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Report A</label>
              <select value={aId} onChange={(e) => setAId(e.target.value)} className="w-full jarvis-mono text-xs px-2.5 py-2 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text)] outline-none focus:border-[var(--j-violet)]">
                <option value="">select…</option>
                {reports.map((r) => <option key={r.id} value={r.id}>{r.key.slice(0, 40)}</option>)}
              </select>
            </div>
            <div>
              <label className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)]">Report B</label>
              <select value={bId} onChange={(e) => setBId(e.target.value)} className="w-full jarvis-mono text-xs px-2.5 py-2 rounded-md border border-[var(--j-border)] bg-[var(--j-panel-soft)] text-[var(--j-text)] outline-none focus:border-[var(--j-violet)]">
                <option value="">select…</option>
                {reports.map((r) => <option key={r.id} value={r.id}>{r.key.slice(0, 40)}</option>)}
              </select>
            </div>
          </div>
          <Button onClick={run} disabled={loading || !aId || !bId} className="w-full jarvis-btn-accent border-0">
            {loading ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> AI diffing…</> : <><GitCompare className="h-3.5 w-3.5 mr-1.5" /> Generate Diff</>}
          </Button>
          {diff && (
            <div className="p-4 rounded-lg border border-[var(--j-border)] bg-[var(--j-bg-soft)] max-h-80 overflow-y-auto jarvis-scroll">
              <div className="prose-chat text-sm">
                <ReactMarkdown>{diff}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
