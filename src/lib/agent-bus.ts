/**
 * src/lib/agent-bus.ts — inter-agent messaging via db.agentMessage + SSE.
 *
 * Server-only. Records every agent-to-agent message in the AgentMessage
 * table (audit log) and simultaneously emits an `agent.message` SSE event
 * so the dashboard can render live inter-agent chatter.
 *
 * Includes a blackboard pattern: agents can post ephemeral key/value
 * pairs to a shared MemoryItem (scope="blackboard") for coordination
 * without a direct message round-trip.
 */

import type { AgentMessage } from "@prisma/client";
import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";
import { toIso } from "./types";

export interface SendDirectInput {
  fromAgentId: string;
  toAgentId: string;
  channel?: string;
  subject: string;
  body?: string;
  taskId?: string;
  messageType?: string;
}

function serialize(m: AgentMessage) {
  return {
    id: m.id,
    fromAgentId: m.fromAgentId,
    toAgentId: m.toAgentId,
    // Prisma returns `string`; cast back to the strict union the SSE type expects.
    channel: m.channel as "task" | "approval" | "alert" | "coordination" | "broadcast",
    messageType: m.messageType as "request" | "response" | "delegate" | "inform" | "escalate",
    subject: m.subject,
    body: m.body,
    taskId: m.taskId,
    createdAt: toIso(m.createdAt)!,
  };
}

// ─── sendDirect ─────────────────────────────────────────────────────

export async function sendDirect(
  input: SendDirectInput
): Promise<{ id: string }> {
  try {
    const row = await db.agentMessage.create({
      data: {
        fromAgentId: input.fromAgentId,
        toAgentId: input.toAgentId,
        channel: input.channel ?? "task",
        messageType: input.messageType ?? "inform",
        subject: input.subject,
        body: input.body ?? null,
        taskId: input.taskId ?? null,
      },
    });
    emit({
      type: "agent.message",
      ts: new Date().toISOString(),
      message: serialize(row),
    });
    logger.info("agent-bus.direct.sent", {
      from: input.fromAgentId,
      to: input.toAgentId,
      channel: input.channel ?? "task",
    });
    return { id: row.id };
  } catch (err) {
    logger.error("agent-bus.direct.failed", {
      from: input.fromAgentId,
      to: input.toAgentId,
      error: String(err),
    });
    throw err;
  }
}

// ─── broadcast ──────────────────────────────────────────────────────

export async function broadcast(
  input: {
    fromAgentId: string;
    channel?: string;
    subject: string;
    body?: string;
  }
): Promise<{ id: string }> {
  try {
    const row = await db.agentMessage.create({
      data: {
        fromAgentId: input.fromAgentId,
        toAgentId: "broadcast",
        channel: input.channel ?? "broadcast",
        messageType: "inform",
        subject: input.subject,
        body: input.body ?? null,
      },
    });
    emit({
      type: "agent.message",
      ts: new Date().toISOString(),
      message: serialize(row),
    });
    logger.info("agent-bus.broadcast.sent", {
      from: input.fromAgentId,
      channel: input.channel ?? "broadcast",
    });
    return { id: row.id };
  } catch (err) {
    logger.error("agent-bus.broadcast.failed", {
      from: input.fromAgentId,
      error: String(err),
    });
    throw err;
  }
}

// ─── listInbox ──────────────────────────────────────────────────────

export async function listInbox(
  agentId: string,
  limit = 50
): Promise<AgentMessage[]> {
  try {
    return await db.agentMessage.findMany({
      where: {
        OR: [
          { toAgentId: agentId },
          { toAgentId: "broadcast" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
    });
  } catch (err) {
    logger.error("agent-bus.inbox.failed", { agentId, error: String(err) });
    return [];
  }
}

// ─── postBlackboard ─────────────────────────────────────────────────

export async function postBlackboard(
  key: string,
  value: unknown
): Promise<void> {
  try {
    const existing = await db.memoryItem.findUnique({ where: { key } });
    if (existing) {
      await db.memoryItem.update({
        where: { key },
        data: {
          value: JSON.stringify(value),
          updatedAt: new Date(),
        },
      });
    } else {
      await db.memoryItem.create({
        data: {
          key,
          scope: "blackboard",
          value: JSON.stringify(value),
          tags: JSON.stringify(["blackboard", "agent-bus"]),
        },
      });
    }
    logger.info("agent-bus.blackboard.posted", { key });
  } catch (err) {
    logger.error("agent-bus.blackboard.failed", { key, error: String(err) });
  }
}
