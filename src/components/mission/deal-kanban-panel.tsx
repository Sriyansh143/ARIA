"use client";

import { useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Briefcase, GripVertical, User } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { FullScreenPanel } from "./full-screen-panel";
import { useMissionStore } from "@/stores/mission-store";
import { DEAL_STAGES, type Deal, type DealStage } from "@/lib/types";

/**
 * DealKanbanPanel — drag-and-drop pipeline board.
 *
 * Task ID: FEATURES-DEAL-KANBAN.
 *
 * Reads deals (and agents, for name lookups) directly from the Zustand
 * store. The store is hydrated via SSE, so there is no fetch here. When
 * the operator drags a card between columns, we PATCH the new stage to
 * /api/deals/[id]/stage; the server emits a `deal.update` SSE event that
 * flows back through the store, so every connected client reflects the
 * move instantly. A `system` info event is also emitted for the activity
 * ticker.
 *
 * All motion.X animate props include a matching `initial` to satisfy the
 * house rule (no animate-without-initial). No <button> is ever nested.
 */

// ─── Stage metadata ────────────────────────────────────────────────
interface StageMeta {
  label: string;
  accent: string; // text color for header
  border: string; // top/left accent border class
  dot: string; // header status dot
  glow: string; // column ring on hover / drop-active
}

const STAGE_META: Record<DealStage, StageMeta> = {
  lead: {
    label: "Lead",
    accent: "text-violet-300",
    border: "border-l-violet-500/70",
    dot: "bg-violet-400",
    glow: "data-[over=true]:ring-violet-500/40",
  },
  qualified: {
    label: "Qualified",
    accent: "text-cyan-300",
    border: "border-l-cyan-500/70",
    dot: "bg-cyan-400",
    glow: "data-[over=true]:ring-cyan-500/40",
  },
  proposal: {
    label: "Proposal",
    accent: "text-amber-300",
    border: "border-l-amber-500/70",
    dot: "bg-amber-400",
    glow: "data-[over=true]:ring-amber-500/40",
  },
  negotiation: {
    label: "Negotiation",
    accent: "text-emerald-300",
    border: "border-l-emerald-500/70",
    dot: "bg-emerald-400",
    glow: "data-[over=true]:ring-emerald-500/40",
  },
  won: {
    label: "Won",
    accent: "text-emerald-300",
    border: "border-l-emerald-400",
    dot: "bg-emerald-300",
    glow: "data-[over=true]:ring-emerald-400/50",
  },
  lost: {
    label: "Lost",
    accent: "text-rose-300",
    border: "border-l-rose-500/70",
    dot: "bg-rose-400",
    glow: "data-[over=true]:ring-rose-500/40",
  },
};

// ─── Helpers ───────────────────────────────────────────────────────
const fmtK = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;

// ─── Draggable deal card ──────────────────────────────────────────
interface DealCardProps {
  deal: Deal;
  agentName: string | null;
  dragging?: boolean; // true for the live overlay copy
}

function DealCard({ deal, agentName, dragging }: DealCardProps) {
  const meta = STAGE_META[deal.stage];
  return (
    <div
      className={`mc-glow-card group relative flex flex-col gap-1.5 rounded-md border border-border/60 ${meta.border} border-l-2 bg-surface-2/60 px-2.5 py-2 text-left transition-colors hover:bg-surface-2 ${
        dragging ? "rotate-2 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)]" : ""
      }`}
    >
      {/* drag affordance — purely visual; not a button */}
      <GripVertical className="absolute right-1.5 top-1.5 h-3 w-3 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="flex items-baseline justify-between gap-2 pr-3">
        <span className="truncate text-[11px] font-medium text-foreground">
          {deal.title}
        </span>
        <span className="shrink-0 font-mono text-[11px] font-bold text-foreground">
          {fmtK(deal.value)}
        </span>
      </div>
      {deal.counterparty && (
        <div className="truncate font-mono text-[10px] text-muted-foreground">
          {deal.counterparty}
        </div>
      )}
      <div className="mt-0.5 flex items-center gap-1.5">
        {/* probability pill */}
        <span
          className={`rounded-sm border border-border/60 px-1 font-mono text-[9px] ${
            deal.probability >= 70
              ? "text-emerald-300"
              : deal.probability >= 40
                ? "text-amber-300"
                : "text-rose-300"
          }`}
        >
          {deal.probability}%
        </span>
        {agentName && (
          <span className="flex min-w-0 items-center gap-1 truncate font-mono text-[9px] text-muted-foreground">
            <User className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{agentName}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/** Wrapper that wires @dnd-kit useDraggable to a DealCard. */
function DraggableDeal({
  deal,
  agentName,
}: {
  deal: Deal;
  agentName: string | null;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    data: { stage: deal.stage },
  });

  return (
    <motion.div
      ref={setNodeRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: isDragging ? 0.35 : 1 }}
      transition={{ duration: 0.12 }}
      {...listeners}
      {...attributes}
      className="cursor-grab touch-none active:cursor-grabbing"
    >
      <DealCard deal={deal} agentName={agentName} />
    </motion.div>
  );
}

// ─── Droppable column ─────────────────────────────────────────────
function KanbanColumn({
  stage,
  deals,
  agentNames,
}: {
  stage: DealStage;
  deals: Deal[];
  agentNames: Record<string, string | null>;
}) {
  const meta = STAGE_META[stage];
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const total = deals.reduce((s, d) => s + d.value, 0);
  const scrollable = deals.length > 5;

  return (
    <div
      ref={setNodeRef}
      data-over={isOver}
      className={`flex min-h-0 flex-1 flex-col rounded-lg border border-border/60 bg-background/40 p-2 ring-1 ring-transparent transition-shadow ${meta.glow}`}
    >
      {/* Column header */}
      <div className="mb-2 flex items-center justify-between border-b border-border/60 px-1 pb-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          <span
            className={`truncate font-mono text-[10px] font-semibold uppercase tracking-[0.14em] ${meta.accent}`}
          >
            {meta.label}
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {deals.length}
        </span>
      </div>
      <div className="mb-1.5 px-1 font-mono text-[10px] text-muted-foreground/80">
        {fmtK(total)}
      </div>

      {/* Deal list */}
      <div
        className={`mc-scroll flex flex-1 flex-col gap-1.5 px-0.5 ${
          scrollable ? "max-h-80 overflow-y-auto pr-1" : ""
        }`}
      >
        {deals.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border/40 px-2 py-6 text-center">
            <span className="font-mono text-[10px] text-muted-foreground/60">
              No deals
            </span>
          </div>
        ) : (
          deals.map((d) => (
            <DraggableDeal
              key={d.id}
              deal={d}
              agentName={agentNames[d.id] ?? null}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Summary bar ──────────────────────────────────────────────────
function SummaryBar({
  totalDeals,
  totalValue,
  winRate,
}: {
  totalDeals: number;
  totalValue: number;
  winRate: number | null;
}) {
  const stats = [
    { label: "Total Deals", value: String(totalDeals) },
    { label: "Pipeline Value", value: fmtK(totalValue) },
    {
      label: "Win Rate",
      value: winRate === null ? "—" : `${(winRate * 100).toFixed(0)}%`,
    },
  ];
  return (
    <div className="flex flex-wrap items-stretch gap-2 border-b border-border/60 px-3 py-2">
      {stats.map((s, i) => (
        <div
          key={s.label}
          className={`flex min-w-[110px] flex-1 flex-col gap-0.5 rounded-md border border-border/60 bg-surface-2/40 px-2.5 py-1.5 ${
            i === stats.length - 1 ? "" : ""
          }`}
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            {s.label}
          </span>
          <span className="font-mono text-sm font-semibold text-foreground">
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────
export function DealKanbanPanel() {
  const deals = useMissionStore((s) => s.deals);
  const agents = useMissionStore((s) => s.agents);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  // Bucket deals by stage (stable: preserves store order within a stage).
  const byStage = useMemo(() => {
    const buckets: Record<DealStage, Deal[]> = {
      lead: [],
      qualified: [],
      proposal: [],
      negotiation: [],
      won: [],
      lost: [],
    };
    for (const d of Object.values(deals)) {
      if ((DEAL_STAGES as readonly string[]).includes(d.stage)) {
        buckets[d.stage as DealStage].push(d);
      }
    }
    // Sort within each bucket by updatedAt desc — most-recent on top.
    for (const st of DEAL_STAGES) {
      buckets[st].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    }
    return buckets;
  }, [deals]);

  // Pre-compute agent names per deal (one lookup per render, not per card).
  const agentNames = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const d of Object.values(deals)) {
      out[d.id] = d.agentId ? (agents[d.agentId]?.name ?? null) : null;
    }
    return out;
  }, [deals, agents]);

  const allDeals = useMemo(() => Object.values(deals), [deals]);
  const totalValue = useMemo(
    () => allDeals.reduce((s, d) => s + d.value, 0),
    [allDeals]
  );
  const wonCount = byStage.won.length;
  const lostCount = byStage.lost.length;
  const winRate =
    wonCount + lostCount === 0 ? null : wonCount / (wonCount + lostCount);

  const activeDeal = activeId ? deals[activeId] ?? null : null;

  const onDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  }, []);

  const onDragEnd = useCallback(
    async (e: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = e;
      if (!over) return;
      const dealId = String(active.id);
      const newStage = String(over.id) as DealStage;
      if (!(DEAL_STAGES as readonly string[]).includes(newStage)) return;

      const deal = deals[dealId];
      if (!deal) return;
      if (deal.stage === newStage) return; // no-op drop on same column

      // Optimistic reordering is unnecessary — the server emits a
      // `deal.update` SSE event that flows through the store and
      // re-renders every column. We just fire the PATCH.
      try {
        const res = await fetch(`/api/deals/${dealId}/stage`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: newStage }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
        toast.success("Deal moved", {
          description: `“${deal.title}” → ${STAGE_META[newStage].label}`,
        });
      } catch (err) {
        toast.error("Failed to move deal", {
          description: String(err),
        });
      }
    },
    [deals]
  );

  const onDragCancel = useCallback(() => setActiveId(null), []);

  return (
    <FullScreenPanel
      title="Deal Pipeline Kanban"
      icon={<Briefcase className="h-3.5 w-3.5 text-violet-300" />}
    >
      <div className="flex min-h-0 flex-col">
        <SummaryBar
          totalDeals={allDeals.length}
          totalValue={totalValue}
          winRate={winRate}
        />

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div
            className="mc-scroll flex min-h-0 flex-1 gap-2 overflow-x-auto p-2"
            role="list"
            aria-label="Deal pipeline stages"
          >
            {DEAL_STAGES.map((st) => (
              <KanbanColumn
                key={st}
                stage={st as DealStage}
                deals={byStage[st as DealStage]}
                agentNames={agentNames}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeDeal ? (
              <div className="w-64 max-w-[70vw] cursor-grabbing">
                <DealCard
                  deal={activeDeal}
                  agentName={agentNames[activeDeal.id] ?? null}
                  dragging
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {allDeals.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="border-t border-border/60 px-4 py-3 text-center font-mono text-[10px] text-muted-foreground"
          >
            No deals in the pipeline yet. Deals appear here once agents create
            them — drag a card between columns to update its stage.
          </motion.div>
        )}
      </div>
    </FullScreenPanel>
  );
}

export default DealKanbanPanel;
