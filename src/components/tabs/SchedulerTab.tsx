'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarClock, Play, Power, Clock, CheckCircle2, FileText, Loader2, Sparkles } from 'lucide-react';
import { useApi, postJson, patchJson } from '@/lib/hooks/use-api';
import { JARVIS, timeAgo } from '@/lib/config';
import { SectionTitle, StatCard, Pill, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';

interface Cron {
  id: string; key: string; name: string; schedule: string; description?: string;
  enabled: boolean; lastRun: string | null; runCount: number;
}

export default function SchedulerTab() {
  const { data, loading, refresh } = useApi<{ jobs: Cron[] }>('/api/cron', 15000);
  const { toast } = useToast();
  const jobs = data?.jobs ?? [];
  const [reportRunning, setReportRunning] = useState(false);
  const [reportResult, setReportResult] = useState<string | null>(null);

  const toggle = async (j: Cron) => {
    await patchJson(`/api/cron/${j.id}`, { enabled: !j.enabled });
    toast({ title: `${j.name} ${j.enabled ? 'disabled' : 'enabled'}` });
    refresh();
  };
  const run = async (j: Cron) => {
    await postJson(`/api/cron/${j.id}/run`, {});
    toast({ title: `${j.name} executed`, description: `${j.runCount + 1} runs` });
    refresh();
  };

  const generateScheduledReport = async () => {
    setReportRunning(true);
    setReportResult(null);
    try {
      const res = await fetch('/api/reports/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'scheduled' }) });
      const json = await res.json();
      setReportResult(json.report);
      toast({ title: 'Scheduled report generated', description: 'Stored to memory + notification sent' });
    } catch (e) {
      toast({ title: 'Report failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setReportRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle title="Cron Scheduler" icon={CalendarClock} accent={JARVIS.colors.violet} />

      {/* Autopilot banner */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="jarvis-panel jarvis-scan p-4 flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg jarvis-btn-accent">
          <Power className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="jarvis-mono text-sm text-[var(--j-cyan)]">AUTOPILOT ACTIVE</span>
            <Pill color={JARVIS.colors.green}>every 15 min</Pill>
          </div>
          <p className="text-xs text-[var(--j-text-dim)] mt-0.5">The webDevReview cron autonomously QA's this dashboard, fixes bugs, and ships improvements.</p>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Jobs" value={jobs.length} icon={CalendarClock} accent={JARVIS.colors.violet} />
        <StatCard label="Enabled" value={jobs.filter((j) => j.enabled).length} icon={CheckCircle2} accent={JARVIS.colors.green} />
        <StatCard label="Total Runs" value={jobs.reduce((a, j) => a + j.runCount, 0)} icon={Play} accent={JARVIS.colors.cyan} />
        <StatCard label="Schedules" value={new Set(jobs.map((j) => j.schedule)).size} icon={Clock} accent={JARVIS.colors.amber} />
      </div>

      {loading && !data ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="jarvis-panel h-20 animate-pulse" />)}</div>
      ) : jobs.length ? (
        <div className="space-y-2">
          {jobs.map((j, i) => (
            <motion.div
              key={j.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              className={`jarvis-panel jarvis-card-hover p-4 flex items-center gap-4 ${j.enabled ? '' : 'opacity-60'}`}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0" style={{ background: `${JARVIS.colors.violet}1a`, border: `1px solid ${JARVIS.colors.violet}33`, color: JARVIS.colors.violet }}>
                <CalendarClock className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-[var(--j-text)]">{j.name}</span>
                  <span className="jarvis-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--j-panel-soft)] text-[var(--j-cyan)] border border-[var(--j-border)]">{j.schedule}</span>
                  <span className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">{j.runCount} runs</span>
                </div>
                {j.description && <p className="text-xs text-[var(--j-text-dim)] mt-0.5">{j.description}</p>}
                <div className="jarvis-mono text-[10px] text-[var(--j-text-mute)] mt-1">
                  last: {j.lastRun ? timeAgo(j.lastRun) : 'never'} · key: {j.key}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button onClick={() => run(j)} disabled={!j.enabled} className="jarvis-mono text-[9px] uppercase px-2.5 py-1.5 rounded flex items-center gap-1 jarvis-btn-accent border-0 disabled:opacity-40">
                  <Play className="h-3 w-3" /> run
                </button>
                <Switch checked={j.enabled} onCheckedChange={() => toggle(j)} />
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <EmptyState icon={CalendarClock} message="No cron jobs registered" />
      )}

      {/* Scheduled report generator */}
      <div className="jarvis-panel p-4">
        <SectionTitle title="Scheduled Report" icon={FileText} accent={JARVIS.colors.green} action={
          <Button size="sm" onClick={generateScheduledReport} disabled={reportRunning} className="jarvis-btn-accent border-0">
            {reportRunning ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Generating…</> : <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Generate Now</>}
          </Button>
        } />
        <p className="text-xs text-[var(--j-text-dim)] mb-3">Trigger a fleet report on demand. The report is stored to episodic memory + a notification is created. (Wire this to a cron job for automatic daily generation.)</p>
        {reportResult && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-3 rounded-md border border-[var(--j-border-soft)] bg-[var(--j-bg-soft)] max-h-48 overflow-y-auto jarvis-scroll">
            <pre className="text-[11px] text-[var(--j-text-dim)] whitespace-pre-wrap font-mono">{reportResult.slice(0, 2000)}</pre>
          </motion.div>
        )}
      </div>
    </div>
  );
}
