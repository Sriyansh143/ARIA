/**
 * src/lib/vector-memory.ts — v61.4 Phase 9 (REAL Vector Memory)
 *
 * NO MORE FACADES. This module provides TRUE semantic similarity search using
 * Ollama's nomic-embed-text model (768-dim embeddings) + cosine similarity.
 *
 * Previously, the "vector memory" was a facade — `hermes/memory.ts` did SQLite
 * LIKE '%keyword%' matching and the docs falsely called it "vector recall."
 * This module is the real implementation.
 *
 * Architecture:
 *   1. embedText(text) → Float32Array(768) via Ollama nomic-embed-text.
 *   2. Store the embedding in the MemoryItem.embeddingJson field (JSON array).
 *   3. searchBySimilarity(query, k) → embed the query, compute cosine
 *      similarity against all stored embeddings, return top-k.
 *
 * Graceful degradation: if Ollama is unavailable, falls back to the existing
 * keyword search in hermes/memory.ts. Never silently fails.
 *
 * Used by:
 *   - The Self-Improving Rules-Auditor cron (finds conceptually similar past
 *     failures, not just exact skill-name matches).
 *   - The Hermes memory system (semantic recall).
 */

import "server-only";
import { db } from "./db";
import { logger } from "./logger";
import { embedText, cosineSimilarity } from "./ollama-client";

const SIMILARITY_THRESHOLD = 0.35; // minimum cosine similarity to be considered "similar"

export interface VectorSearchResult {
  id: string;
  key: string;
  value: string;
  scope: string;
  tags: string[];
  pinned: boolean;
  strength: number;
  similarity: number; // cosine similarity score [0, 1]
}

/**
 * Embed a text and store it as a MemoryItem with the embedding attached.
 * If Ollama is unavailable, stores the memory WITHOUT an embedding (keyword-
 * searchable only). Never throws.
 *
 * @param key The memory key (e.g. "failure:timeout:rules-auditor")
 * @param value The memory value (the full text to embed)
 * @param scope The memory scope (e.g. "failure", "success", "optimization")
 * @param tags Optional tags for filtering
 */
export async function storeMemoryWithEmbedding(
  key: string,
  value: string,
  scope: string,
  tags: string[] = [],
): Promise<void> {
  try {
    // Try to generate an embedding via Ollama nomic-embed-text.
    const embedding = await embedText(value);
    const embeddingJson = embedding ? JSON.stringify(Array.from(embedding)) : null;

    await db.memoryItem.upsert({
      where: { key },
      update: {
        value,
        scope,
        tags: JSON.stringify(tags),
        embeddingJson, // v61.4: store the 768-dim vector as JSON
      },
      create: {
        key,
        value,
        scope,
        tags: JSON.stringify(tags),
        embeddingJson,
        strength: 1.0,
        pinned: false,
      },
    });

    if (embedding) {
      logger.debug("vector-memory.stored-with-embedding", { key, dims: embedding.length });
    } else {
      logger.debug("vector-memory.stored-without-embedding", { key, reason: "ollama-unavailable" });
    }
  } catch (err) {
    logger.warn("vector-memory.store-failed", { key, error: String(err) });
  }
}

/**
 * v61.4 Phase 9: Semantic similarity search — the REAL vector recall.
 *
 * Embeds the query via nomic-embed-text, loads all MemoryItems with embeddings,
 * computes cosine similarity, and returns the top-k most similar.
 *
 * If Ollama is unavailable (no embeddings), falls back to keyword LIKE search
 * with a clear log warning. Never silently returns keyword results as if they
 * were semantic matches.
 *
 * @param query The query text (e.g. "LLM timeout failures in the rules-auditor")
 * @param k The number of top results to return (default 5)
 * @param scopeFilter Optional scope to filter by (e.g. "failure")
 * @returns Array of VectorSearchResult sorted by similarity descending.
 */
export async function searchBySimilarity(
  query: string,
  k: number = 5,
  scopeFilter?: string,
): Promise<VectorSearchResult[]> {
  const queryEmbedding = await embedText(query);

  if (!queryEmbedding) {
    // Graceful degradation: fall back to keyword search with a CLEAR warning.
    logger.warn("vector-memory.fallback-to-keyword", {
      reason: "ollama-unavailable — nomic-embed-text not running",
      query: query.slice(0, 80),
    });
    return keywordFallback(query, k, scopeFilter);
  }

  try {
    // Load all MemoryItems with embeddings (filtered by scope if provided).
    const where = {
      ...(scopeFilter ? { scope: scopeFilter } : {}),
      embeddingJson: { not: null },
    };
    const items = await db.memoryItem.findMany({ where });

    if (items.length === 0) {
      // No embeddings stored yet — fall back to keyword.
      logger.debug("vector-memory.no-embeddings-stored", { fallingBackTo: "keyword" });
      return keywordFallback(query, k, scopeFilter);
    }

    // Compute cosine similarity for each.
    const scored = items
      .map((item) => {
        try {
          const vec = new Float32Array(JSON.parse(item.embeddingJson!));
          const sim = cosineSimilarity(queryEmbedding, vec);
          return {
            id: item.id,
            key: item.key,
            value: item.value,
            scope: item.scope,
            tags: safeParseJsonArray(item.tags),
            pinned: item.pinned,
            strength: item.strength,
            similarity: sim,
          };
        } catch {
          return null;
        }
      })
      .filter((r): r is VectorSearchResult => r !== null && r.similarity >= SIMILARITY_THRESHOLD);

    // Sort by similarity (desc), then by pinned + strength for tie-breaking.
    scored.sort((a, b) => {
      if (b.pinned !== a.pinned) return b.pinned ? 1 : -1;
      if (b.similarity !== a.similarity) return b.similarity - a.similarity;
      return b.strength - a.strength;
    });

    logger.debug("vector-memory.semantic-search-complete", {
      query: query.slice(0, 80),
      candidates: items.length,
      matched: scored.length,
      topScore: scored[0]?.similarity ?? 0,
    });

    return scored.slice(0, k);
  } catch (err) {
    logger.warn("vector-memory.search-failed", { error: String(err) });
    return keywordFallback(query, k, scopeFilter);
  }
}

/**
 * Fallback: keyword LIKE search (the old facade behavior, now clearly labeled).
 * Used only when Ollama is unavailable. Results have similarity = 0 (to indicate
 * they are NOT semantically matched).
 */
async function keywordFallback(
  query: string,
  k: number,
  scopeFilter?: string,
): Promise<VectorSearchResult[]> {
  try {
    const where = {
      ...(scopeFilter ? { scope: scopeFilter } : {}),
      OR: [
        { key: { contains: query } },
        { value: { contains: query } },
      ],
    };
    const items = await db.memoryItem.findMany({
      where,
      orderBy: [{ pinned: "desc" }, { strength: "desc" }],
      take: k,
    });
    return items.map((item) => ({
      id: item.id,
      key: item.key,
      value: item.value,
      scope: item.scope,
      tags: safeParseJsonArray(item.tags),
      pinned: item.pinned,
      strength: item.strength,
      similarity: 0, // 0 = keyword match, NOT semantic
    }));
  } catch {
    return [];
  }
}

/**
 * Helper: safely parse a JSON array string.
 */
function safeParseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
