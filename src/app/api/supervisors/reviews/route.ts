import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuthOrResponse } from "@/lib/auth";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(req: NextRequest) {
  try { const auth=await requireAuthOrResponse("GET","/api/supervisors/reviews"); if(auth)return auth;
    const [reviews,escalations,stats]=await Promise.all([
      db.supervisorReview.findMany({orderBy:{createdAt:"desc"},take:50}),
      db.escalation.findMany({where:{status:"escalated_to_owner"},orderBy:{createdAt:"desc"},take:20}),
      db.supervisorReview.groupBy({by:["supervisor","approved"],_count:true}),
    ]);
    return NextResponse.json({reviews,escalations,stats});
  } catch { return NextResponse.json({error:"internal_error"},{status:500}); }
}
