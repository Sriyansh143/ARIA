"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import {
  DEAL_STAGE_META,
  DEAL_STAGES,
  type Deal,
  type DealStage,
} from "@/lib/types";
import { compact, relTime, formatTime } from "@/hooks/use-clock";
import {
  X,
  Briefcase,
  DollarSign,
  Target,
  Clock,
  TrendingUp,
  Calendar,
  User,
  CheckCircle2,
  ArrowRight,
  Trophy,
  Building2,
} from "lucide-react";

interface DealDetailDrawerProps {
  dealId: string | null;
  onClose: () => void;
}

const STAGE_ORDER = ["lead", "qualified", "proposal", "negotiation", "won"];

/**
 * DealDetailDrawer — full deal history + stage progression panel.
 *
 * Slides in from the right when a deal card is clicked. Shows: deal
 * identity header with stage badge + value, a horizontal stage-progression
 * tracker (lead → won with current stage highlighted), key facts grid
 * (value, probability, source, counterparty, expected close, owner),
 * and a synthetic activity timeline (stage transitions + linked revenue).
 *
 * Data is derived from the store's `deals` + `revenueEvents` slices.
 */
export function DealDetailDrawer({ dealId, onClose }: DealDetailDrawerProps) {
  const deals = useMissionStore((s) => s.deals);
  const revenueEvents = useMissionStore((s) => s.revenueEvents);
  const agents = useMissionStore((s) => s.agents);

  const deal = dealId ? (deals[dealId] ?? null) : null;

  const linkedRevenue = useMemo(
    () => (deal ? revenueEvents.filter((r) => r.dealId === deal.id) : []),
    [deal, revenueEvents]
  );

  const currentStageIdx = deal ? STAGE_ORDER.indexOf(deal.stage as DealStage) : -1;
  const ownerName = deal?.agentId ? agents[deal.agentId]?.name ?? "—" : "—";

  return (
    <AnimatePresence>
      {deal && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="mc-surface-elevated fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border/70 bg-card"
            role="dialog"
            aria-label={`Deal detail: ${deal.title}`}
          >
            <DealHeader deal={deal} onClose={onClose} />

            <div className="mc-scroll flex-1 overflow-y-auto p-4">
              {/* Stage progression tracker */}
              <Section title="Stage Progression" icon={TrendingUp}>
                <div className="flex items-center justify-between">
                  {STAGE_ORDER.map((stage, i) => {
                    const meta = DEAL_STAGE_META[stage as DealStage];
                    const isPast = i < currentStageIdx;
                    const isCurrent = i === currentStageIdx;
                    const isWon = deal.stage === "won";
                    const isLost = deal.stage === "lost";
                    const reached = isPast || isCurrent || isWon;
                    return (
                      <div key={stage} className="flex flex-1 flex-col items-center">
                        <div className="flex w-full items-center">
                          {i > 0 && (
                            <div
                              className={`h-0.5 flex-1 ${reached ? "bg-emerald-400" : "bg-border/40"}`}
                            />
                          )}
                          <motion.div
                            initial={{ scale: 0.8 }}
                            animate={{ scale: 1 }}
                            className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${
                              isLost
                                ? "border-rose-500/50 bg-rose-500/10"
                                : reached
                                  ? "border-emerald-500/50 bg-emerald-500/10"
                                  : "border-border/50 bg-background"
                            }`}
                          >
                            {reached && !isLost && (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                            )}
                            {isLost && <X className="h-3.5 w-3.5 text-rose-300" />}
                            {!reached && !isLost && (
                              <span className="font-mono text-[9px] text-muted-foreground">{i + 1}</span>
                            )}
                            {isCurrent && (
                              <motion.span
                                className="absolute inset-0 rounded-full border-2 border-emerald-400"
                                initial={{ opacity: 0.4 }} animate={{ opacity: [0.4, 0.8, 0.4] }}
                                transition={{ duration: 2, repeat: Infinity }}
                              />
                            )}
                          </motion.div>
                          {i < STAGE_ORDER.length - 1 && (
                            <div
                              className={`h-0.5 flex-1 ${
                                i < currentStageIdx || isWon ? "bg-emerald-400" : "bg-border/40"
                              }`}
                            />
                          )}
                        </div>
                        <span
                          className={`mt-1 font-mono text-[8px] uppercase tracking-wider ${
                            isCurrent ? "font-semibold text-emerald-300" : reached && !isLost ? "text-emerald-300/70" : "text-muted-foreground"
                          }`}
                        >
                          {meta.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {deal.stage === "lost" && (
                  <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 font-mono text-[11px] text-rose-300">
                    ⚠ This deal was lost
                  </div>
                )}
                {deal.stage === "won" && (
                  <div className="mt-3 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                    <Trophy className="h-4 w-4 text-emerald-300" />
                    <span className="font-mono text-[11px] text-emerald-300">
                      Deal closed — ${compact(deal.value)} revenue recognized
                    </span>
                  </div>
                )}
              </Section>

              {/* Key facts grid */}
              <Section title="Deal Facts" icon={Briefcase}>
                <div className="grid grid-cols-2 gap-2">
                  <FactTile icon={DollarSign} label="Value" value={`$${compact(deal.value)}`} tone="text-emerald-300" />
                  <FactTile icon={Target} label="Probability" value={`${deal.probability}%`} tone="text-violet-300" />
                  <FactTile icon={Building2} label="Counterparty" value={deal.counterparty ?? "—"} tone="text-cyan-300" />
                  <FactTile icon={User} label="Owner" value={ownerName} tone="text-amber-300" />
                  <FactTile icon={Clock} label="Created" value={relTime(deal.createdAt)} tone="text-slate-300" />
                  <FactTile
                    icon={Calendar}
                    label="Expected Close"
                    value={deal.expectedClose ? relTime(deal.expectedClose) : "—"}
                    tone="text-slate-300"
                  />
                </div>
                <div className="mt-2 rounded-md border border-border/40 bg-background/40 px-3 py-2">
                  <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Source</div>
                  <div className="mt-0.5 font-mono text-xs text-foreground">{deal.source}</div>
                </div>
              </Section>

              {/* Probability meter */}
              <Section title="Win Probability" icon={Target}>
                <div className="flex items-center gap-3">
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-border/30">
                    <motion.div
                      className={`h-full rounded-full ${
                        deal.probability >= 70 ? "bg-emerald-400" : deal.probability >= 40 ? "bg-amber-400" : "bg-rose-400"
                      }`}
                      initial={{ width: 0 }}
                      animate={{ width: `${deal.probability}%` }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                  <span
                    className={`font-mono text-lg font-bold tabular-nums ${
                      deal.probability >= 70 ? "text-emerald-300" : deal.probability >= 40 ? "text-amber-300" : "text-rose-300"
                    }`}
                  >
                    {deal.probability}%
                  </span>
                </div>
              </Section>

              {/* Activity timeline */}
              <Section title="Activity Timeline" icon={Clock}>
                <div className="relative">
                  <div className="absolute bottom-2 left-[7px] top-2 w-px bg-gradient-to-b from-cyan-500/30 via-border/40 to-transparent" />
                  <ul className="space-y-2">
                    <TimelineEntry
                      tone="text-cyan-300"
                      dot="bg-cyan-400"
                      time={deal.createdAt}
                      title="Deal created"
                      desc={`Entered pipeline as ${deal.source} → ${DEAL_STAGE_META[deal.stage as DealStage]?.label ?? deal.stage}`}
                    />
                    {currentStageIdx > 0 && (
                      <TimelineEntry
                        tone="text-amber-300"
                        dot="bg-amber-400"
                        time={deal.updatedAt}
                        title={`Advanced to ${DEAL_STAGE_META[deal.stage as DealStage]?.label ?? deal.stage}`}
                        desc={`Probability updated to ${deal.probability}%`}
                      />
                    )}
                    {deal.stage === "won" && (
                      <TimelineEntry
                        tone="text-emerald-300"
                        dot="bg-emerald-400"
                        time={deal.updatedAt}
                        title="Deal won 🎉"
                        desc={`$${compact(deal.value)} revenue recognized`}
                      />
                    )}
                    {deal.stage === "lost" && (
                      <TimelineEntry
                        tone="text-rose-300"
                        dot="bg-rose-400"
                        time={deal.updatedAt}
                        title="Deal lost"
                        desc="Marked as lost — no revenue recognized"
                      />
                    )}
                    {linkedRevenue.map((rev) => (
                      <TimelineEntry
                        key={rev.id}
                        tone="text-emerald-300"
                        dot="bg-emerald-400"
                        time={rev.createdAt}
                        title={`Revenue: +$${compact(rev.amount)}`}
                        desc={rev.description ?? undefined}
                      />
                    ))}
                  </ul>
                </div>
              </Section>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function DealHeader({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const meta = DEAL_STAGE_META[deal.stage as DealStage] ?? DEAL_STAGE_META.lead;
  return (
    <div className="relative overflow-hidden border-b border-border/60 px-4 py-4">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px mc-sweep-line opacity-60" />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
            <Briefcase className="h-5 w-5 text-emerald-300" />
          </div>
          <div>
            <h2 className="font-mono text-base font-semibold text-foreground">{deal.title}</h2>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
              <span className={`rounded border px-1.5 py-0.5 uppercase ${meta.tone} ${meta.bg} border-current/30`}>
                {meta.label}
              </span>
              <span>·</span>
              <span>${compact(deal.value)} {deal.currency}</span>
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-rose-500/40 hover:text-rose-300"
          aria-label="Close deal detail"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Briefcase;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-cyan-300" />
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function FactTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/40 p-2.5">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3 w-3 ${tone}`} />
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className={`mt-1 truncate font-mono text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function TimelineEntry({
  tone,
  dot,
  time,
  title,
  desc,
}: {
  tone: string;
  dot: string;
  time: string;
  title: string;
  desc?: string;
}) {
  return (
    <li className="relative flex gap-3 pl-0">
      <div className="relative z-10 mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className={`absolute h-3 w-3 rounded-full ${dot} opacity-20`} />
      </div>
      <div className="min-w-0 flex-1 rounded-md border border-border/40 bg-background/40 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className={`font-mono text-[11px] font-semibold ${tone}`}>{title}</span>
          <span className="shrink-0 font-mono text-[9px] text-muted-foreground">{formatTime(time)}</span>
        </div>
        {desc && <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{desc}</p>}
      </div>
    </li>
  );
}

export { DEAL_STAGES, ArrowRight };
