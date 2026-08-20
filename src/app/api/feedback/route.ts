import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function POST(req: NextRequest) {
  try { const body=await req.json().catch(()=>({})); const {orderId,rating,comment}=body;
    if(!orderId||!rating||rating<1||rating>5) return NextResponse.json({error:"orderId and rating (1-5) required"},{status:400});
    const { recordFeedback }=await import("@/lib/intelligence/feedback-loop");
    await recordFeedback(orderId,parseInt(rating),String(comment||""));
    return NextResponse.json({ok:true});
  } catch { return NextResponse.json({error:"internal_error"},{status:500}); }
}
export async function GET(req: NextRequest) {
  try { const { requireAuthOrResponse }=await import("@/lib/auth"); const auth=await requireAuthOrResponse("GET","/api/feedback"); if(auth)return auth;
    const feedback=await db.customerFeedback.findMany({orderBy:{createdAt:"desc"},take:50});
    return NextResponse.json({feedback,count:feedback.length});
  } catch { return NextResponse.json({error:"internal_error"},{status:500}); }
}
