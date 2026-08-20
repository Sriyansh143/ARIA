"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Users, Plus, Phone, Mail, Calendar, TrendingUp, DollarSign, Filter } from "lucide-react";
import { toast } from "sonner";

interface Lead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string;
  stage: string;
  value: number;
  currency: string;
  assignedAgentId: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"] as const;
const STAGE_COLORS: Record<string, string> = {
  lead: "text-zinc-400 border-zinc-500/30 bg-zinc-500/5",
  qualified: "text-cyan-300 border-cyan-500/30 bg-cyan-500/5",
  proposal: "text-violet-300 border-violet-500/30 bg-violet-500/5",
  negotiation: "text-amber-300 border-amber-500/30 bg-amber-500/5",
  won: "text-emerald-300 border-emerald-500/30 bg-emerald-500/5",
  lost: "text-rose-300 border-rose-500/30 bg-rose-500/5",
};

export function CrmPanel() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [filterStage, setFilterStage] = useState<string>("all");
  const [newLead, setNewLead] = useState({ name: "", email: "", phone: "", company: "", value: 0, source: "website" });

  const fetchLeads = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/leads", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads || []);
      }
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLeads();
  }, [fetchLeads]);

  const handleAddLead = useCallback(async () => {
    if (!newLead.name.trim()) {
      toast.error("Name is required");
      return;
    }
    try {
      const res = await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newLead),
      });
      if (res.ok) {
        toast.success("Lead added");
        setNewLead({ name: "", email: "", phone: "", company: "", value: 0, source: "website" });
        setShowAddForm(false);
        void fetchLeads();
      } else {
        toast.error("Failed to add lead");
      }
    } catch {
      toast.error("Network error");
    }
  }, [newLead, fetchLeads]);

  const handleStageChange = useCallback(async (leadId: string, stage: string) => {
    try {
      const res = await fetch(`/api/crm/leads/${leadId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      if (res.ok) {
        toast.success(`Lead moved to ${stage}`);
        void fetchLeads();
      }
    } catch {
      toast.error("Failed to update stage");
    }
  }, [fetchLeads]);

  const filteredLeads = filterStage === "all" ? leads : leads.filter((l) => l.stage === filterStage);
  const totalValue = leads.reduce((s, l) => s + l.value, 0);
  const wonCount = leads.filter((l) => l.stage === "won").length;
  const activeCount = leads.filter((l) => !["won", "lost"].includes(l.stage)).length;

  return (
    <section className="mc-surface flex flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-violet-300" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
            CRM Pipeline
          </h2>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1 rounded border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-violet-300 hover:bg-violet-500/20"
        >
          <Plus className="h-3 w-3" /> Add Lead
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-2 border-b border-border/60 px-4 py-2">
        <Stat label="Total" value={leads.length.toString()} />
        <Stat label="Active" value={activeCount.toString()} />
        <Stat label="Won" value={wonCount.toString()} />
        <Stat label="Value" value={`$${(totalValue / 1000).toFixed(1)}k`} />
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
        <Filter className="h-3 w-3 text-muted-foreground" />
        <select
          value={filterStage}
          onChange={(e) => setFilterStage(e.target.value)}
          className="rounded border border-border/60 bg-background/60 px-2 py-1 font-mono text-[10px] text-foreground"
        >
          <option value="all">All Stages</option>
          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="p-3">
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mb-3 space-y-2 rounded-md border border-violet-500/20 bg-violet-500/5 p-3"
          >
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Name *"
                value={newLead.name}
                onChange={(e) => setNewLead({ ...newLead, name: e.target.value })}
                className="rounded border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-xs text-foreground"
              />
              <input
                type="text"
                placeholder="Company"
                value={newLead.company}
                onChange={(e) => setNewLead({ ...newLead, company: e.target.value })}
                className="rounded border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-xs text-foreground"
              />
              <input
                type="email"
                placeholder="Email"
                value={newLead.email}
                onChange={(e) => setNewLead({ ...newLead, email: e.target.value })}
                className="rounded border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-xs text-foreground"
              />
              <input
                type="text"
                placeholder="Phone"
                value={newLead.phone}
                onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })}
                className="rounded border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-xs text-foreground"
              />
              <input
                type="number"
                placeholder="Value ($)"
                value={newLead.value || ""}
                onChange={(e) => setNewLead({ ...newLead, value: parseInt(e.target.value) || 0 })}
                className="rounded border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-xs text-foreground"
              />
              <select
                value={newLead.source}
                onChange={(e) => setNewLead({ ...newLead, source: e.target.value })}
                className="rounded border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-xs text-foreground"
              >
                <option value="website">Website</option>
                <option value="referral">Referral</option>
                <option value="cold_outreach">Cold Outreach</option>
                <option value="event">Event</option>
                <option value="social">Social</option>
              </select>
            </div>
            <button
              onClick={handleAddLead}
              className="w-full rounded border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-violet-300 hover:bg-violet-500/20"
            >
              Create Lead
            </button>
          </motion.div>
        )}

        {/* Lead list */}
        <div className="mc-scroll max-h-[300px] space-y-1.5 overflow-y-auto">
          {loading ? (
            <div className="flex h-20 items-center justify-center font-mono text-xs text-muted-foreground">Loading...</div>
          ) : filteredLeads.length === 0 ? (
            <div className="flex h-20 items-center justify-center font-mono text-xs text-muted-foreground">No leads yet</div>
          ) : (
            filteredLeads.map((lead) => (
              <div
                key={lead.id}
                className="rounded-md border border-border/50 bg-card/50 p-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-xs font-medium text-foreground">{lead.name}</span>
                      {lead.company && (
                        <span className="truncate font-mono text-[10px] text-muted-foreground">{lead.company}</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                      <DollarSign className="h-3 w-3" />
                      <span>${lead.value.toLocaleString()}</span>
                      <span>·</span>
                      <span>{lead.source}</span>
                    </div>
                  </div>
                  <select
                    value={lead.stage}
                    onChange={(e) => handleStageChange(lead.id, e.target.value)}
                    className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${STAGE_COLORS[lead.stage] || ""}`}
                  >
                    {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="font-mono text-sm font-bold text-foreground">{value}</div>
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
