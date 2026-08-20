"use client";
import { useState, useEffect, useCallback } from "react";
import { Search, Users, DollarSign, ExternalLink } from "lucide-react";
import { GlassCard, AnimatedCounter, StatusBadge, ProgressRing } from "@/components/ui";
interface Data { opportunities: any[]; competitors: any[]; earningMethods: any[]; }
export function MarketIntelligencePanel() {
  const [data,setData]=useState<Data|null>(null); const [loading,setLoading]=useState(true);
  const f=useCallback(async()=>{try{const[o,c,e]=await Promise.all([fetch("/api/expansion/service-opportunities",{cache:"no-store"}).catch(()=>null),fetch("/api/competitors",{cache:"no-store"}).catch(()=>null),fetch("/api/expansion/earning-methods",{cache:"no-store"}).catch(()=>null)]);setData({opportunities:o?.ok?(await o.json()).opportunities||[]:[],competitors:c?.ok?(await c.json()).competitors||[]:[],earningMethods:e?.ok?(await e.json()).methods||[]:[]});}catch{}finally{setLoading(false)}},[]);
  useEffect(()=>{void f()},[f]);
  if(loading)return<div className="p-4 text-zinc-500 text-sm">Loading…</div>;
  if(!data)return<div className="p-4 text-zinc-500 text-sm">No data.</div>;
  return (<div className="space-y-4">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <GlassCard className="p-4" hover><div className="flex items-center gap-2 mb-2"><Search className="w-4 h-4 text-cyan-400"/><span className="text-xs text-zinc-500">Opportunities</span></div><AnimatedCounter value={data.opportunities.length} className="text-xl font-bold text-cyan-400"/></GlassCard>
      <GlassCard className="p-4" hover><div className="flex items-center gap-2 mb-2"><Users className="w-4 h-4 text-violet-400"/><span className="text-xs text-zinc-500">Competitors</span></div><AnimatedCounter value={data.competitors.length} className="text-xl font-bold text-violet-400"/></GlassCard>
      <GlassCard className="p-4" hover><div className="flex items-center gap-2 mb-2"><DollarSign className="w-4 h-4 text-emerald-400"/><span className="text-xs text-zinc-500">Earning Methods</span></div><AnimatedCounter value={data.earningMethods.length} className="text-xl font-bold text-emerald-400"/></GlassCard>
      <GlassCard className="p-4" hover><div className="flex items-center gap-2 mb-2"><DollarSign className="w-4 h-4 text-amber-400"/><span className="text-xs text-zinc-500">Pending</span></div><AnimatedCounter value={[...data.opportunities,...data.earningMethods].filter(o=>o.status==="pending_approval").length} className="text-xl font-bold text-amber-400"/></GlassCard>
    </div>
    <GlassCard className="p-4" hover={false}><h3 className="text-sm text-zinc-300 mb-3">Service Opportunities</h3>
    {data.opportunities.length===0?<p className="text-xs text-zinc-600 py-4 text-center">No opportunities yet. Service Researcher runs at 7 AM.</p>:
    <div className="space-y-2">{data.opportunities.slice(0,10).map(o=>(<div key={o.id} className="flex items-center gap-3 p-3 rounded-lg border border-white/[0.04]"><ProgressRing value={o.compositeScore} size={40} strokeWidth={3} gradient={["#6366f1","#8b5cf6"]}/><div className="flex-1"><p className="text-sm text-zinc-200">{o.name}</p><p className="text-xs text-zinc-500">{o.description?.slice(0,80)} · ${o.estimatedPrice}</p></div><StatusBadge status={o.status==="approved"?"success":o.status==="pending_approval"?"pending":"idle"}>{o.status}</StatusBadge></div>))}</div>}</GlassCard>
    <GlassCard className="p-4" hover={false}><h3 className="text-sm text-zinc-300 mb-3">Competitors</h3>
    {data.competitors.length===0?<p className="text-xs text-zinc-600 py-4 text-center">No competitors yet. Analyzer runs weekly on Sundays.</p>:
    <div className="space-y-2">{data.competitors.slice(0,5).map(c=>(<div key={c.id} className="p-3 rounded-lg border border-white/[0.04]"><div className="flex items-center gap-2 mb-1"><span className="text-sm text-zinc-200">{c.competitor}</span>{c.url&&<a href={c.url} target="_blank" rel="noopener" className="text-zinc-600 hover:text-zinc-400"><ExternalLink className="w-3 h-3"/></a>}</div><div className="text-xs"><span className="text-zinc-600">Pricing:</span> <span className="text-zinc-400">{c.pricing}</span> · <span className="text-zinc-600">Our advantage:</span> <span className="text-emerald-400">{c.ourAdvantage?.slice(0,60)}</span></div></div>))}</div>}</GlassCard>
  </div>);
}
