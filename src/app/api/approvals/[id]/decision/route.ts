import { NextRequest, NextResponse } from "next/server";
import { evaluateApproval, getApprovalDecision } from "@/lib/approval-decision";

export const dynamic = "force-dynamic";

/** GET — returns the current decision (if evaluated) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {

  const { id } = await params;
  const decision = await getApprovalDecision(id);
  return NextResponse.json({ decision });

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/** POST — triggers evaluation by monitoring agents */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {

  const { id } = await params;
  const decision = await evaluateApproval(id);
  return NextResponse.json({ decision });

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
