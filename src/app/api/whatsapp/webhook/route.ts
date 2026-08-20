import { NextRequest, NextResponse } from "next/server";
import { verifyWhatsAppWebhookSignature } from "@/lib/whatsapp/business";
import { logger } from "@/lib/logger";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(req: NextRequest) {
  try { const mode=req.nextUrl.searchParams.get("hub.mode"); const token=req.nextUrl.searchParams.get("hub.verify_token"); const challenge=req.nextUrl.searchParams.get("hub.challenge");
    const expected=process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if(!expected) return NextResponse.json({error:"Not configured"},{status:503});
    if(mode==="subscribe"&&token===expected) return new NextResponse(challenge,{status:200,headers:{"Content-Type":"text/plain"}});
    return NextResponse.json({error:"Verification failed"},{status:403});
  } catch { return NextResponse.json({error:"internal_error"},{status:500}); }
}
export async function POST(req: NextRequest) {
  try { const rawBody=await req.text(); const signature=req.headers.get("x-hub-signature-256")||"";
    const appSecret=process.env.WHATSAPP_APP_SECRET;
    if(!appSecret) return NextResponse.json({error:"Not configured"},{status:503});
    if(!verifyWhatsAppWebhookSignature(rawBody,signature,appSecret)) return NextResponse.json({error:"Invalid signature"},{status:401});
    const body=JSON.parse(rawBody); const entry=body.entry?.[0]; const change=entry?.changes?.[0]; const message=change?.value?.messages?.[0];
    if(!message) return NextResponse.json({ok:true,type:"status_update"});
    const from=message.from; const text=message.text?.body||""; const messageId=message.id;
    logger.info("whatsapp.webhook.inbound",{from,text:text.slice(0,80)});
    try { const { handleSupportMessage }=await import("@/lib/support-agent"); const result=await handleSupportMessage({message:text,customerPhone:from,channel:"whatsapp"});
      const { sendWhatsAppMessage }=await import("@/lib/whatsapp/business"); await sendWhatsAppMessage({to:`+${from}`,text:result.response});
      logger.info("whatsapp.webhook.auto-responded",{from,intent:result.intent,escalated:result.escalated});
    } catch(err) { logger.error("whatsapp.webhook.support-failed",{error:String(err)}); }
    return NextResponse.json({ok:true});
  } catch { return NextResponse.json({error:"internal_error"},{status:500}); }
}
