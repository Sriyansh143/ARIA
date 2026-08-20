import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppMessage } from "@/lib/whatsapp/business";
import { requireAuthOrResponse } from "@/lib/auth";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function POST(req: NextRequest) {
  try { const auth=await requireAuthOrResponse("POST","/api/whatsapp/send"); if(auth)return auth;
    const body=await req.json().catch(()=>({})); if(!body.to) return NextResponse.json({error:"to required"},{status:400});
    const result=await sendWhatsAppMessage({to:body.to,text:body.text,template:body.template,templateParams:body.templateParams,type:body.template?"template":"text"});
    if(!result.ok) return NextResponse.json({error:result.error},{status:400});
    return NextResponse.json({ok:true,messageId:result.messageId});
  } catch { return NextResponse.json({error:"internal_error"},{status:500}); }
}
