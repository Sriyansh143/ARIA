import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuthOrResponse } from "@/lib/auth";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(req: NextRequest) {
  try { const auth=await requireAuthOrResponse("GET","/api/expansion/earning-methods"); if(auth)return auth;
    const status=req.nextUrl.searchParams.get("status"); const where=status?{status}:{};
    const methods=await db.earningMethod.findMany({where,orderBy:{compositeScore:"desc"},take:50});
    return NextResponse.json({methods,count:methods.length});
  } catch { return NextResponse.json({error:"internal_error"},{status:500}); }
}
export async function POST(req: NextRequest) {
  try { const auth=await requireAuthOrResponse("POST","/api/expansion/earning-methods"); if(auth)return auth;
    const body=await req.json().catch(()=>({})); const {id,action}=body;
    if(!id||!action) return NextResponse.json({error:"id and action required"},{status:400});
    const m=await db.earningMethod.findUnique({where:{id}}); if(!m) return NextResponse.json({error:"not found"},{status:404});
    if(action==="approve") { await db.earningMethod.update({where:{id},data:{status:"approved"}}); return NextResponse.json({ok:true,status:"approved"}); }
    if(action==="reject") { await db.earningMethod.update({where:{id},data:{status:"rejected"}}); return NextResponse.json({ok:true,status:"rejected"}); }
    return NextResponse.json({error:"invalid action"},{status:400});
  } catch { return NextResponse.json({error:"internal_error"},{status:500}); }
}
