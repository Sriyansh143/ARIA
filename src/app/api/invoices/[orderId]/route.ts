import { NextRequest, NextResponse } from "next/server";
import { generateInvoiceData, renderInvoiceHtml } from "@/lib/invoice-generator";
import { requireAuth } from "@/lib/auth";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  try { await requireAuth(); const { orderId }=await params; const data=await generateInvoiceData(orderId);
    if(!data) return NextResponse.json({error:"Order not found"},{status:404});
    return new NextResponse(renderInvoiceHtml(data),{status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"private, no-cache"}});
  } catch(err) { const msg=err instanceof Error?err.message:String(err); if(msg.includes("Unauthorized")) return NextResponse.json({error:"Unauthorized"},{status:401}); return NextResponse.json({error:"internal_error"},{status:500}); }
}
