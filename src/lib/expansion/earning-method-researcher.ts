import "server-only";
import { db } from "../db"; import { logger } from "../logger"; import { emit } from "../event-bus";
const CATS=[{id:"subscription",q:"AI subscription services recurring revenue 2026"},{id:"affiliate",q:"AI tool affiliate programs high commission 2026"},{id:"content",q:"monetize AI content blog courses 2026"},{id:"api",q:"sell AI API access marketplace 2026"},{id:"consulting",q:"AI automation consulting pricing 2026"},{id:"marketplace",q:"AI service marketplace platform 2026"},{id:"data",q:"sell market research data AI insights 2026"},{id:"whitelabel",q:"white label AI platform reseller 2026"}];
export async function runEarningMethodResearch(): Promise<{discovered:number;stored:number}> {
  const all: any[]=[];
  // Phase 31: use webSearchWithFallback (Z-AI → Ollama synthetic → owner alert) instead of direct zai.functions.invoke.
  const { webSearchWithFallback } = await import("../utils/web-search-fallback");
  for(const c of CATS) { try {
    const results = await webSearchWithFallback(c.q, 3);
    if(!Array.isArray(results) || results.length === 0) continue;
    const ctx=results.map((r:any)=>`- ${r.title ?? r.name}: ${r.snippet}`).join("\n");
    const { callLLM }=await import("../llm-client");
    const r=await callLLM("EarningMethodResearcher","Research",`Based on these results:\n${ctx}\n\nIdentify ONE earning method in "${c.id}" category. Score: marketSize(0-100), revenuePotential(0-100), implementationEase(0-100), timeToRevenue(0-100), synergyScore(0-100), compositeScore(weighted). Respond with ONLY JSON.`,{systemOverride:"You are a business analyst. Respond with ONLY JSON.",maxRetries:1});
    if(r.success) { const m=r.completion.replace(/```json\n?/g,"").replace(/```\n?/g,"").trim().match(/\{[\s\S]*\}/); if(m) { const p=JSON.parse(m[0]); all.push({...p,category:c.id}); } }
  } catch(err) { logger.warn("earning-method-researcher.query-failed", { category: c.id, error: String(err).slice(0, 80) }); } }
  all.sort((a,b)=>(b.compositeScore||0)-(a.compositeScore||0)); const top=all.filter(m=>(m.compositeScore||0)>65).slice(0,1); let stored=0;
  for(const m of top) { try { const ex=await db.earningMethod.findFirst({where:{name:String(m.name||"").toLowerCase().trim()}}); if(ex)continue;
    await db.earningMethod.create({data:{name:String(m.name||""),title:String(m.name||""),category:String(m.category||"unknown"),description:String(m.description||""),startupCost:String(m.startupCost||""),timeToFirstRevenue:String(m.timeToRevenue||"")+" days",demandScore:Math.max(0,Math.min(100,Number(m.marketSize)||0)),feasibilityScore:Math.max(0,Math.min(100,Number(m.implementationEase)||0)),competitionScore:Math.max(0,Math.min(100,100-(Number(m.synergyScore)||0))),compositeScore:Math.max(0,Math.min(100,Number(m.compositeScore)||0)),requirements:JSON.stringify(m.requirements||[]),data:JSON.stringify({revenuePotential:m.revenuePotential,risks:m.risks||[]}),status:"researched"}});
    stored++;
  } catch {} }
  emit({type:"system",ts:new Date().toISOString(),message:stored>0?`Earning Methods: discovered ${all.length}, stored ${stored}`:`Earning Methods: found ${all.length}`,level:stored>0?"success":"info"});
  return {discovered:all.length,stored};
}
