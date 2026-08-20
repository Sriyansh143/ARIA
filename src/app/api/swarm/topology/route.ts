/**
 * GET /api/swarm/topology — Phase 32
 *
 * Returns the swarm topology: active agents (nodes) + recent messages
 * (edges). Used by the Swarm Topology Visualizer in the dashboard.
 *
 * The visualizer component (`agent-network-graph.tsx`) already exists +
 * reads from `useMissionStore.agentMessages`. This endpoint provides a
 * REST fallback for:
 *   - Initial page load (before SSE connects)
 *   - Components that don't use the Zustand store
 *   - External monitoring tools / dashboards
 *
 * RESPONSE SHAPE
 * --------------
 * {
 *   agents: [{ id, role, status, messageCount, lastActiveAt }],
 *   edges: [{ from, to, count, lastMessageAt, lastSubject }],
 *   recentMessages: [{ id, from, to, type, subject, body, createdAt }],
 *   stats: { totalMessages, broadcastCount, activeAgents, topSenders, topRecipients }
 * }
 *
 * QUERY PARAMS
 * ------------
 *   ?messages=50       — max recent messages (default 50, max 200)
 *   ?since=<iso-date>  — only messages since this date
 *   ?activeOnly=true   — only include agents that sent/received a message in the last 24h
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSwarmStats } from "@/lib/swarm/agent-bus";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const messageLimit = Math.min(parseInt(sp.get("messages") ?? "50", 10) || 50, 200);
    const sinceStr = sp.get("since");
    const activeOnly = sp.get("activeOnly") === "true";

    const since = sinceStr ? new Date(sinceStr) : undefined;
    if (sinceStr && (!since || !Number.isFinite(since.getTime()))) {
      return NextResponse.json({ error: "invalid 'since' date" }, { status: 400 });
    }

    // ─── 1. Fetch recent messages ────────────────────────────────────
    const recentMessageRows = await db.agentMessage.findMany({
      where: since ? { createdAt: { gte: since } } : undefined,
      orderBy: { createdAt: "desc" },
      take: messageLimit,
    });

    const recentMessages = recentMessageRows.map((m) => ({
      id: m.id,
      from: m.fromAgentId ?? "unknown",
      to: m.toAgentId ?? "*",
      type: m.messageType,
      channel: m.channel,
      subject: m.subject,
      body: m.body?.slice(0, 500) ?? "",
      createdAt: m.createdAt.toISOString(),
    }));

    // ─── 2. Build agent nodes from messages ─────────────────────────
    // An "agent" is any fromAgentId or toAgentId that appears in the messages.
    const agentMap = new Map<string, {
      id: string;
      sentCount: number;
      receivedCount: number;
      lastActiveAt: Date;
    }>();

    const activeThreshold = activeOnly
      ? new Date(Date.now() - 24 * 60 * 60 * 1000)
      : new Date(0);

    for (const m of recentMessageRows) {
      const from = m.fromAgentId ?? "unknown";
      const to = m.toAgentId ?? "*";

      if (m.createdAt >= activeThreshold) {
        if (!agentMap.has(from)) {
          agentMap.set(from, { id: from, sentCount: 0, receivedCount: 0, lastActiveAt: m.createdAt });
        }
        const fromAgent = agentMap.get(from)!;
        fromAgent.sentCount++;
        if (m.createdAt > fromAgent.lastActiveAt) fromAgent.lastActiveAt = m.createdAt;

        if (to !== "*") {
          if (!agentMap.has(to)) {
            agentMap.set(to, { id: to, sentCount: 0, receivedCount: 0, lastActiveAt: m.createdAt });
          }
          const toAgent = agentMap.get(to)!;
          toAgent.receivedCount++;
          if (m.createdAt > toAgent.lastActiveAt) toAgent.lastActiveAt = m.createdAt;
        }
      }
    }

    // Also fetch agents from the Agent table (for role + status info).
    const agentRows = await db.agent.findMany({
      select: { id: true, name: true, role: true, status: true, department: true, lastBeatAt: true },
      take: 200,
    });
    const agentInfoMap = new Map<string, { role: string; status: string; department: string | null; lastBeatAt: Date | null }>();
    for (const a of agentRows) {
      agentInfoMap.set(a.id, {
        role: a.role,
        status: a.status,
        department: a.department,
        lastBeatAt: a.lastBeatAt,
      });
    }

    // Merge: agents from messages + agents from the Agent table.
    // If activeOnly is true, only include agents that appear in recentMessageRows.
    const agents = Array.from(agentMap.values()).map((a) => {
      const info = agentInfoMap.get(a.id);
      return {
        id: a.id,
        role: info?.role ?? "unknown",
        status: info?.status ?? "inactive",
        department: info?.department ?? null,
        messageCount: a.sentCount + a.receivedCount,
        sentCount: a.sentCount,
        receivedCount: a.receivedCount,
        lastActiveAt: a.lastActiveAt.toISOString(),
      };
    });

    // If not activeOnly, also include Agent-table agents that have no recent messages.
    if (!activeOnly) {
      for (const [id, info] of agentInfoMap) {
        if (!agentMap.has(id)) {
          agents.push({
            id,
            role: info.role,
            status: info.status,
            department: info.department,
            messageCount: 0,
            sentCount: 0,
            receivedCount: 0,
            lastActiveAt: info.lastBeatAt?.toISOString() ?? new Date(0).toISOString(),
          });
        }
      }
    }

    // ─── 3. Build edges (agent-to-agent message counts) ──────────────
    const edgeMap = new Map<string, {
      from: string;
      to: string;
      count: number;
      lastMessageAt: Date;
      lastSubject: string;
    }>();

    for (const m of recentMessageRows) {
      const from = m.fromAgentId ?? "unknown";
      const to = m.toAgentId ?? "*";
      if (to === "*") continue; // skip broadcasts for edge graph

      const key = `${from}->${to}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { from, to, count: 0, lastMessageAt: m.createdAt, lastSubject: m.subject });
      }
      const edge = edgeMap.get(key)!;
      edge.count++;
      if (m.createdAt > edge.lastMessageAt) {
        edge.lastMessageAt = m.createdAt;
        edge.lastSubject = m.subject;
      }
    }

    const edges = Array.from(edgeMap.values()).map((e) => ({
      ...e,
      lastMessageAt: e.lastMessageAt.toISOString(),
    }));

    // ─── 4. Fetch summary stats ─────────────────────────────────────
    const stats = await getSwarmStats();

    return NextResponse.json({
      agents,
      edges,
      recentMessages,
      stats,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("api.swarm.topology.failed", { error: String(err) });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
