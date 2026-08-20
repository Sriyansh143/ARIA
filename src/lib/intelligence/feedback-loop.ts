import "server-only";
import { db } from "../db"; import { logger } from "../logger"; import { emit } from "../event-bus";
export async function sendSatisfactionSurvey(orderId: string): Promise<void> {
  try { const o=await db.serviceOrder.findUnique({where:{id:orderId}}); if(!o||o.status!=="delivered"||!o.customerEmail)return;
    const { sendNotification } = await import("../email-service");
    await sendNotification({to:o.customerEmail,subject:`How was your ${o.serviceName}?`,text:`Hi ${o.customerName||"there"},\n\nYour order #${orderId.slice(-8)} was delivered. How was it?\n\nReply with 1-5:\n5=Excellent, 4=Good, 3=OK, 2=Poor, 1=Terrible\n\n— The ARIA Team`,metadata:{orderId,type:"satisfaction_survey"}});
  } catch (err) { logger.error("feedback-loop.survey-failed",{orderId,error:String(err)}); }
}
export async function recordFeedback(orderId: string, rating: number, comment: string): Promise<void> {
  try { const o=await db.serviceOrder.findUnique({where:{id:orderId}}); if(!o)return;
    let category="general";
    if(rating<=2) { try { const { callLLM } = await import("../llm-client"); const r=await callLLM("FeedbackAnalyzer","Research",`Categorize: Rating ${rating}/5, Comment: ${comment}, Service: ${o.serviceName}\nCategories: code_quality, documentation, delivery_speed, expectation_mismatch, other\nRespond with ONLY the category.`,{maxRetries:1}); if(r.success)category=r.completion.trim().toLowerCase(); } catch { const l=comment.toLowerCase(); category=l.includes("error")||l.includes("broken")?"code_quality":l.includes("readme")?"documentation":l.includes("slow")?"delivery_speed":"expectation_mismatch"; } }
    await db.customerFeedback.create({data:{orderId,customerEmail:o.customerEmail||"",rating,comment,category}});
    if(rating<=2) {
      // AUDIT-B-11: don't create a failure_pattern with an empty comment —
      // the prompt-improver would feed empty context to the LLM and produce a
      // poorly-grounded "improved" prompt. Fall back to a synthetic comment.
      const commentText = (comment && comment.trim()) ? comment.trim() : `(no comment provided — rating ${rating}/5)`;
      await db.knowledgeBaseEntry.create({data:{category:"failure_pattern",title:`${o.serviceName} — rating ${rating}/5`,content:JSON.stringify({orderId,comment:commentText,category}),successRate:0,source:"customer_feedback"}}); emit({type:"system",ts:new Date().toISOString(),message:`⚠️ Low rating (${rating}/5) for ${orderId.slice(-8)}`,level:"warn"}); }
    if(rating>=4) { await db.knowledgeBaseEntry.create({data:{category:"code_pattern",title:`${o.serviceName} — successful (rating ${rating}/5)`,content:JSON.stringify({orderId,serviceType:o.serviceId}),successRate:rating*20,source:"delivery_success"}}); }
  } catch (err) { logger.error("feedback-loop.record-failed",{orderId,error:String(err)}); }
}
export async function getSuccessfulPatterns(category: string, limit=3): Promise<string[]> { try { const e=await db.knowledgeBaseEntry.findMany({where:{category,successRate:{gt:60}},orderBy:{successRate:"desc"},take:limit}); return e.map(e=>e.content); } catch { return []; } }
