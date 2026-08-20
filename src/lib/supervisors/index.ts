import "server-only";
import { db } from "../db"; import { logger } from "../logger";
export interface ReviewRequest { workerAgent: string; action: string; content: string; context?: Record<string, unknown>; }
export interface ReviewResult { approved: boolean; feedback?: string; reviewTime: number; }
export async function logReview(supervisor: string, req: ReviewRequest, result: ReviewResult): Promise<void> { try { await db.supervisorReview.create({ data: { supervisor, workerAgent: req.workerAgent, action: req.action, content: req.content.slice(0,2000), approved: result.approved, feedback: result.feedback||null, reviewTime: result.reviewTime } }); } catch {} }
export async function createEscalation(source: string, supervisor: string, issue: string, context: Record<string, unknown>, severity: "low"|"medium"|"high"|"critical"="medium"): Promise<void> { try { await db.escalation.create({ data: { source, supervisor, issue, context: JSON.stringify(context), severity, status: "escalated_to_owner" } }); const ownerEmail = process.env.ARIA_OWNER_EMAIL; if (ownerEmail) { const { sendNotification } = await import("../email-service"); await sendNotification({ to: ownerEmail, subject: `[ESCALATION] ${supervisor}: ${issue.slice(0,80)}`, text: `Source: ${source}\nIssue: ${issue}\nSeverity: ${severity}`, metadata: { type: "supervisor_escalation" } }).catch(()=>{}); } else { logger.warn("supervisor.escalation.no-owner-email",{source,supervisor,issue:issue.slice(0,80)}); } } catch (err) { logger.error("supervisor.escalation.failed",{error:String(err)}); } }
export async function salesSupervisorReview(req: ReviewRequest): Promise<ReviewResult> { const start=Date.now(); const c=req.content.toLowerCase(); const issues: string[]=[];
  if (!c.includes("unsubscribe")&&!c.includes("opt out")) issues.push("Missing unsubscribe link (CAN-SPAM)");
  if (!c.includes("aria")&&!c.includes("address")) issues.push("Missing sender identification");
  if (!c.includes("reply")&&!c.includes("call")&&!c.includes("schedule")&&!c.includes("book")) issues.push("Missing CTA");
  const spam=["free","guaranteed","act now","limited time","click here"]; const found=spam.filter(w=>c.includes(w)); if (found.length>0) issues.push(`Spam words: ${found.join(", ")}`);
  if (req.content.length<50) issues.push("Too short"); if (req.content.length>1000) issues.push("Too long");
  const r: ReviewResult={approved:issues.length===0,feedback:issues.length>0?issues.join("; "):undefined,reviewTime:Date.now()-start}; await logReview("sales",req,r); return r;
}
export async function qualitySupervisorReview(req: ReviewRequest & { files?: Record<string,string>; serviceType?: string }): Promise<ReviewResult> { const start=Date.now();
  if (!req.files||Object.keys(req.files).length===0) { const r:ReviewResult={approved:false,feedback:"No files generated",reviewTime:Date.now()-start}; await logReview("quality",req,r); return r; }
  const { runQualityGate } = await import("../services/builder"); const gate=runQualityGate(req.files);
  let sandboxPassed=true; let sandboxErrors: string[]=[];
  if (req.serviceType && gate.passed) { try { const { executeInSandbox } = await import("../intelligence/sandbox"); const sr=await executeInSandbox(req.files,req.serviceType); sandboxPassed=sr.success; sandboxErrors=sr.errors; } catch (err) {
      // AUDIT-B-14: fail-closed — if the sandbox itself crashes, do NOT default
      // to sandboxPassed=true (which shipped untested code). Reject instead.
      sandboxPassed = false; sandboxErrors = [`sandbox crashed: ${String(err).slice(0,150)}`];
      logger.error("supervisor.quality.sandbox-crash",{error:String(err)});
    } }
  const allIssues=[...gate.issues,...sandboxErrors]; const r:ReviewResult={approved:allIssues.length===0,feedback:allIssues.length>0?allIssues.join("; "):undefined,reviewTime:Date.now()-start}; await logReview("quality",req,r); return r;
}
export async function financeSupervisorReview(req: ReviewRequest & { confirmations?: number; expectedAmount?: number; receivedAmount?: number; network?: string }): Promise<ReviewResult> { const start=Date.now(); const issues: string[]=[];
  if (req.network==="UPI") { const r:ReviewResult={approved:false,feedback:"UPI requires human approval",reviewTime:Date.now()-start}; await logReview("finance",req,r); return r; }
  const min: Record<string,number>={BTC:3,ETH:12,SOL:32,USDT:12,USDC:12}; const req_min=min[req.network||""]||12;
  if ((req.confirmations||0)<req_min) issues.push(`Insufficient confirmations: ${req.confirmations}/${req_min}`);
  if (req.expectedAmount&&req.receivedAmount) { const tol=req.expectedAmount*0.02; if (Math.abs(req.receivedAmount-req.expectedAmount)>tol) issues.push("Amount mismatch"); }
  const r:ReviewResult={approved:issues.length===0,feedback:issues.length>0?issues.join("; "):undefined,reviewTime:Date.now()-start}; await logReview("finance",req,r); return r;
}
export async function complianceSupervisorReview(req: ReviewRequest & { recipientEmail?: string; channel?: string }): Promise<ReviewResult> { const start=Date.now(); const issues: string[]=[];
  if (req.recipientEmail) { try { const { isSuppressed } = await import("../outreach-executor"); const s=await isSuppressed(req.recipientEmail); if (s) issues.push(`Suppressed: ${s.reason}`); } catch {} }
  if (req.channel==="email"||!req.channel) { if (!req.content.toLowerCase().includes("unsubscribe")) issues.push("Missing unsubscribe (CAN-SPAM)"); }
  if (req.action==="email_send") { try { const ts=new Date(); ts.setHours(0,0,0,0); const c=await db.task.count({ where:{kind:"follow_up",status:"completed",completedAt:{gte:ts}} }); const lim=parseInt(process.env.ARIA_OUTREACH_DAILY_LIMIT||"10",10); if (c>=lim) issues.push(`Daily limit reached (${c}/${lim})`); } catch {} }
  const r:ReviewResult={approved:issues.length===0,feedback:issues.length>0?issues.join("; "):undefined,reviewTime:Date.now()-start}; await logReview("compliance",req,r); return r;
}
export async function executiveSupervisorReview(): Promise<void> {
  try { const ts=new Date(); ts.setHours(0,0,0,0);
    const [rev,ord,leads,emails,refunds]=await Promise.all([db.revenueEvent.aggregate({where:{createdAt:{gte:ts}},_sum:{amount:true}}),db.serviceOrder.count({where:{createdAt:{gte:ts}}}),db.earningOpportunity.count({where:{createdAt:{gte:ts}}}),db.task.count({where:{kind:"follow_up",status:"completed",completedAt:{gte:ts}}}),db.serviceOrder.count({where:{status:"refunded",updatedAt:{gte:ts}}})]);
    const ra=rev._sum.amount||0; const issues: string[]=[];
    if (emails>10&&leads===0) issues.push("Outreach sent but no leads — LeadFinder may be failing");
    if (ord>0&&ra===0) issues.push("Orders but no revenue — payment verification broken?");
    if (refunds>2) issues.push(`${refunds} refunds today — quality degrading`);
    await logReview("executive",{workerAgent:"System",action:"daily_metrics",content:JSON.stringify({ra,ord,leads,emails,refunds})},{approved:issues.length===0,feedback:issues.length>0?issues.join("; "):undefined,reviewTime:0});
    if (issues.length>0) await createEscalation("ExecutiveSupervisor","executive",issues.join("; "),{ra,ord,leads,emails,refunds},"high");
  } catch (err) { logger.error("supervisor.executive.failed",{error:String(err)}); }
}

/**
 * Bounded supervisor feedback loop.
 *
 * HARD-CAP FIX (user requirement: "strict hard caps, max 2 retries, on all
 * supervisor feedback loops"). This wraps any supervisor review function so a
 * worker agent (ServiceBuilder / OutreachExecutor) cannot loop forever between
 * "generate → review → reject → regenerate". After `maxAttempts` (default 2)
 * rejections, the work is escalated to the owner instead of being retried again.
 *
 * @param reviewFn   one of the *SupervisorReview functions above
 * @param generateFn worker-side generator that receives the supervisor feedback
 *                   and returns the next candidate { content, files?, serviceType? }
 * @param req        initial review request
 * @param maxAttempts hard cap (default 2 — never unbounded)
 */
export async function reviewWithRetryCap<T extends ReviewRequest>(
  reviewFn: (req: T) => Promise<ReviewResult>,
  generateFn: (feedback: string | undefined, attempt: number) => Promise<T>,
  initialReq: T,
  maxAttempts = 2,
): Promise<{ approved: boolean; attempts: number; finalResult: ReviewResult; lastRequest: T }> {
  let attempt = 0;
  let req: T = initialReq;
  let result: ReviewResult = { approved: false, feedback: "not reviewed", reviewTime: 0 };
  while (attempt < maxAttempts) {
    attempt++;
    result = await reviewFn(req);
    await logReview("retry-cap", { workerAgent: req.workerAgent, action: req.action, content: req.content }, result);
    if (result.approved) {
      return { approved: true, attempts: attempt, finalResult: result, lastRequest: req };
    }
    if (attempt >= maxAttempts) break;
    // Regenerate using the supervisor's feedback and re-review.
    try { req = await generateFn(result.feedback, attempt); }
    catch (err) {
      logger.error("supervisor.retry-cap.generate-failed", { attempt, error: String(err) });
      break;
    }
  }
  // Exhausted the hard cap — escalate rather than loop forever.
  try {
    await createEscalation(
      req.workerAgent,
      "quality",
      `Supervisor hard cap (${maxAttempts}) reached without approval`,
      { lastFeedback: (result.feedback || "").slice(0, 300), action: req.action },
      "high",
    );
  } catch (err) { logger.error("supervisor.retry-cap.escalate-failed", { error: String(err) }); }
  return { approved: false, attempts: attempt, finalResult: result, lastRequest: req };
}
