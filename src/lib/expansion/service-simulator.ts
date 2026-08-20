import "server-only";
import { db } from "../db"; import { logger } from "../logger";
const TEST=["Build a landing page for a coffee shop. Warm colors, cozy aesthetic.","Create a portfolio website for a photographer. Minimalist, dark theme.","Design a product page for a SaaS task tracker. Modern, clean."];
export async function simulateService(opportunityId: string, spec: {name:string;builderPrompt:string;deliverables:string[];priceCents:number;estimatedCostPerDelivery?:number}): Promise<{verdict:"pass"|"fail"|"needs_review";avgScore:number}> {
  const tests: Array<{score:number;passed:boolean}>=[];
  for(let i=0;i<3;i++) { try { const { routeLLM }=await import("../llm-router"); type ChatMsg={role:"system"|"user"|"assistant";content:string};
    const r=await routeLLM([{role:"system",content:spec.builderPrompt||`Generate deliverable for: ${spec.name}. Use ---FILE: <path>--- delimiters.`},{role:"user",content:TEST[i]||`Test ${i+1}`}],{complexity:"high"});
    if(!r.success){tests.push({score:0,passed:false});continue;}
    const { parseMultiFileResponse }=await import("../services/builder"); const files=parseMultiFileResponse(r.completion); const fn=Object.keys(files);
    const score=Math.min(100,Math.round(Math.min(40,fn.length*10)+Math.min(30,Object.values(files).reduce((s,c)=>s+c.length/100,0))+Math.min(30,(spec.deliverables||[]).filter(d=>fn.some(f=>f===d||f.endsWith(d))).length*10)));
    tests.push({score,passed:score>=60});
  } catch { tests.push({score:0,passed:false}); } }
  const avg=tests.reduce((s,t)=>s+t.score,0)/Math.max(1,tests.length); const verdict=avg>=75?"pass":avg>=50?"needs_review":"fail";
  try { await db.simulationReport.create({data:{type:"service",targetId:opportunityId,targetName:spec.name,result:verdict,verdict,stepsTotal:3,stepsPassed:tests.filter(t=>t.passed).length,stepsFailed:tests.filter(t=>!t.passed).length,avgScore:avg,duration:0,details:JSON.stringify({tests})}}); } catch {}
  return {verdict,avgScore:avg};
}
