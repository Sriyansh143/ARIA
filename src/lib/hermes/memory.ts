/**
 * src/lib/hermes/memory.ts — Persistent Memory & Context Compression
 *
 * Native TypeScript port of Hermes' memory system.
 *
 * Features:
 *   1. Hybrid search (text LIKE + strength/pinned re-ranking)
 *   2. Lossy context compression (summarize oldest messages when >80% window)
 *   3. Memory graph edges (linkMemories)
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Hybrid memory search — text search + strength/pinned re-ranking.
 *
 * SQLite doesn't have FTS5 enabled by default in Prisma, so we use
 * LIKE queries with case-insensitive matching. Results are re-ranked
 * by strength + pinned status.
 */
export async function searchMemory(
  query: string,
  agentId?: string,
  scope?: string,
  limit = 10,
): Promise<
  Array<{
    id: string;
    key: string;
    scope: string;
    value: string;
    tags: string[];
    pinned: boolean;
    strength: number;
    agentId: string | null;
    createdAt: Date;
  }>
> {
  try {
    const terms = query
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .map((t) => `%${t}%`);

    if (terms.length === 0) return [];

    // Build OR conditions for each search term
    const whereClauses: string[] = [];
    const params: unknown[] = [];
    for (const term of terms) {
      whereClauses.push("(key LIKE ? OR value LIKE ?)");
      params.push(term, term);
    }
    if (agentId) {
      whereClauses.push("agentId = ?");
      params.push(agentId);
    }
    if (scope) {
      whereClauses.push("scope = ?");
      params.push(scope);
    }

    // Raw query via Prisma's $queryRawUnsafe for flexible LIKE matching.
    // All user input is parameterised via `?` placeholders + `params[]` —
    // no string concatenation of user values into the SQL.
    params.push(limit);
    const sql = `SELECT * FROM MemoryItem WHERE ${whereClauses.join(" AND ")} ORDER BY pinned DESC, strength DESC, createdAt DESC LIMIT ?`;
    const results = await db.$queryRawUnsafe<
      Array<{
        id: string;
        key: string;
        scope: string;
        value: string;
        tags: string;
        pinned: number;
        strength: number;
        agentId: string | null;
        createdAt: Date;
      }>
    >(sql, ...params);

    return results.map((r) => ({
      id: r.id,
      key: r.key,
      scope: r.scope,
      value: r.value,
      tags: r.tags ? JSON.parse(r.tags) : [],
      pinned: Boolean(r.pinned),
      strength: r.strength,
      agentId: r.agentId,
      createdAt: r.createdAt,
    }));
  } catch (err) {
    logger.warn("hermes-memory.search.error", { query, error: String(err) });
    return [];
  }
}

/**
 * Store a memory — create or update by key+scope.
 * If key+scope exists, update value + bump strength.
 */
export async function storeMemory(
  key: string,
  value: string,
  scope: string,
  agentId?: string,
  tags?: string[],
): Promise<void> {
  try {
    const existing = await db.memoryItem.findFirst({
      where: { key, scope },
    });

    if (existing) {
      // Update + bump strength (learning: memory gets stronger with reuse)
      const newStrength = Math.min(1.0, existing.strength + 0.1);
      await db.memoryItem.update({
        where: { id: existing.id },
        data: {
          value,
          strength: newStrength,
          tags: tags ? JSON.stringify(tags) : existing.tags,
          agentId: agentId ?? existing.agentId,
        },
      });
    } else {
      await db.memoryItem.create({
        data: {
          key,
          scope,
          value,
          tags: JSON.stringify(tags ?? []),
          strength: 0.5,
          agentId: agentId ?? null,
        },
      });
    }
  } catch (err) {
    logger.warn("hermes-memory.store.error", { key, scope, error: String(err) });
  }
}

/**
 * Estimate token count for a message array (rough: chars / 4).
 */
export function estimateTokens(messages: ChatMessage[]): number {
  return Math.ceil(
    messages.reduce((sum, m) => sum + m.content.length, 0) / 4,
  );
}

/**
 * Lossy context compression — Hermes algorithm.
 *
 * If the messages array exceeds 80% of maxTokens, summarize the oldest
 * N messages into a single system message using the LLM. Keep the most
 * recent messages intact.
 *
 * @param messages The conversation messages
 * @param maxTokens The context window size (default 8192)
 * @returns Compressed messages array
 */
export async function compressContext(
  messages: ChatMessage[],
  maxTokens = 8192,
): Promise<ChatMessage[]> {
  try {
    const currentTokens = estimateTokens(messages);
    const threshold = Math.floor(maxTokens * 0.8);

    if (currentTokens <= threshold) {
      return messages; // No compression needed
    }

    // Keep the system prompt (first message) + most recent messages
    const systemMsg = messages.find((m) => m.role === "system");
    const recentCount = Math.max(4, Math.floor(messages.length * 0.3));
    const toCompress = messages.slice(
      systemMsg ? 1 : 0,
      messages.length - recentCount,
    );
    const recent = messages.slice(messages.length - recentCount);

    if (toCompress.length < 2) {
      return messages; // Not enough to compress
    }

    // Summarize the older messages
    const { callLLM } = await import("@/lib/llm-client");
    const summaryPrompt = `Summarize the following conversation context into a concise summary that preserves key facts, decisions, and context needed for continuing the task:\n\n${toCompress.map((m) => `[${m.role}]: ${m.content}`).join("\n\n")}`;

    const result = await callLLM("Context-Compressor", "Conductor", summaryPrompt, {
      maxRetries: 1,
    });

    const compressed: ChatMessage[] = [];
    if (systemMsg) compressed.push(systemMsg);
    compressed.push({
      role: "system",
      content: `[Compressed Context — ${toCompress.length} messages summarized]: ${result.content}`,
    });
    compressed.push(...recent);

    logger.info("hermes-memory.compressed", {
      originalMessages: messages.length,
      compressedMessages: compressed.length,
      originalTokens: currentTokens,
      compressedTokens: estimateTokens(compressed),
    });

    return compressed;
  } catch (err) {
    logger.warn("hermes-memory.compress.error", { error: String(err) });
    return messages; // Return original on failure
  }
}

/**
 * Link two memories (create a graph edge).
 */
export async function linkMemories(
  sourceId: string,
  targetId: string,
  strength = 0.7,
): Promise<void> {
  try {
    const source = await db.memoryItem.findUnique({ where: { id: sourceId } });
    if (!source) return;

    const linkedTo = source.linkedTo ? JSON.parse(source.linkedTo) : [];
    if (!linkedTo.includes(targetId)) {
      linkedTo.push(targetId);
      await db.memoryItem.update({
        where: { id: sourceId },
        data: { linkedTo: JSON.stringify(linkedTo), strength },
      });
    }
  } catch (err) {
    logger.warn("hermes-memory.link.error", { sourceId, targetId, error: String(err) });
  }
}
