"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import { AGENT_STATUS_META, AGENT_TIERS, type Agent, type AgentStatus } from "@/lib/types";
import { compact, relTime } from "@/hooks/use-clock";
import {
  ChevronDown,
  Cpu,
  Crown,
  Wrench,
  FlaskConical,
  ServerCog,
  Wallet,
  TrendingUp,
  Headphones,
  Maximize2,
  Network,
  ShieldCheck,
  Search,
  BarChart3,
  Calculator,
  CreditCard,
  UserCheck,
  Users,
  Megaphone,
  Mail,
  Phone,
  MessageCircle,
  Languages,
  Scale,
  Sparkles,
  Clapperboard,
  PenLine,
  Target,
  Briefcase,
  HeartHandshake,
  Compass,
} from "lucide-react";

const ROLE_ICON: Record<string, typeof Cpu> = {
  // Executive
  CEO: Crown,
  COO: Network,
  CFO: Calculator,
  // Engineering
  CTO: Wrench,
  Engineering: Cpu,
  DevOps: ServerCog,
  QA: ShieldCheck,
  Architect: Compass,
  // Research
  Research: FlaskConical,
  DataAnalyst: Search,
  DataScientist: BarChart3,
  // Operations
  Ops: ServerCog,
  ProjectManager: Briefcase,
  Compliance: ShieldCheck,
  // Finance
  Finance: Wallet,
  Accountant: Calculator,
  PaymentsProcessor: CreditCard,
  // Sales
  Sales: TrendingUp,
  SalesDevelopment: Target,
  AccountExecutive: Briefcase,
  CRM: Users,
  // Support
  Support: Headphones,
  SuccessManager: HeartHandshake,
  // Marketing
  Marketer: Megaphone,
  SocialMedia: MessageCircle,
  ContentCreator: PenLine,
  AdCreative: Clapperboard,
  // Legal
  LegalAnalyst: Scale,
  // Ethics
  Ethicist: Sparkles,
  // Communications
  CommsAgent: Megaphone,
  EmailWorker: Mail,
  VoiceAgent: Phone,
  // Community
  CommunityManager: Users,
  // Linguist
  Linguist: Languages,
  // Clients
  ClientOnboarding: UserCheck,
  ClientSuccess: HeartHandshake,
  // Conductor (routing hub)
  Conductor: Network,
};

/**
 * AgentRoster — the fleet grid.
 *
 * Each card is a collapsible agent telemetry unit. The status dot breathes
 * (CSS keyframe) when the agent is active, and the whole card carries a
 * soft neon glow keyed off the agent's lifecycle state.
 */
export function AgentRoster({ onOpenAgent }: { onOpenAgent?: (agentId: string) => void }) {
  const agents = useMissionStore((s) => s.agents);
  const list = Object.values(agents).sort((a, b) => a.name.localeCompare(b.name));

  const activeCount = list.filter((a) => a.status !== "idle" && a.status !== "offline").length;

  return (
    <section className="mc-surface flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            Agent Fleet
          </h2>
          <span className="rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {activeCount}/{list.length} ACTIVE
          </span>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <StatusLegend />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2.5 p-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.length === 0 ? (
          <SkeletonCard />
        ) : (
          list.map((agent) => <AgentCard key={agent.id} agent={agent} onOpenAgent={onOpenAgent} />)
        )}
      </div>
    </section>
  );
}

function AgentCard({ agent, onOpenAgent }: { agent: Agent; onOpenAgent?: (agentId: string) => void }) {
  const [open, setOpen] = useState(false);
  const meta = AGENT_STATUS_META[agent.status as AgentStatus] ?? AGENT_STATUS_META.idle;
  const RoleIcon = ROLE_ICON[agent.role] ?? Cpu;
  const isActive = agent.status !== "idle" && agent.status !== "offline";
  const tierTone =
    agent.tier === "strong" ? "text-cyan-300" : agent.tier === "fast" ? "text-emerald-300" : "text-slate-300";

  return (
    <motion.div
      layout
      className={`group relative overflow-hidden rounded-lg border bg-card/70 transition-colors ${
        isActive ? `border-border ${meta.glow}` : "border-border/60"
      }`}
    >
      {/* Top scan line when active */}
      {isActive && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px mc-sweep-line opacity-70" />
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          {isActive && (
            <span
              className={`absolute inline-flex h-full w-full rounded-full opacity-60 mc-anim-breathe ${meta.dot}`}
            />
          )}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${meta.dot}`} />
        </span>
        <RoleIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-sm font-medium text-foreground">{agent.name}</span>
            <span className={`font-mono text-[10px] uppercase ${tierTone}`}>{agent.tier}</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <span className="uppercase tracking-wider">{agent.role}</span>
            <span className="text-border">·</span>
            <span className="truncate">{agent.model ?? "—"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`font-mono text-[10px] font-semibold uppercase tracking-wider ${meta.tone}`}>
            {meta.label}
          </span>
          {onOpenAgent && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onOpenAgent(agent.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenAgent(agent.id);
                }
              }}
              className="flex h-5 w-5 items-center justify-center rounded border border-border/50 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              title="Inspect agent"
              aria-label={`Inspect ${agent.name}`}
            >
              <Maximize2 className="h-3 w-3" />
            </span>
          )}
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.18 }}>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </motion.span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-border/50"
          >
            <div className="grid grid-cols-3 gap-px bg-border/40">
              <Stat label="Tokens" value={compact(agent.tokensUsed)} />
              <Stat label="Tasks Done" value={String(agent.tasksDone)} />
              <Stat label="Errors" value={String(agent.errorCount)} tone={agent.errorCount > 0 ? "text-rose-300" : undefined} />
            </div>
            <div className="space-y-2 px-3 py-2.5">
              {agent.currentTask && (
                <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                  <span className="text-amber-300">▸</span>
                  <span className="truncate">{agent.currentTask}</span>
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {agent.capabilities.map((c) => (
                  <span
                    key={c}
                    className="rounded border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground"
                  >
                    {c}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                <span>dept: {agent.department ?? "—"}</span>
                <span>beat: {relTime(agent.lastBeatAt)}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-card px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm font-semibold tabular-nums ${tone ?? "text-foreground"}`}>{value}</div>
    </div>
  );
}

function StatusLegend() {
  const states: AgentStatus[] = ["thinking", "executing", "streaming", "waiting", "error"];
  return (
    <div className="flex items-center gap-2">
      {states.map((s) => (
        <span key={s} className="flex items-center gap-1 font-mono text-[9px] text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${AGENT_STATUS_META[s].dot}`} />
          {AGENT_STATUS_META[s].label}
        </span>
      ))}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="col-span-full space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-lg border border-border/40 bg-card/40" />
      ))}
    </div>
  );
}

export { AGENT_TIERS };
