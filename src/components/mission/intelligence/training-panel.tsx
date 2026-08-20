"use client";
import { useState, useEffect, useCallback } from "react";
import { Brain, Star, ThumbsUp, AlertTriangle, BookOpen } from "lucide-react";
import { GlassCard, AnimatedCounter, StatusBadge, ProgressRing } from "@/components/ui";
interface Data { feedback: any[]; }
export function TrainingPanel() {
  const [data,setData]=useState<Data|null>(null); const [loading,setLoading]=useState(true);
  const f=useCallback(async()=>{try{const r=await fetch("/api/feedback",{cache:"no-store"});if(r.ok){const d=await r.json();setData({feedback:d.feedback||[]});}}catch{}finally{setLoading(false)}},[]);
  useEffect(()=>{void f()},[f]);
  if(loading)return<div className="p-4 text-zinc-500 text-sm">Loading…</div>;
  if(!data)return<div className="p-4 text-zinc-500 text-sm">No data.</div>;
  const avg=data.feedback.length>0?data.feedback.reduce((s:number,f:any)=>s+f.rating,0)/data.feedback.length:0;
  return (<div className="space-y-4">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <GlassCard className="p-4" hover><div className="flex items-center gap-2 mb-2"><Star className="w-4 h-4 text-amber-400"/><span className="text-xs text-zinc-500">Avg Rating</span></div><span className="text-xl font-bold text-amber-400">{avg.toFixed(1)}/5</span></GlassCard>
      <GlassCard className="p-4" hover><div className="flex items-center gap-2 mb-2"><ThumbsUp className="w-4 h-4 text-emerald-400"/><span className="text-xs text-zinc-500">Feedback</span></div><AnimatedCounter value={data.feedback.length} className="text-xl font-bold text-emerald-400"/></GlassCard>
      <GlassCard className="p-4" hover><div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-4 h-4 text-rose-400"/><span className="text-xs text-zinc-500">Low Ratings</span></div><AnimatedCounter value={data.feedback.filter((f:any)=>f.rating<=2).length} className="text-xl font-bold text-rose-400"/></GlassCard>
      <GlassCard className="p-4" hover><div className="flex items-center gap-2 mb-2"><Brain className="w-4 h-4 text-violet-400"/><span className="text-xs text-zinc-500">A/B Tests</span></div><span className="text-xl font-bold text-violet-400">Auto-seeded</span></GlassCard>
    </div>
    <GlassCard className="p-4" hover={false}><h3 className="text-sm text-zinc-300 mb-3">Customer Feedback ({data.feedback.length})</h3>
    {data.feedback.length===0?<p className="text-xs text-zinc-600 py-4 text-center">No feedback yet. Surveys sent 24h after delivery.</p>:
    <div className="space-y-1 max-h-[400px] overflow-y-auto">{data.feedback.slice(0,15).map((f:any)=>(<div key={f.id} className="flex items-start gap-2 p-2 rounded-lg border border-white/[0.04]"><span className={`text-sm font-bold ${f.rating>=4?"text-emerald-400":f.rating>=3?"text-amber-400":"text-rose-400"}`}>{f.rating}★</span><div className="flex-1"><p className="text-xs text-zinc-400">{f.comment||"(no comment)"}</p><p className="text-[10px] text-zinc-600">{f.category||"uncategorized"}</p></div></div>))}</div>}</GlassCard>
  </div>);
}
