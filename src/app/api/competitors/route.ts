import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuthOrResponse } from "@/lib/auth";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(req: NextRequest) {
  try { const auth=await requireAuthOrResponse("GET","/api/competitors"); if(auth)return auth;
    const competitors=await db.competitorAnalysis.findMany({orderBy:{analyzedAt:"desc"},take:20});
    return NextResponse.json({competitors,count:competitors.length});
  } catch { return NextResponse.json({error:"internal_error"},{status:500}); }
}
