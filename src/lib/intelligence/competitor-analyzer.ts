import "server-only";
import { db } from "../db"; import { logger } from "../logger"; import { emit } from "../event-bus";
const QUERIES=["AI website builder pricing 2026","AI code generation service cost","autonomous AI agency services","AI landing page generator price","automated software delivery service"];
export async function runCompetitorAnalysis(): Promise<{analyzed:number}> {
  logger.info("competitor-analyzer.start",{}); let analyzed=0;
  // Phase 31: use webSearchWithFallback (Z-AI → Ollama synthetic → owner alert) instead of direct zai.functions.invoke.
  const { webSearchWithFallback } = await import("../utils/web-search-fallback");
  for(const q of QUERIES) { try {
    const results = await webSearchWithFallback(q, 3);
    if(!Array.isArray(results) || results.length === 0) continue;
    const ctx=results.map((r:any)=>`- ${r.title ?? r.name}: ${r.snippet}`).join("\n");
    const { callLLM }=await import("../llm-client");
    const r=await callLLM("CompetitorAnalyzer","Research",`Based on these results, identify the TOP competitor:\n${ctx}\n\nAnalyze: competitor, url, pricing, features, strengths, weaknesses, ourAdvantage (ARIA offers $9-$99 one-time crypto/UPI/card services).\nRespond with ONLY JSON: {"competitor":"...","url":"...","pricing":"...","features":"...","strengths":"...","weaknesses":"...","ourAdvantage":"..."}`,{systemOverride:"You are a competitive intelligence analyst. Respond with ONLY JSON.",maxRetries:1});
    if(r.success) { const c=r.completion.replace(/```json\n?/g,"").replace(/```\n?/g,"").trim(); const m=c.match(/\{[\s\S]*\}/); if(m) { const p=JSON.parse(m[0]); const ex=await db.competitorAnalysis.findFirst({where:{competitor:{equals:p.competitor}}}); if(ex) await db.competitorAnalysis.update({where:{id:ex.id},data:{url:p.url||"",pricing:p.pricing||"",features:p.features||"",strengths:p.strengths||"",weaknesses:p.weaknesses||"",ourAdvantage:p.ourAdvantage||"",analyzedAt:new Date()}}); else await db.competitorAnalysis.create({data:{competitor:p.competitor,url:p.url||"",pricing:p.pricing||"",features:p.features||"",strengths:p.strengths||"",weaknesses:p.weaknesses||"",ourAdvantage:p.ourAdvantage||""}}); analyzed++; } }
  } catch(err) { logger.warn("competitor-analyzer.query-failed",{query:q,error:String(err).slice(0,80)}); } }
  emit({type:"system",ts:new Date().toISOString(),message:`🔍 Competitor Analysis: ${analyzed} competitors`,level:"info"});
  return {analyzed};
}
