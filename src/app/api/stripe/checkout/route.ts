import { NextRequest, NextResponse } from "next/server";
import { createStripeCheckoutSession, isStripeConfigured } from "@/lib/stripe-checkout";
import { getService } from "@/lib/services/catalog";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function POST(req: NextRequest) {
  try { if(!isStripeConfigured()) return NextResponse.json({error:"Stripe not configured",configured:false},{status:503});
    const body=await req.json().catch(()=>({})); const {serviceId,spec,customerEmail}=body;
    if(!serviceId) return NextResponse.json({error:"serviceId required"},{status:400});
    if(!spec||spec.length<10||spec.length>5000) return NextResponse.json({error:"spec must be 10-5000 chars"},{status:400});
    const service=getService(serviceId); if(!service) return NextResponse.json({error:`Unknown service: ${serviceId}`},{status:400});
    const { db }=await import("@/lib/db");
    const order=await db.serviceOrder.create({data:{serviceId:service.id,serviceName:service.name,spec,priceCents:service.priceCents,currency:"usd",status:"pending_payment",cryptoNetwork:"stripe",walletAddress:"stripe",customerEmail:customerEmail||null,ownerApproved:false}});
    const result=await createStripeCheckoutSession({serviceId:service.id,serviceName:service.name,priceCents:service.priceCents,orderId:order.id,customerEmail});
    if(!result.ok) { await db.serviceOrder.update({where:{id:order.id},data:{status:"failed",buildLog:`Stripe failed: ${result.error}`}}); return NextResponse.json({error:result.error},{status:502}); }
    return NextResponse.json({ok:true,orderId:order.id,url:result.url,sessionId:result.sessionId});
  } catch { return NextResponse.json({error:"internal_error"},{status:500}); }
}
