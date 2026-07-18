// semantic-memory.ts -- In-memory knowledge graph (Phase 2.2 / item 6).
// Lightweight concept + relationship graph (no DB, no embeddings).
// Distinct from src/lib/memory/semantic.ts (which is a vector store).

import { logger } from './logger'

export interface Concept {
  id: string
  label: string
  attributes: Record<string, unknown>
  createdAt: number
}

export interface Relation {
  id: string
  from: string
  to: string
  type: string
  attributes: Record<string, unknown>
  createdAt: number
}

export interface GraphQueryResult {
  concepts: Concept[]
  relations: Relation[]
}

const MAX_CONCEPTS = 2000
const MAX_RELATIONS = 5000

const concepts = new Map<string, Concept>()
const relations: Relation[] = []

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Add a concept. If id exists, label + attributes are merged. */
export function addConcept(
  id: string,
  label: string,
  attributes: Record<string, unknown> = {},
): Concept {
  if (!id) throw new Error('addConcept: id is required')
  const existing = concepts.get(id)
  if (existing) {
    const merged: Concept = {
      ...existing,
      label: label || existing.label,
      attributes: { ...existing.attributes, ...attributes },
    }
    concepts.set(id, merged)
    return merged
  }
  if (concepts.size >= MAX_CONCEPTS) {
    const oldest = concepts.keys().next().value
    if (oldest) {
      concepts.delete(oldest)
      for (let i = relations.length - 1; i >= 0; i--) {
        if (relations[i].from === oldest || relations[i].to === oldest) relations.splice(i, 1)
      }
    }
  }
  const c: Concept = { id, label: label || id, attributes, createdAt: Date.now() }
  concepts.set(id, c)
  return c
}

/** Add a directed relation; auto-creates missing concepts. */
export function addRelation(
  from: string,
  to: string,
  type: string,
  attributes: Record<string, unknown> = {},
): Relation | null {
  if (!from || !to || !type) return null
  if (!concepts.has(from)) addConcept(from, from)
  if (!concepts.has(to)) addConcept(to, to)
  if (relations.length >= MAX_RELATIONS) relations.shift()
  const r: Relation = {
    id: newId('rel'), from, to, type, attributes, createdAt: Date.now(),
  }
  relations.push(r)
  return r
}

/**
 * Query the graph.
 * opts.seed (BFS traversal up to opts.depth), opts.type (filter), opts.limit.
 * Without seed, performs keyword match on labels/ids/attributes.
 */
export function queryGraph(
  query: string,
  opts: { seed?: string; depth?: number; type?: string; limit?: number } = {},
): GraphQueryResult {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50))
  if (opts.seed) {
    const depth = Math.min(5, Math.max(1, opts.depth ?? 2))
    const visited = new Set<string>([opts.seed])
    const matched: Relation[] = []
    let frontier: string[] = [opts.seed]
    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const next: string[] = []
      const frontSet = new Set(frontier)
      for (const r of relations) {
        if (opts.type && r.type !== opts.type) continue
        if (frontSet.has(r.from) && !visited.has(r.to)) {
          visited.add(r.to); next.push(r.to); matched.push(r)
        } else if (frontSet.has(r.to) && !visited.has(r.from)) {
          visited.add(r.from); next.push(r.from); matched.push(r)
        }
      }
      frontier = next
    }
    const out = Array.from(visited)
      .map((id) => concepts.get(id))
      .filter((c): c is Concept => !!c)
      .slice(0, limit)
    return { concepts: out, relations: matched }
  }
  const q = (query || '').trim().toLowerCase()
  const matchedConcepts: Concept[] = []
  for (const c of concepts.values()) {
    if (
      q.length === 0 ||
      c.label.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      JSON.stringify(c.attributes).toLowerCase().includes(q)
    ) {
      matchedConcepts.push(c)
      if (matchedConcepts.length >= limit) break
    }
  }
  const ids = new Set(matchedConcepts.map((c) => c.id))
  const rels = relations.filter(
    (r) => ids.has(r.from) && ids.has(r.to) && (!opts.type || r.type === opts.type),
  )
  return { concepts: matchedConcepts, relations: rels }
}

export function clearGraph(): void {
  concepts.clear()
  relations.length = 0
  logger.info('semantic-memory: graph cleared')
}

export function graphStats(): { concepts: number; relations: number } {
  return { concepts: concepts.size, relations: relations.length }
}
