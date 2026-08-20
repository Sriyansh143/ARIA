import { NextRequest, NextResponse } from "next/server";
import { parseHermesXML, executeToolCall, type ToolContext } from "@/lib/hermes/toolsets";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {

  const body = await req.json();
  const { content, agentId, agentRole, taskId } = body;
  
  if (!content) return NextResponse.json({ error: "Missing content" }, { status: 400 });
  
  const calls = parseHermesXML(content);
  if (calls.length === 0) {
    return NextResponse.json({ calls: [], results: [] });
  }
  
  const context: ToolContext = { agentId: agentId ?? "system", agentRole: agentRole ?? "Conductor", taskId };
  const results = await Promise.all(calls.map(c => executeToolCall(c, context)));
  
  return NextResponse.json({ calls, results });

  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
