'use client';

import { motion } from 'framer-motion';
import { FolderArchive, FileText, Code2, Database, Image, FileBarChart } from 'lucide-react';
import { useApi } from '@/lib/hooks/use-api';
import { JARVIS, timeAgo } from '@/lib/config';
import { SectionTitle, StatCard, EmptyState, Pill } from '@/components/jarvis/shared';

interface Artifact {
  id: string; name: string; type: string; size: number; meta: string; createdAt: string;
}

const TYPE_META: Record<string, { icon: typeof FileText; color: string }> = {
  file: { icon: FileText, color: JARVIS.colors.cyan },
  report: { icon: FileBarChart, color: JARVIS.colors.green },
  image: { icon: Image, color: JARVIS.colors.violet },
  code: { icon: Code2, color: JARVIS.colors.amber },
  dataset: { icon: Database, color: JARVIS.colors.cyan },
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ArtifactsTab() {
  const { data, loading } = useApi<{ artifacts: Artifact[] }>('/api/artifacts', 15000);
  const artifacts = data?.artifacts ?? [];

  return (
    <div className="space-y-4">
      <SectionTitle title="Artifacts" icon={FolderArchive} accent={JARVIS.colors.amber} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total" value={artifacts.length} icon={FolderArchive} accent={JARVIS.colors.cyan} />
        <StatCard label="Code" value={artifacts.filter((a) => a.type === 'code').length} icon={Code2} accent={JARVIS.colors.amber} />
        <StatCard label="Reports" value={artifacts.filter((a) => a.type === 'report').length} icon={FileBarChart} accent={JARVIS.colors.green} />
        <StatCard label="Datasets" value={artifacts.filter((a) => a.type === 'dataset').length} icon={Database} accent={JARVIS.colors.violet} />
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="jarvis-panel h-24 animate-pulse" />)}</div>
      ) : artifacts.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {artifacts.map((a, i) => {
            const meta = TYPE_META[a.type] ?? TYPE_META.file;
            const Icon = meta.icon;
            return (
              <motion.div key={a.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }} className="jarvis-panel jarvis-card-hover p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0" style={{ background: `${meta.color}1a`, border: `1px solid ${meta.color}33`, color: meta.color }}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-[var(--j-text)] truncate">{a.name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <Pill color={meta.color}>{a.type}</Pill>
                      <span className="jarvis-mono text-[10px] text-[var(--j-text-mute)]">{fmtSize(a.size)}</span>
                    </div>
                    <div className="jarvis-mono text-[9px] text-[var(--j-text-mute)] mt-1.5">{timeAgo(a.createdAt)}</div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={FolderArchive} message="No artifacts stored" />
      )}
    </div>
  );
}
