import { NextRequest, NextResponse } from "next/server";
import { handleStripeWebhook } from "@/lib/stripe-checkout";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function POST(req: NextRequest) {
  try { const rawBody=await req.text(); const signature=req.headers.get("stripe-signature")||"";
    if(!signature) return NextResponse.json({error:"Missing stripe-signature header"},{status:401});
    const result=await handleStripeWebhook(rawBody,signature);
    if(!result.ok) return NextResponse.json({error:result.error},{status:400});
    return NextResponse.json({ok:true,event:result.event});
  } catch { return NextResponse.json({error:"internal_error"},{status:500}); }
}
