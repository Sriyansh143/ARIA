import { NextRequest, NextResponse } from "next/server";
import { runDailyEarningResearch, getTodayOpportunities } from "@/lib/hermes/earning-researcher";

export const dynamic = "force-dynamic";

export async function GET() {
  try {

  const opportunities = await getTodayOpportunities(20);
  return NextResponse.json({ opportunities, count: opportunities.length });

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {

  const body = await req.json();
  if (body.run) {
    const result = await runDailyEarningResearch();
    return NextResponse.json(result);
  }
  return NextResponse.json({ error: "Pass {run:true} to trigger research" }, { status: 400 });

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
