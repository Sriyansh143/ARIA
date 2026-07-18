'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import * as Lucide from 'lucide-react';
import { Briefcase, CheckCircle2, Sparkles, Building2 } from 'lucide-react';
import { useApi } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, EmptyState, Pill } from '@/components/jarvis/shared';

interface Service {
  name: string;
  description: string;
  icon: string;
  price: string;
  category: 'existing' | 'ai';
  featured?: boolean;
}
interface Company {
  companyName: string;
  ownerName: string;
  websiteUrl: string;
  watermarkText: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  gstNumber: string | null;
}

function iconFor(name: string): Lucide.LucideIcon {
  const Icon = (Lucide as unknown as Record<string, Lucide.LucideIcon>)[name];
  if (Icon) return Icon;
  return Sparkles;
}

export default function ServicesHubTab() {
  const [filter, setFilter] = useState<'all' | 'existing' | 'ai'>('all');
  const { data, loading } = useApi<{ company: Company; services: Service[]; count: number }>('/api/services', -1);
  const company = data?.company;
  const services = (data?.services ?? []).filter((s) => filter === 'all' || s.category === filter);

  const aiCount = (data?.services ?? []).filter((s) => s.category === 'ai').length;
  const existingCount = (data?.services ?? []).filter((s) => s.category === 'existing').length;

  return (
    <div className="space-y-4">
      <SectionTitle
        title={company ? `${company.companyName} · Services Hub` : 'Services Hub'}
        icon={Briefcase}
        accent={JARVIS.colors.amber}
        action={
          company && (
            <a
              href={company.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="jarvis-mono text-[10px] uppercase px-3 py-1.5 rounded-md border border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-cyan)] hover:border-[var(--j-cyan)]/40 transition-colors"
            >
              {company.websiteUrl.replace(/^https?:\/\//, '')}
            </a>
          )
        }
      />

      {company && (
        <div className="jarvis-panel p-4">
          <div className="flex items-start gap-4">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl shrink-0"
              style={{ background: `${JARVIS.colors.amber}1a`, border: `1px solid ${JARVIS.colors.amber}33`, color: JARVIS.colors.amber }}
            >
              <Building2 className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold text-[var(--j-text)]">{company.companyName}</div>
              <div className="text-xs text-[var(--j-text-dim)] mt-0.5">
                Owner: <span className="text-[var(--j-cyan)]">{company.ownerName}</span>
                {company.email && <> · {company.email}</>}
                {company.phone && <> · {company.phone}</>}
              </div>
              {company.address && <div className="text-xs text-[var(--j-text-mute)] mt-0.5">{company.address}</div>}
              {company.gstNumber && <div className="jarvis-mono text-[10px] text-[var(--j-text-mute)] mt-1">GST: {company.gstNumber}</div>}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Services" value={data?.count ?? 0} icon={Briefcase} accent={JARVIS.colors.amber} />
        <StatCard label="AI-Powered" value={aiCount} icon={Sparkles} accent={JARVIS.colors.cyan} />
        <StatCard label="Existing" value={existingCount} icon={CheckCircle2} accent={JARVIS.colors.green} />
        <StatCard
          label="Featured"
          value={(data?.services ?? []).filter((s) => s.featured).length}
          icon={Sparkles}
          accent={JARVIS.colors.violet}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {(['all', 'ai', 'existing'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`jarvis-mono text-[10px] uppercase px-3 py-1.5 rounded-md border transition-colors ${filter === f ? 'jarvis-btn-accent border-0' : 'border-[var(--j-border)] text-[var(--j-text-dim)] hover:text-[var(--j-text)]'}`}
          >
            {f === 'all' ? 'All Services' : f === 'ai' ? 'AI Services' : 'Existing Services'}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="jarvis-panel h-44 animate-pulse" />)}
        </div>
      ) : services.length === 0 ? (
        <EmptyState icon={Briefcase} message="No services available" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((s, i) => {
            const Icon = iconFor(s.icon);
            const accent = s.category === 'ai' ? JARVIS.colors.cyan : JARVIS.colors.amber;
            return (
              <motion.div
                key={s.name}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className={`jarvis-panel jarvis-card-hover p-5 relative overflow-hidden ${s.featured ? 'border-[var(--j-violet)]/30' : ''}`}
              >
                {s.featured && (
                  <div className="absolute top-0 right-0">
                    <div
                      className="jarvis-mono text-[9px] uppercase px-2 py-1 rounded-bl-md"
                      style={{ color: JARVIS.colors.violet, background: `${JARVIS.colors.violet}1a`, border: `1px solid ${JARVIS.colors.violet}33`, borderRight: 0, borderTop: 0 }}
                    >
                      ★ Featured
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-3 mb-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0"
                    style={{ background: `${accent}1a`, border: `1px solid ${accent}33`, color: accent }}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[var(--j-text)] leading-tight">{s.name}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <Pill color={accent}>{s.category === 'ai' ? 'AI' : 'EXISTING'}</Pill>
                      <span className="jarvis-mono text-xs font-semibold" style={{ color: JARVIS.colors.green }}>{s.price}</span>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-[var(--j-text-dim)] leading-relaxed">{s.description}</p>
                <div className="absolute bottom-0 left-0 h-[2px]" style={{ width: '40%', background: `linear-gradient(90deg, ${accent}, transparent)` }} />
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
