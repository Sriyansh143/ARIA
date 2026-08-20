import "server-only";
import { db } from "../db"; import { logger } from "../logger"; import { emit } from "../event-bus";
const THRESHOLD=5;
/** AUDIT-B-9: hard cap on prompt auto-tuning rounds per serviceType per 7-day window. */
const MAX_TUNE_ROUNDS = 2;
const TUNE_WINDOW_DAYS = 7;

/**
 * Prompt auto-tuning loop (the "5+ failure" loop).
 *
 * PROMPT-DRIFT FIX (AUDIT-B-9): the previous implementation mutated prompts
 * indefinitely — no cap, no rollback, no eval gate, hardcoded successRate=50,
 * and source failures were never re-scored so the SAME group re-triggered on
 * every invocation. We now:
 *   1. enforce MAX_TUNE_ROUNDS (2) per normalized serviceType per 7-day window;
 *   2. normalize the group key (AUDIT-B-10) so case/spacing variants collapse;
 *   3. mark source failure_pattern entries as `addressed` (successRate bumped to
 *      30 so they fall out of the `successRate < 30` query) after a prompt is
 *      applied, preventing indefinite re-triggering;
 *   4. keep an audit trail via the existing KnowledgeBaseEntry title suffix.
 *
 * NOTE: a real eval-gate (auto-apply only if the new prompt beats the incumbent
 * on a held-out set) is tracked as a v59 roadmap item.
 */
export async function checkAndImprovePrompts(): Promise<{checked:number;suggestions:number;autoApplied:number;needsApproval:number}> {
  let suggestions=0,autoApplied=0,needsApproval=0;
  try { const failures=await db.knowledgeBaseEntry.findMany({where:{category:"failure_pattern",successRate:{lt:30}},orderBy:{createdAt:"desc"},take:100});
    const groups: Record<string, typeof failures>={};
    for(const f of failures) {
      // AUDIT-B-10: normalize group key — collapse case/spacing variants.
      const st=normalizeGroupKey(f.title);
      if(!groups[st])groups[st]=[]; groups[st].push(f);
    }
    let checked=0;
    const since=new Date(Date.now()-TUNE_WINDOW_DAYS*24*60*60*1000);
    for(const [st, gf] of Object.entries(groups)) {
      checked++; if(gf.length<THRESHOLD)continue;
      // AUDIT-B-9: hard cap — count prior prompt_improvement entries in window.
      const priorRounds=await db.knowledgeBaseEntry.count({
        where:{category:"prompt_improvement",createdAt:{gte:since},title:{startsWith:`${st} — improved prompt`}}
      });
      if(priorRounds>=MAX_TUNE_ROUNDS) {
        logger.info("prompt-improver.cap-reached",{serviceType:st,rounds:priorRounds});
        continue;
      }
      const summary=gf.slice(0,10).map(f=>`- ${f.title}: ${f.content.slice(0,200)}`).join("\n");
      const { callLLM }=await import("../llm-client");
      const r=await callLLM("PromptImprover","Engineering",`Based on ${gf.length} failure patterns for "${st}":\n${summary}\n\nGenerate an improved system prompt that avoids these mistakes. Add "DO NOT" and "MUST INCLUDE" instructions. Respond with ONLY the prompt text.`,{systemOverride:"You are a prompt engineer.",maxRetries:1});
      if(!r.success)continue; const improved=r.completion.trim().slice(0,5000);
      const safe=isSafe(improved);
      await db.knowledgeBaseEntry.create({data:{category:"prompt_improvement",title:`${st} — improved prompt (${safe?"auto":"needs_approval"}) #${priorRounds+1}`,content:improved,successRate:50,source:"prompt_improver"}});
      suggestions++;
      if(safe){
        autoApplied++;
        // AUDIT-B-9: re-score source failures so this group stops re-triggering.
        try { await db.knowledgeBaseEntry.updateMany({where:{id:{in:gf.map(f=>f.id)}},data:{successRate:30}}); } catch (e) { logger.warn("prompt-improver.rescore-failed",{error:String(e)}); }
        emit({type:"system",ts:new Date().toISOString(),message:`🧠 Prompt auto-improved for ${st} (round ${priorRounds+1}/${MAX_TUNE_ROUNDS})`,level:"info"});
      }
      else { needsApproval++; try { const { createEscalation }=await import("../supervisors"); await createEscalation("PromptImprover","executive",`Prompt for ${st} needs approval`,{serviceType:st,round:priorRounds+1},"medium"); } catch {} }
    }
    return {checked,suggestions,autoApplied,needsApproval};
  } catch(err) { logger.error("prompt-improver.failed",{error:String(err)}); return {checked:0,suggestions:0,autoApplied:0,needsApproval:0}; }
}

function normalizeGroupKey(title: string): string {
  // AUDIT-B-10: titles look like "Landing Page — rating 2/5".
  // Normalize the part before " — " to lowercase kebab-case.
  const base = (title.split(" — ")[0] || "general").trim();
  if(!base) return "general";
  return base.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,"");
}

function isSafe(p: string): boolean { const l=p.toLowerCase(); const danger=["ignore supervisor","bypass quality","skip can-spam","skip payment","ignore compliance","don't validate","no quality gate","bypass sandbox","skip verification"]; for(const d of danger) { if(l.includes(d))return false; } return p.length<=3000; }
