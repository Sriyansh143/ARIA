import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { listServers, registerServer, callTool } from "@/lib/mcp-client";

export const dynamic = "force-dynamic";

/**
 * GET /api/mcp-client — list registered MCP servers.
 */
export async function GET() {
  try {
    const servers = await listServers();
    return NextResponse.json({ servers, count: servers.length });
  } catch (err) {
    logger.error("api.mcp-client.list.failed", { error: String(err) });
    return NextResponse.json(
      { error: "failed to list MCP servers" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mcp-client
 * Body:
 *   { action: "register", name, url, tools? }
 *   { action: "call", server, tool, args }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body?.action ?? "");

    if (action === "register") {
      if (!body?.name || !body?.url) {
        return NextResponse.json(
          { error: "name + url required" },
          { status: 400 }
        );
      }
      const result = await registerServer({
        name: String(body.name),
        url: String(body.url),
        tools: Array.isArray(body.tools) ? body.tools : [],
      });
      return NextResponse.json(result);
    }

    if (action === "call") {
      if (!body?.server || !body?.tool) {
        return NextResponse.json(
          { error: "server + tool required" },
          { status: 400 }
        );
      }
      const result = await callTool({
        server: String(body.server),
        tool: String(body.tool),
        args: (body.args ?? {}) as Record<string, unknown>,
      });
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: "action must be register or call" },
      { status: 400 }
    );
  } catch (err) {
    logger.error("api.mcp-client.action.failed", { error: String(err) });
    return NextResponse.json(
      { error: "MCP action failed" },
      { status: 500 }
    );
  }
}
