import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuthOrResponse } from "@/lib/auth";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(req: NextRequest) {
  try { const auth=await requireAuthOrResponse("GET","/api/expansion/service-opportunities"); if(auth)return auth;
    const status=req.nextUrl.searchParams.get("status"); const where=status?{status}:{};
    const opportunities=await db.serviceOpportunity.findMany({where,orderBy:{compositeScore:"desc"},take:50});
    return NextResponse.json({opportunities,count:opportunities.length});
  } catch { return NextResponse.json({error:"internal_error"},{status:500}); }
}
export async function POST(req: NextRequest) {
  try { const auth=await requireAuthOrResponse("POST","/api/expansion/service-opportunities"); if(auth)return auth;
    const body=await req.json().catch(()=>({})); const {id,action}=body;
    if(!id||!action) return NextResponse.json({error:"id and action required"},{status:400});
    const opp=await db.serviceOpportunity.findUnique({where:{id}}); if(!opp) return NextResponse.json({error:"not found"},{status:404});
    if(action==="approve") {
      // v65 Phase 15: Run the pre-publish quality gate IMMEDIATELY (RULE-51).
      // The service is NOT published until the gate passes (score >= 70).
      const { runPrePublishGate } = await import("@/lib/pre-publish-gate");
      const gateResult = await runPrePublishGate(id);
      return NextResponse.json({ ok: true, gate: gateResult });
    }
    if(action==="reject") { await db.serviceOpportunity.update({where:{id},data:{status:"rejected"}}); return NextResponse.json({ok:true,status:"rejected"}); }
    return NextResponse.json({error:"invalid action"},{status:400});
  } catch { return NextResponse.json({error:"internal_error"},{status:500}); }
}
