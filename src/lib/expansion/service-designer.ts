import "server-only";
import { db } from "../db"; import { logger } from "../logger"; import { emit } from "../event-bus";
export async function designServiceOpportunity(opportunityId: string): Promise<{ok:boolean;error?:string}> {
  try { const opp=await db.serviceOpportunity.findUnique({where:{id:opportunityId}}); if(!opp)return{ok:false,error:"not found"}; if(opp.status!=="discovered")return{ok:false,error:`is ${opp.status}`};
    await db.serviceOpportunity.update({where:{id:opportunityId},data:{status:"designing"}});
    const { callLLM }=await import("../llm-client");
    const r=await callLLM("ServiceDesigner","Engineering",`Design a service spec for: "${opp.name}"\nDescription: ${opp.description}\nTarget: ${opp.targetMarket}\nPrice: $${opp.estimatedPrice}\n\nInclude: category(web/3d/voice/saas/tool/api/content/data), inputs[], deliverables[], priceCents, deliveryHours, builderPrompt, qualityCriteria[]. Respond with ONLY JSON.`,{systemOverride:"You are a product designer. Respond with ONLY JSON.",maxRetries:1});
    if(!r.success) { await db.serviceOpportunity.update({where:{id:opportunityId},data:{status:"discovered"}}); return{ok:false,error:"LLM failed"}; }
    const m=r.completion.replace(/```json\n?/g,"").replace(/```\n?/g,"").trim().match(/\{[\s\S]*\}/); if(!m)return{ok:false,error:"parse failed"};
    const spec=JSON.parse(m[0]); const er=JSON.parse(opp.research||"{}"); er.spec=spec; er.designedAt=new Date().toISOString();
    await db.serviceOpportunity.update({where:{id:opportunityId},data:{status:"simulating",research:JSON.stringify(er),estimatedPrice:String(spec.priceCents?spec.priceCents/100:opp.estimatedPrice)}});
    try { const { simulateService }=await import("./service-simulator"); const sr=await simulateService(opportunityId,spec);
      if(sr.verdict==="pass") { await db.serviceOpportunity.update({where:{id:opportunityId},data:{status:"pending_approval"}}); emit({type:"system",ts:new Date().toISOString(),message:`🎯 Service designed+simulated: "${opp.name}" — awaiting approval`,level:"success"}); }
      else await db.serviceOpportunity.update({where:{id:opportunityId},data:{status:"rejected"}});
    } catch {}
    return {ok:true};
  } catch(err) { return{ok:false,error:String(err)}; }
}
