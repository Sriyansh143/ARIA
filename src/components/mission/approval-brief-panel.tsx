"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  X,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Send,
  Phone,
  HelpCircle,
  FileText,
  TrendingUp,
  TrendingDown,
  MessageSquare,
  Sparkles,
  Briefcase,
} from "lucide-react";
import { useMissionStore } from "@/stores/mission-store";
import {
  RISK_META,
  parseJsonObject,
  parseJsonArray,
  type Approval,
  type ApprovalBrief,
  type ApprovalDiscussionEntry,
  type ApprovalRisk,
} from "@/lib/types";
import { relTime } from "@/hooks/use-clock";

interface ApprovalBriefPanelProps {
  approvalId: string | null;
  onClose: () => void;
}

/**
 * ApprovalBriefPanel — enhanced owner brief drawer (Task 23).
 *
 * Slides in from the right when an approval is selected. Shows:
 *   - The action requested + which agent raised it
 *   - WHY (LLM summary)
 *   - RISKS list (with severity dots)
 *   - IF APPROVED / IF NOT APPROVED comparison
 *   - CLARIFICATIONS (Q&A the owner might have)
 *   - Chat-like input where the owner can ask follow-up questions
 *     (calls POST /api/approvals/[id]/discuss)
 *   - Approve / Deny buttons (PATCH /api/approvals/[id])
 *   - "Oral confirmation via call also accepted" note + a "simulate
 *     voice call" button (POST /api/approvals/[id]/oral-confirm)
 *
 * The brief + discussion log are returned as JSON strings by the API
 * and parsed lazily here — the panel tolerates missing/malformed briefs
 * (falls back to a deterministic template derived from the approval row).
 */
export function ApprovalBriefPanel({ approvalId, onClose }: ApprovalBriefPanelProps) {
  const approvals = useMissionStore((s) => s.approvals);
  const approval = approvalId ? (approvals[approvalId] ?? null) : null;

  // Local state for the brief + discussion log. We initialize from the
  // store (which already has them as JSON strings) but also re-fetch
  // from /api/approvals/[id] to pick up server-side updates to the
  // discussion log (the SSE stream emits the full approval row, but
  // the discussion log only updates server-side after discuss()).
  const [brief, setBrief] = useState<ApprovalBrief | null>(null);
  const [discussion, setDiscussion] = useState<ApprovalDiscussionEntry[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState<"approve" | "deny" | "ask" | "oral" | null>(null);

  // Phase 32: conversation thread from the ApprovalConversation table
  // (populated by Telegram inline button callbacks). This is SEPARATE from
  // the legacy discussionLog — it captures Ask/Suggest interactions that
  // happened via Telegram, not via the dashboard's discuss() textarea.
  interface ConversationMessage {
    role: "owner" | "agent" | "system";
    content: string;
    ts: string;
    kind: "question" | "answer" | "suggestion" | "revision" | "note" | "decision";
  }
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [conversationStatus, setConversationStatus] = useState<string>("none");

  // Reset + refetch whenever the approvalId changes.
  useEffect(() => {
    if (!approval) {
      setBrief(null);
      setDiscussion([]);
      setConversation([]);
      setConversationStatus("none");
      return;
    }
    // Initialize from the store first (immediate paint).
    setBrief(parseJsonObject<ApprovalBrief | null>(approval.brief, null));
    setDiscussion(parseJsonArray<ApprovalDiscussionEntry>(approval.discussionLog, []));
    // Then refetch from the API to pick up any server-side discussion updates.
    void (async () => {
      try {
        const res = await fetch(`/api/approvals/${approval.id}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { approval: Approval };
        setBrief(parseJsonObject<ApprovalBrief | null>(data.approval.brief, null));
        setDiscussion(parseJsonArray<ApprovalDiscussionEntry>(data.approval.discussionLog, []));
      } catch {
        // Silent — the store copy is already shown.
      }
    })();

    // Phase 32: also fetch the Telegram-side conversation thread.
    // This captures Ask/Suggest interactions that happened via Telegram
    // inline buttons (separate from the dashboard's discuss() textarea).
    void (async () => {
      try {
        const res = await fetch(`/api/approvals/${approval.id}/conversation`, { cache: "no-store" });
        if (!res.ok) {
          setConversation([]);
          setConversationStatus("none");
          return;
        }
        const data = (await res.json()) as {
          messages?: ConversationMessage[];
          status?: string;
        };
        setConversation(data.messages ?? []);
        setConversationStatus(data.status ?? "none");
      } catch {
        setConversation([]);
        setConversationStatus("none");
      }
    })();
  }, [approval]);

  // ─── Actions ──────────────────────────────────────────────────────
  async function decide(decision: "approved" | "denied") {
    if (!approval) return;
    setBusy(decision === "approved" ? "approve" : "deny");
    try {
      const res = await fetch(`/api/approvals/${approval.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "decision failed");
      }
      toast.success(`Approval ${decision}`, { description: approval.title });
      onClose();
    } catch (err) {
      toast.error("Failed to record decision", { description: String(err) });
    } finally {
      setBusy(null);
    }
  }

  async function askQuestion() {
    if (!approval || !question.trim()) return;
    setBusy("ask");
    try {
      const res = await fetch(`/api/approvals/${approval.id}/discuss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });
      if (!res.ok) throw new Error("discuss failed");
      const data = (await res.json()) as {
        answer: string;
        discussionLog: ApprovalDiscussionEntry[];
      };
      setDiscussion(data.discussionLog);
      setQuestion("");
    } catch (err) {
      toast.error("Failed to ask question", { description: String(err) });
    } finally {
      setBusy(null);
    }
  }

  async function simulateOralConfirm() {
    if (!approval) return;
    setBusy("oral");
    try {
      // Synthesize a realistic affirmative transcript.
      const transcript = `Hello, this is the ARIA voice agent calling about your pending approval: ${approval.title}. The requesting agent is ${approval.requester ?? "unknown"}. Risk level is ${approval.risk}. Say yes to approve, or no to deny. Operator: Yes, go ahead, I approve it. Please proceed.`;
      const res = await fetch(`/api/approvals/${approval.id}/oral-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      if (!res.ok) throw new Error("oral-confirm failed");
      const data = (await res.json()) as { confirmed: boolean; reason: string; status: string };
      if (data.confirmed) {
        toast.success("Oral confirmation accepted", { description: data.reason });
        // Refetch the discussion log to show the system entry the server added.
        const refreshed = await fetch(`/api/approvals/${approval.id}`, { cache: "no-store" });
        if (refreshed.ok) {
          const rj = (await refreshed.json()) as { approval: Approval };
          setDiscussion(parseJsonArray<ApprovalDiscussionEntry>(rj.approval.discussionLog, []));
        }
        onClose();
      } else {
        toast.warning("Oral confirmation rejected", { description: data.reason });
      }
    } catch (err) {
      toast.error("Oral-confirm failed", { description: String(err) });
    } finally {
      setBusy(null);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {approval && (
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
            className="mc-surface-elevated fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-border/70 bg-card"
            role="dialog"
            aria-label={`Approval brief: ${approval.title}`}
          >
            <PanelHeader approval={approval} onClose={onClose} />

            <div className="mc-scroll flex-1 overflow-y-auto p-4">
              {/* WHY */}
              <Section title="Why this is needed" icon={HelpCircle}>
                <p className="text-sm leading-relaxed text-foreground">
                  {brief?.why ?? fallbackWhy(approval)}
                </p>
              </Section>

              {/* RISKS */}
              <Section title="Risks" icon={AlertTriangle}>
                {brief && brief.risks.length > 0 ? (
                  <ul className="space-y-1.5">
                    {brief.risks.map((r, i) => (
                      <RiskRow key={i} text={r} risk={approval.risk} />
                    ))}
                  </ul>
                ) : (
                  <p className="font-mono text-xs text-muted-foreground">
                    Risk classified as {approval.risk}. No detailed breakdown available.
                  </p>
                )}
              </Section>

              {/* IF APPROVED / IF NOT APPROVED — comparison */}
              <Section title="Outcomes" icon={TrendingUp}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <OutcomeTile
                    tone="emerald"
                    icon={TrendingUp}
                    title="If Approved"
                    body={brief?.ifApproved ?? "The action will proceed."}
                  />
                  <OutcomeTile
                    tone="rose"
                    icon={TrendingDown}
                    title="If Not Approved"
                    body={
                      brief?.ifNotApproved ??
                      "The action will be blocked; the requesting agent will be notified."
                    }
                  />
                </div>
              </Section>

              {/* CLARIFICATIONS */}
              {brief && brief.clarifications.length > 0 && (
                <Section title="Clarifications" icon={MessageSquare}>
                  <ul className="space-y-2">
                    {brief.clarifications.map((c, i) => (
                      <li
                        key={i}
                        className="rounded-md border border-border/50 bg-background/40 p-2.5"
                      >
                        <div className="flex items-start gap-2">
                          <HelpCircle className="mt-0.5 h-3 w-3 shrink-0 text-cyan-300" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-foreground">{c.q}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{c.a}</p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* DISCUSSION */}
              <Section title="Discussion" icon={MessageSquare}>
                {discussion.length === 0 ? (
                  <p className="font-mono text-xs text-muted-foreground">
                    No questions asked yet. Use the box below to ask anything.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {discussion.map((d, i) => (
                      <DiscussionBubble key={i} entry={d} />
                    ))}
                  </ul>
                )}

                {/* Phase 32: Telegram-side conversation thread (inline button callbacks) */}
                {conversation.length > 0 && (
                  <div className="mt-3 rounded-md border border-cyan-500/20 bg-cyan-500/5 p-2">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
                        Telegram Conversation
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {conversationStatus}
                      </span>
                    </div>
                    <ul className="space-y-1.5">
                      {conversation.map((m, i) => (
                        <ConversationBubble key={i} message={m} />
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-2 flex items-end gap-2">
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask a question about this approval…"
                    rows={2}
                    className="mc-scroll min-h-[44px] flex-1 resize-none rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void askQuestion();
                      }
                    }}
                  />
                  <button
                    onClick={askQuestion}
                    disabled={busy === "ask" || !question.trim()}
                    className="flex h-9 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                  >
                    {busy === "ask" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Send className="h-3 w-3" />
                    )}
                    Ask
                  </button>
                </div>
              </Section>

              {/* ORAL CONFIRMATION NOTE */}
              <div className="mt-4 rounded-md border border-violet-500/30 bg-violet-500/5 p-3">
                <div className="flex items-start gap-2">
                  <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-violet-200">
                      Oral confirmation via call also accepted
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      Say "yes", "approved", or "go ahead" during a voice call and ARIA will
                      auto-approve without a button press. Negative phrases ("no", "wait",
                      "deny") take precedence.
                    </p>
                    <button
                      onClick={simulateOralConfirm}
                      disabled={busy === "oral" || approval.status !== "pending"}
                      className="mt-2 flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-violet-300 transition-colors hover:bg-violet-500/20 disabled:opacity-50"
                    >
                      {busy === "oral" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      Simulate voice call
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* DECISION FOOTER */}
            {approval.status === "pending" ? (
              <div className="flex items-center gap-2 border-t border-border/70 p-3">
                <button
                  onClick={() => decide("approved")}
                  disabled={busy !== null}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  {busy === "approve" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Approve
                </button>
                <button
                  onClick={() => decide("denied")}
                  disabled={busy !== null}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-rose-300 transition-colors hover:bg-rose-500/20 disabled:opacity-50"
                >
                  {busy === "deny" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  Deny
                </button>
              </div>
            ) : (
              <div
                className={`flex items-center gap-2 border-t border-border/70 p-3 font-mono text-xs uppercase tracking-wider ${
                  approval.status === "approved"
                    ? "bg-emerald-500/10 text-emerald-300"
                    : "bg-rose-500/10 text-rose-300"
                }`}
              >
                {approval.status === "approved" ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                Decision recorded: {approval.status}
                {approval.oralConfirmed && (
                  <span className="ml-2 flex items-center gap-1 text-violet-300">
                    <Phone className="h-3 w-3" /> oral
                  </span>
                )}
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function PanelHeader({ approval, onClose }: { approval: Approval; onClose: () => void }) {
  const riskMeta = RISK_META[approval.risk as ApprovalRisk] ?? RISK_META.medium;
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/70 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-violet-300" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Owner Brief
          </span>
        </div>
        <h2 className="mt-1 truncate font-mono text-sm font-bold uppercase tracking-wide text-foreground">
          {approval.title}
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${riskMeta.badge}`}>
            {riskMeta.label}
          </span>
          {approval.action && (
            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-amber-300">
              ▸ {approval.action}
            </span>
          )}
          {approval.amount != null && (
            <span className="font-mono text-[10px] text-muted-foreground">
              ${approval.amount.toLocaleString()}
            </span>
          )}
          <span className="font-mono text-[10px] text-muted-foreground">
            by {approval.requester ?? "—"}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            · {relTime(approval.createdAt)}
          </span>
        </div>
      </div>
      <button
        onClick={onClose}
        aria-label="Close brief"
        className="rounded-md border border-border/60 p-1.5 text-muted-foreground transition-colors hover:bg-card/80 hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
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
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

// Briefcase is only used as the type anchor for the Section icon prop.
// (Imported at the top of this file alongside the other lucide icons.)

function RiskRow({ text, risk }: { text: string; risk: ApprovalRisk }) {
  const dot =
    risk === "critical"
      ? "bg-rose-400"
      : risk === "high"
        ? "bg-amber-400"
        : risk === "medium"
          ? "bg-sky-400"
          : "bg-emerald-400";
  return (
    <li className="flex items-start gap-2 rounded-md border border-border/40 bg-background/40 p-2">
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="text-xs leading-relaxed text-foreground">{text}</span>
    </li>
  );
}

function OutcomeTile({
  tone,
  icon: Icon,
  title,
  body,
}: {
  tone: "emerald" | "rose";
  icon: typeof TrendingUp;
  title: string;
  body: string;
}) {
  const cls =
    tone === "emerald"
      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
      : "border-rose-500/30 bg-rose-500/5 text-rose-300";
  return (
    <div className={`rounded-md border p-2.5 ${cls}`}>
      <div className="mb-1 flex items-center gap-1.5">
        <Icon className="h-3 w-3" />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider">{title}</span>
      </div>
      <p className="text-xs leading-relaxed text-foreground">{body}</p>
    </div>
  );
}

function DiscussionBubble({ entry }: { entry: ApprovalDiscussionEntry }) {
  const isOwner = entry.role === "owner";
  const isSystem = entry.role === "system";
  const align = isOwner ? "items-end" : "items-start";
  const bg = isSystem
    ? "border-violet-500/30 bg-violet-500/10 text-violet-200"
    : isOwner
      ? "border-primary/30 bg-primary/10 text-foreground"
      : "border-border/60 bg-background/40 text-foreground";
  return (
    <li className={`flex flex-col gap-0.5 ${align}`}>
      <div className={`max-w-[85%] rounded-md border px-2.5 py-1.5 ${bg}`}>
        <div className="mb-0.5 flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          <span>{entry.role}</span>
          <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
        </div>
        <p className="text-xs leading-relaxed">{entry.message}</p>
      </div>
    </li>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function fallbackWhy(approval: Approval): string {
  const amountStr =
    approval.amount != null ? ` involving $${approval.amount.toLocaleString()}` : "";
  return `${approval.requester ?? "An agent"} is requesting approval to ${approval.action ?? "take action"}${amountStr}. ${approval.summary ?? ""}`.trim();
}

// ─── Floating badge for the dashboard ────────────────────────────────

/**
 * PendingApprovalsBadge — floating button that shows the pending count
 * and opens the brief panel for the most recent pending approval.
 *
 * Used in the dashboard page alongside <ApprovalBriefPanel />.
 */
export function PendingApprovalsBadge({
  onClick,
  activeApprovalId,
}: {
  onClick: (id: string | null) => void;
  activeApprovalId: string | null;
}) {
  const approvals = useMissionStore((s) => s.approvals);
  const pending = useMemo(
    () =>
      Object.values(approvals)
        .filter((a) => a.status === "pending")
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [approvals]
  );

  const hasOpen = activeApprovalId !== null;
  const count = pending.length;

  // Pulse if there's a fresh approval that hasn't been viewed yet.
  const mostRecent = pending[0] ?? null;
  const isPanelMostRecent = mostRecent && activeApprovalId === mostRecent.id;

  if (count === 0) return null;

  return (
    <motion.button
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      onClick={() => onClick(hasOpen ? null : mostRecent?.id ?? null)}
      className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full border border-violet-500/40 bg-card/90 px-3 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-violet-300 shadow-lg backdrop-blur-md transition-colors hover:bg-card"
      aria-label={`${count} pending approval${count === 1 ? "" : "s"}`}
    >
      <motion.span
        animate={isPanelMostRecent ? {} : { scale: [1, 1.18, 1] }}
        transition={{ duration: 1.6, repeat: isPanelMostRecent ? 0 : Infinity, ease: "easeInOut" }}
        className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/20 text-[10px]"
      >
        {count}
      </motion.span>
      <ShieldCheck className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{hasOpen ? "Close" : "Brief"}</span>
    </motion.button>
  );
}

// ─── Phase 32: ConversationBubble (Telegram-side conversation) ──────

function ConversationBubble({ message }: {
  message: {
    role: "owner" | "agent" | "system";
    content: string;
    ts: string;
    kind: string;
  };
}) {
  const isOwner = message.role === "owner";
  const isSystem = message.role === "system";
  const time = new Date(message.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const kindLabel: Record<string, string> = {
    question: "Q",
    answer: "A",
    suggestion: "✏",
    revision: "↻",
    note: "ℹ",
    decision: "✓",
  };
  const kindIcon = kindLabel[message.kind] ?? "•";

  return (
    <li className={`flex ${isOwner ? "justify-end" : isSystem ? "justify-center" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs ${
          isOwner
            ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-100"
            : isSystem
              ? "bg-violet-500/10 border border-violet-500/20 text-violet-200/80 text-center font-mono"
              : "bg-cyan-500/10 border border-cyan-500/20 text-cyan-100"
        }`}
      >
        <div className="mb-0.5 flex items-center gap-1.5 opacity-70">
          <span className="font-mono text-[9px] uppercase tracking-wider">{kindIcon} {message.role}</span>
          <span className="font-mono text-[9px]">{time}</span>
        </div>
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>
    </li>
  );
}
