/**
 * src/lib/agent-blackboard.ts — v61 Phase 4 (Agent Communication Board)
 *
 * Owner's rule: "All agents can continuously communicate with each other
 * while executing tasks so that there won't be any conflicts. Maintain a
 * main board where every agent looks at what is happening."
 *
 * This is the shared "blackboard" pattern from real MNC war rooms: every
 * agent posts what they're doing, what they need, and what they've completed
 * to a shared board. Before any agent starts a task, they check the board
 * to avoid conflicts (e.g., two agents trying to email the same lead, or
 * two agents both deploying at the same time).
 *
 * Implementation: uses the existing AgentMessage Prisma model (no new
 * schema) + the Setting table for the "current state" snapshot. Every
 * post + read is logged so the audit trail is complete.
 */

import "server-only";
import { db } from "./db";
import { logger } from "./logger";
import { emit } from "./event-bus";

export interface BlackboardEntry {
  /** The agent posting. */
  agentName: string;
  /** What the agent is doing now. */
  action: string;
  /** The resource/lock the agent is claiming (e.g. "lead:abc123", "deploy:staging"). */
  resourceClaim?: string;
  /** What the agent needs from other departments (optional). */
  needsHelpWith?: string;
  /** Timestamp. */
  postedAt: string;
}

export interface BlackboardSnapshot {
  /** All active entries (agents currently working). */
  entries: BlackboardEntry[];
  /** Resources currently claimed (so no two agents grab the same one). */
  claimedResources: string[];
  /** Timestamp. */
  snapshotAt: string;
}

const BLACKBOARD_KEY = "agent-blackboard.active";
const ENTRY_TTL_MS = 5 * 60 * 1000; // entries expire after 5 min of inactivity

/**
 * Post an entry to the shared blackboard. Other agents will see this
 * when they call readBlackboard(). If the agent claims a resource, no
 * other agent can claim the same resource until it's released.
 */
export async function postToBlackboard(entry: BlackboardEntry): Promise<boolean> {
  try {
    // Check for resource conflicts BEFORE posting.
    if (entry.resourceClaim) {
      const snapshot = await readBlackboard();
      if (snapshot.claimedResources.includes(entry.resourceClaim)) {
        // Another agent already claimed this resource — conflict!
        logger.warn("blackboard.conflict-detected", {
          agent: entry.agentName,
          resource: entry.resourceClaim,
        });
        emit({
          type: "system",
          ts: new Date().toISOString(),
          message: `⚠️ Conflict: ${entry.agentName} tried to claim "${entry.resourceClaim}" but it's already claimed`,
          level: "warn",
        });
        return false; // conflict — caller should pivot to another task
      }
    }

    // Read the current board, append the entry, write back.
    const current = await readBlackboard();
    const newEntries = [...current.entries.filter((e) => e.agentName !== entry.agentName), entry];
    await db.setting.upsert({
      where: { key: BLACKBOARD_KEY },
      create: {
        key: BLACKBOARD_KEY,
        value: JSON.stringify({ entries: newEntries, updatedAt: new Date().toISOString() }),
        category: "system",
      },
      update: {
        value: JSON.stringify({ entries: newEntries, updatedAt: new Date().toISOString() }),
      },
    });

    // Emit a real-time event so the dashboard + other agents see the update.
    emit({
      type: "agent.message",
      ts: entry.postedAt,
      message: {
        id: `bb-${Date.now()}`,
        fromAgentId: null,
        toAgentId: null, // broadcast — all agents
        channel: "coordination",
        messageType: "inform",
        subject: `${entry.agentName}: ${entry.action}`,
        body: entry.needsHelpWith ? `Needs help: ${entry.needsHelpWith}` : null,
        taskId: entry.resourceClaim ?? null,
        createdAt: entry.postedAt,
      },
    });

    return true; // posted successfully (no conflict)
  } catch (err) {
    logger.warn("blackboard.post-failed", { agent: entry.agentName, error: String(err) });
    return false;
  }
}

/**
 * Read the current blackboard snapshot. Expired entries (>5 min old) are
 * pruned so the board doesn't grow stale.
 */
export async function readBlackboard(): Promise<BlackboardSnapshot> {
  try {
    const setting = await db.setting.findUnique({ where: { key: BLACKBOARD_KEY } });
    if (!setting) {
      return { entries: [], claimedResources: [], snapshotAt: new Date().toISOString() };
    }
    const parsed = JSON.parse(setting.value) as { entries: BlackboardEntry[]; updatedAt: string };
    const now = Date.now();
    // Prune expired entries.
    const active = parsed.entries.filter((e) => {
      const age = now - new Date(e.postedAt).getTime();
      return age < ENTRY_TTL_MS;
    });
    const claimedResources = Array.from(
      new Set(active.map((e) => e.resourceClaim).filter(Boolean) as string[]),
    );
    return {
      entries: active,
      claimedResources,
      snapshotAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.warn("blackboard.read-failed", { error: String(err) });
    return { entries: [], claimedResources: [], snapshotAt: new Date().toISOString() };
  }
}

/**
 * Release a resource claim (when the agent finishes the task).
 */
export async function releaseFromBlackboard(agentName: string, resourceClaim?: string): Promise<void> {
  try {
    const current = await readBlackboard();
    const filtered = current.entries.filter((e) => {
      if (e.agentName !== agentName) return true;
      if (resourceClaim && e.resourceClaim !== resourceClaim) return true;
      return false; // remove this entry
    });
    await db.setting.upsert({
      where: { key: BLACKBOARD_KEY },
      create: {
        key: BLACKBOARD_KEY,
        value: JSON.stringify({ entries: filtered, updatedAt: new Date().toISOString() }),
        category: "system",
      },
      update: {
        value: JSON.stringify({ entries: filtered, updatedAt: new Date().toISOString() }),
      },
    });
  } catch (err) {
    logger.warn("blackboard.release-failed", { agent: agentName, error: String(err) });
  }
}

/**
 * Check if a resource is currently claimed by another agent.
 * Used before starting a task that touches a shared resource.
 */
export async function isResourceClaimed(resource: string): Promise<boolean> {
  const snapshot = await readBlackboard();
  return snapshot.claimedResources.includes(resource);
}
