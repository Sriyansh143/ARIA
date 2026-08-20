"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ShieldAlert,
  Loader2,
  Plus,
  Check,
  X,
  Clock,
  Ban,
  Lock,
} from "lucide-react";
import { relTime } from "@/hooks/use-clock";

const SCOPES = ["shell", "browser", "filesystem", "computer-use"];

interface Session {
  id: string;
  agentId: string | null;
  requester: string;
  scope: string;
  reason: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
}

interface SessionListResponse {
  sessions: Session[];
}

interface ApprovalListResponse {
  approvals: {
    id: string;
    sessionId: string;
    decision: string;
    decider: string;
    rationale: string;
    createdAt: string;
  }[];
}

const STATUS_TONE: Record<string, string> = {
  pending: "text-amber-300 border-amber-500/30 bg-amber-500/5",
  approved: "text-emerald-300 border-emerald-500/30 bg-emerald-500/5",
  denied: "text-rose-300 border-rose-500/30 bg-rose-500/5",
  expired: "text-muted-foreground border-border/40 bg-background/40",
  revoked: "text-rose-300 border-rose-500/30 bg-rose-500/5",
};

const SCOPE_TONE: Record<string, string> = {
  shell: "text-rose-300 border-rose-500/30 bg-rose-500/5",
  browser: "text-cyan-300 border-cyan-500/30 bg-cyan-500/5",
  filesystem: "text-amber-300 border-amber-500/30 bg-amber-500/5",
  "computer-use": "text-violet-300 border-violet-500/30 bg-violet-500/5",
};

export function SystemAccessPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);

  // Form state
  const [formRequester, setFormRequester] = useState("owner");
  const [formScope, setFormScope] = useState("shell");
  const [formReason, setFormReason] = useState("");
  const [formTtl, setFormTtl] = useState(15);
  const [saving, setSaving] = useState(false);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/system-access/session");
      if (!res.ok) throw new Error("fetch failed");
      const json = (await res.json()) as SessionListResponse;
      setSessions(json.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  async function requestAccess() {
    if (!formRequester.trim() || !formReason.trim()) {
      toast.error("Requester and reason are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/system-access/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requester: formRequester.trim(),
          scope: formScope,
          reason: formReason.trim(),
          ttlMinutes: formTtl,
        }),
      });
      if (!res.ok) throw new Error("request failed");
      toast.success("Access requested", {
        description: `${formScope} for ${formTtl}m — pending approval`,
      });
      setFormReason("");
      setShowForm(false);
      await fetchSessions();
    } catch {
      toast.error("Failed to request access");
    } finally {
      setSaving(false);
    }
  }

  async function decide(sessionId: string, decision: "approve" | "deny") {
    setDeciding(sessionId);
    try {
      const res = await fetch(
        `/api/system-access/approvals/${encodeURIComponent(sessionId)}/decide`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, decider: "owner", rationale: "" }),
        }
      );
      if (!res.ok) throw new Error("decide failed");
      toast.success(`Session ${decision}d`);
      await fetchSessions();
    } catch {
      toast.error(`Failed to ${decision}`);
    } finally {
      setDeciding(null);
    }
  }

  async function revoke(sessionId: string) {
    try {
      const res = await fetch(
        `/api/system-access/session/${encodeURIComponent(sessionId)}/revoke`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error("revoke failed");
      toast.success("Session revoked");
      await fetchSessions();
    } catch {
      toast.error("Failed to revoke session");
    }
  }

  return (
    <section className="mc-surface flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-rose-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            System Access
          </h2>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-rose-300 transition-colors hover:bg-rose-500/15"
        >
          <Plus className="h-2.5 w-2.5" />
          request access
        </button>
      </div>

      <div className="mc-scroll max-h-96 flex-1 overflow-y-auto p-2.5">
        {showForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            className="mb-3 overflow-hidden"
          >
            <div className="rounded-md border border-rose-500/20 bg-rose-500/5 p-2.5">
              <input
                value={formRequester}
                onChange={(e) => setFormRequester(e.target.value)}
                placeholder="requester (agent name or 'owner')"
                className="w-full rounded border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-[10px] text-foreground outline-none focus:border-rose-500/40"
              />
              <select
                value={formScope}
                onChange={(e) => setFormScope(e.target.value)}
                className="mt-2 w-full rounded border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-[10px] text-foreground outline-none focus:border-rose-500/40"
              >
                {SCOPES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <input
                value={formReason}
                onChange={(e) => setFormReason(e.target.value)}
                placeholder="reason (why access is needed)"
                className="mt-2 w-full rounded border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-[10px] text-foreground outline-none focus:border-rose-500/40"
              />
              <div className="mt-2 flex items-center gap-2">
                <span className="font-mono text-[9px] uppercase text-muted-foreground">TTL</span>
                <input
                  type="range"
                  min={5}
                  max={120}
                  value={formTtl}
                  onChange={(e) => setFormTtl(parseInt(e.target.value, 10))}
                  className="flex-1 accent-rose-400"
                />
                <span className="font-mono text-[10px] text-foreground">{formTtl}m</span>
              </div>
              <button
                onClick={() => void requestAccess()}
                disabled={saving}
                className="mt-2 flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-amber-300 transition-colors hover:bg-amber-500/15 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Lock className="h-2.5 w-2.5" />}
                {saving ? "requesting…" : "submit request"}
              </button>
            </div>
          </motion.div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded bg-border/30" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex h-24 flex-col items-center justify-center gap-1 font-mono text-xs text-muted-foreground">
            <Lock className="h-4 w-4 text-muted-foreground/50" />
            <span>no active sessions</span>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {sessions.map((s) => (
              <motion.li
                key={s.id}
                layout
                className="rounded-md border border-border/50 bg-card/50 p-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                          SCOPE_TONE[s.scope] ?? SCOPE_TONE.shell
                        }`}
                      >
                        {s.scope}
                      </span>
                      <span className="truncate font-mono text-xs font-medium text-foreground">
                        {s.requester}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 font-mono text-[10px] text-muted-foreground">
                      {s.reason}
                    </p>
                    <div className="mt-1 flex items-center gap-2 font-mono text-[9px] text-muted-foreground">
                      <Clock className="h-2.5 w-2.5" />
                      <span>expires {relTime(s.expiresAt)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                        STATUS_TONE[s.status] ?? STATUS_TONE.pending
                      }`}
                    >
                      {s.status}
                    </span>
                    {s.status === "pending" && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => void decide(s.id, "approve")}
                          disabled={deciding === s.id}
                          className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/5 px-1.5 py-0.5 font-mono text-[9px] uppercase text-emerald-300 transition-colors hover:bg-emerald-500/15 disabled:opacity-50"
                        >
                          {deciding === s.id ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          ) : (
                            <Check className="h-2.5 w-2.5" />
                          )}
                        </button>
                        <button
                          onClick={() => void decide(s.id, "deny")}
                          disabled={deciding === s.id}
                          className="flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/5 px-1.5 py-0.5 font-mono text-[9px] uppercase text-rose-300 transition-colors hover:bg-rose-500/15 disabled:opacity-50"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    )}
                    {s.status === "approved" && (
                      <button
                        onClick={() => void revoke(s.id)}
                        className="flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground transition-colors hover:border-rose-500/40 hover:text-rose-300"
                      >
                        <Ban className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                </div>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// Unused export for type parity with other panels
export type { SessionListResponse, ApprovalListResponse };
