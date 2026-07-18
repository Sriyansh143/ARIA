'use client';

import { motion } from 'framer-motion';
import { Network, Zap, Cpu, CheckCircle2 } from 'lucide-react';
import { useApi } from '@/lib/hooks/use-api';
import { JARVIS } from '@/lib/config';
import { SectionTitle, StatCard, Pill } from '@/components/jarvis/shared';

interface Provider {
  id: string; key: string; name: string; model: string; enabled: boolean;
  latency: number; tokens: number;
}

export default function ProvidersTab() {
  const { data, loading } = useApi<{ providers: Provider[] }>('/api/providers', 15000);
  const providers = data?.providers ?? [];

  return (
    <div className="space-y-4">
      <SectionTitle title="Model Providers" icon={Network} accent={JARVIS.colors.green} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Providers" value={providers.length} icon={Network} accent={JARVIS.colors.cyan} />
        <StatCard label="Active" value={providers.filter((p) => p.enabled).length} icon={CheckCircle2} accent={JARVIS.colors.green} />
        <StatCard label="Total Tokens" value={providers.reduce((a, p) => a + p.tokens, 0).toLocaleString()} icon={Zap} accent={JARVIS.colors.amber} />
        <StatCard label="Avg Latency" value={`${Math.round(providers.reduce((a, p) => a + p.latency, 0) / (providers.length || 1))}ms`} icon={Cpu} accent={JARVIS.colors.violet} />
      </div>

      {loading && !data ? (
        <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="jarvis-panel h-28 animate-pulse" />)}</div>
      ) : providers.length ? (
        <div className="space-y-3">
          {providers.map((p, i) => (
            <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="jarvis-panel jarvis-card-hover p-5">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl jarvis-btn-accent">
                    <Network className="h-6 w-6" />
                  </div>
                  {p.enabled && <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[var(--j-green)] jarvis-blink" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold text-[var(--j-text)]">{p.name}</span>
                    <Pill color={p.enabled ? JARVIS.colors.green : JARVIS.colors.textMute}>{p.enabled ? 'ACTIVE' : 'INACTIVE'}</Pill>
                  </div>
                  <div className="jarvis-mono text-xs text-[var(--j-cyan)] mt-0.5">{p.model}</div>
                </div>
                <div className="grid grid-cols-2 gap-6 text-right">
                  <div>
                    <div className="text-lg font-semibold" style={{ color: JARVIS.colors.amber }}>{p.latency}ms</div>
                    <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">latency</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold" style={{ color: JARVIS.colors.cyan }}>{p.tokens.toLocaleString()}</div>
                    <div className="jarvis-mono text-[9px] uppercase text-[var(--j-text-mute)]">tokens</div>
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-1">
                {[20, 45, 30, 60, 40, 75, 55, 90].map((v, idx) => (
                  <div key={idx} className="h-1 rounded-full" style={{ width: `${v}%`, background: `linear-gradient(90deg, ${JARVIS.colors.cyan}, transparent)` }} />
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="jarvis-panel p-8 text-center text-sm text-[var(--j-text-mute)]">No providers configured</div>
      )}
    </div>
  );
}
