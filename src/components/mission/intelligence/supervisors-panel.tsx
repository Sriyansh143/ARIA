"use client";
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, CheckCircle2, XCircle, AlertTriangle, Activity, Clock } from "lucide-react";
import { GlassCard, AnimatedCounter, StatusBadge, ProgressRing } from "@/components/ui";
interface Data { reviews: any[]; escalations: any[]; stats: any[]; }
const META: Record<string,{color:string;label:string}> = { sales:{color:"text-emerald-400",label:"Sales"}, quality:{color:"text-amber-400",label:"Quality"}, finance:{color:"text-cyan-400",label:"Finance"}, compliance:{color:"text-violet-400",label:"Compliance"}, executive:{color:"text-rose-400",label:"Executive"} };
export function SupervisorsPanel() {
  const [data,setData]=useState<Data|null>(null); const [loading,setLoading]=useState(true);
  const f=useCallback(async()=>{try{const r=await fetch("/api/supervisors/reviews",{cache:"no-store"});if(r.ok)setData(await r.json());}catch{}finally{setLoading(false)}},[]);
  useEffect(()=>{void f();const i=setInterval(()=>void f(),30000);return()=>clearInterval(i)},[f]);
  if(loading)return<div className="p-4 text-zinc-500 text-sm">Loading…</div>;
  if(!data)return<div className="p-4 text-zinc-500 text-sm">No data.</div>;
  const stats: Record<string,{total:number;approved:number;rejected:number}>={};
  for(const s of data.stats){if(!stats[s.supervisor])stats[s.supervisor]={total:0,approved:0,rejected:0};stats[s.supervisor].total+=s._count;if(s.approved)stats[s.supervisor].approved+=s._count;else stats[s.supervisor].rejected+=s._count;}
  return (<div className="space-y-4">
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{Object.entries(META).map(([key,m])=>{const s=stats[key]||{total:0,approved:0,rejected:0};const ar=s.total>0?(s.approved/s.total)*100:100;return(<motion.div key={key} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}}><GlassCard className="p-4" hover><div className="flex items-center gap-2 mb-2"><Shield className={`w-4 h-4 ${m.color}`}/><span className="text-xs text-zinc-300">{m.label}</span></div><div className="flex items-baseline gap-3 mb-2"><AnimatedCounter value={s.total} className="text-xl font-bold text-zinc-200"/><span className="text-xs text-zinc-500">reviews</span></div><div className="flex items-center gap-2"><ProgressRing value={ar} size={36} strokeWidth={3}/><div><span className="text-xs text-emerald-400">{s.approved} ok</span><br/><span className="text-xs text-rose-400">{s.rejected} blocked</span></div></div></GlassCard></motion.div>)})}</div>
    {data.escalations.length>0&&<GlassCard className="p-4" hover={false}><div className="flex items-center gap-2 mb-3"><AlertTriangle className="w-4 h-4 text-amber-400"/><h3 className="text-sm text-zinc-300">Escalations ({data.escalations.length})</h3></div><div className="space-y-2">{data.escalations.slice(0,10).map(e=>(<div key={e.id} className="flex items-start gap-2 p-2 rounded-lg border border-amber-500/20 bg-amber-500/5"><StatusBadge status={e.severity==="critical"?"error":"pending"}>{e.severity}</StatusBadge><div className="flex-1"><p className="text-xs text-zinc-300">{e.issue}</p><p className="text-[10px] text-zinc-600">{e.source} → {e.supervisor}</p></div></div>))}</div></GlassCard>}
    <GlassCard className="p-4" hover={false}><h3 className="text-sm text-zinc-300 mb-3">Recent Reviews</h3><div className="space-y-1 max-h-[400px] overflow-y-auto">{data.reviews.length===0?<p className="text-xs text-zinc-600 py-4 text-center">No reviews yet.</p>:data.reviews.slice(0,30).map(r=>(<div key={r.id} className="flex items-start gap-2 p-2 rounded-lg border border-white/[0.04]">{r.approved?<CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5"/>:<XCircle className="w-3 h-3 text-rose-400 mt-0.5"/>}<div className="flex-1"><span className="text-xs text-zinc-300">{r.workerAgent} · {r.action}</span>{r.feedback&&<p className="text-[10px] text-zinc-500">{r.feedback}</p>}</div><span className="text-[10px] text-zinc-600">{new Date(r.createdAt).toLocaleTimeString()}</span></div>))}</div></GlassCard>
  </div>);
}
