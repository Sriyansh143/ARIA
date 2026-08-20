import "server-only";
import { db } from "../db"; import { logger } from "../logger"; import { emit } from "../event-bus";
const QUERIES=["most in-demand freelance services 2026","top requested AI services small business","highest paying freelance skills 2026","services small businesses need but can't afford","AI automation services trending"];
export async function runServiceResearch(): Promise<{discovered:number;stored:number}> {
  const all: any[]=[];
  // Phase 31: use webSearchWithFallback (Z-AI → Ollama synthetic → owner alert) instead of direct zai.functions.invoke.
  const { webSearchWithFallback } = await import("../utils/web-search-fallback");
  for(const q of QUERIES) { try {
    const results = await webSearchWithFallback(q, 5);
    if(!Array.isArray(results) || results.length === 0) continue;
    const ctx=results.map((r:any)=>`- ${r.title ?? r.name}: ${r.snippet}`).join("\n");
    const { callLLM }=await import("../llm-client");
    const r=await callLLM("ServiceResearcher","Research",`Based on these results:\n${ctx}\n\nIdentify 1-2 NEW service opportunities an AI company could autonomously deliver. For each: name, description, targetMarket, estimatedPrice, demandScore(0-100), feasibilityScore(0-100), competitionScore(0-100), compositeScore(weighted avg). Only AI-deliverable services. Respond with ONLY JSON array.`,{systemOverride:"You are a market research analyst. Respond with ONLY JSON.",maxRetries:1});
    if(r.success) { const c=r.completion.replace(/```json\n?/g,"").replace(/```\n?/g,"").trim(); const p=JSON.parse(c); if(Array.isArray(p)) for(const o of p) if(o.name&&o.compositeScore!==undefined) all.push({...o,_query:q}); }
  } catch(err) { logger.warn("service-researcher.query-failed", { query: q, error: String(err).slice(0, 80) }); } if(all.length>=10)break; }
  const seen=new Set<string>(); const unique=all.filter(o=>{const k=(o.name||"").toLowerCase().trim();if(seen.has(k))return false;seen.add(k);return true;});
  unique.sort((a,b)=>(b.compositeScore||0)-(a.compositeScore||0)); const top=unique.filter(o=>(o.compositeScore||0)>60).slice(0,2);
  let stored=0;
  for(const o of top) { try { const ex=await db.serviceOpportunity.findFirst({where:{name:{equals:o.name}}}); if(ex)continue;
    await db.serviceOpportunity.create({data:{name:o.name,title:o.name,description:o.description||"",targetMarket:o.targetMarket||"",estimatedPrice:String(o.estimatedPrice||""),demandScore:Math.max(0,Math.min(100,Number(o.demandScore)||0)),feasibilityScore:Math.max(0,Math.min(100,Number(o.feasibilityScore)||0)),competitionScore:Math.max(0,Math.min(100,Number(o.competitionScore)||0)),compositeScore:Math.max(0,Math.min(100,Number(o.compositeScore)||0)),status:"discovered",research:JSON.stringify({query:o._query||""})}}); stored++;
  } catch {} }
  emit({type:"system",ts:new Date().toISOString(),message:stored>0?`Service Research: discovered ${unique.length}, stored ${stored}`:`Service Research: found ${unique.length} (none above threshold)`,level:stored>0?"success":"info"});
  return {discovered:unique.length,stored};
}
