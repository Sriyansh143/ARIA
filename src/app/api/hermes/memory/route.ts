import { NextRequest, NextResponse } from "next/server";
import { searchMemory, storeMemory } from "@/lib/hermes/memory";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const agentId = req.nextUrl.searchParams.get("agentId") ?? undefined;
  const scope = req.nextUrl.searchParams.get("scope") ?? undefined;
  const results = await searchMemory(q, agentId, scope, 10);
  return NextResponse.json({ results, count: results.length });

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {

  const body = await req.json();
  await storeMemory(body.key, body.value, body.scope, body.agentId, body.tags);
  return NextResponse.json({ ok: true });

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
