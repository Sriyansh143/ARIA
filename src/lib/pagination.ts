/**
 * src/lib/pagination.ts — Shared pagination helpers for list endpoints.
 *
 * Centralising pagination here means every list route uses the same
 * defaults, the same max-limit cap, and the same response envelope.
 * That makes the OpenAPI spec uniform and lets the dashboard's
 * `<PaginatedList>` primitives assume a single contract.
 *
 * Design:
 *   - Defaults: page=1, limit=50. Max limit=200 (DoS guard).
 *   - `take` / `skip` are Prisma-ready (skip = (page-1) * limit).
 *   - `paginatedResponse` produces the standard envelope:
 *       { data, pagination: { page, limit, total, totalPages, hasMore } }
 *   - All list routes keep backward compatibility: if the caller does
 *     NOT pass `?page=`, the route returns the full list as before
 *     (the route checks `searchParams.has("page")` before calling
 *     these helpers).
 *
 * Task ID: HARDEN-SCALE-DOCS (Task 2).
 */

import type { NextRequest } from "next/server";

// ─── Constants ───────────────────────────────────────────────────────

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

// ─── Types ───────────────────────────────────────────────────────────

export interface PaginationParams {
  /** Prisma `take` — number of rows to return. */
  take: number;
  /** Prisma `skip` — number of rows to skip (offset). */
  skip: number;
  /** 1-indexed page number (echoed from query, default 1). */
  page: number;
  /** Resolved limit (echoed from query, default 50, capped at 200). */
  limit: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

// ─── Parser ──────────────────────────────────────────────────────────

/**
 * Parse `?page=` and `?limit=` from a NextRequest's query string.
 *
 * - Missing / NaN / non-positive values fall back to defaults.
 * - `limit` is clamped to `[1, MAX_LIMIT]`.
 * - `page` is clamped to `>= 1`.
 *
 * Returns Prisma-ready `take` / `skip` plus the resolved `page` and
 * `limit` (so the route can echo them in the response envelope).
 */
export function parsePagination(req: NextRequest): PaginationParams {
  const sp = req.nextUrl.searchParams;

  const pageRaw = parseInt(sp.get("page") ?? "", 10);
  const limitRaw = parseInt(sp.get("limit") ?? "", 10);

  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : DEFAULT_PAGE;
  const limit =
    Number.isFinite(limitRaw) && limitRaw >= 1
      ? Math.min(limitRaw, MAX_LIMIT)
      : DEFAULT_LIMIT;

  return {
    take: limit,
    skip: (page - 1) * limit,
    page,
    limit,
  };
}

/**
 * Build the standard paginated response envelope from a sliced data
 * array + the total row count.
 *
 * `totalPages` is `ceil(total / limit)`; if `total === 0` we return 0
 * (not 1) so the UI can render an empty state.
 */
export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResponse<T> {
  const safeLimit = limit >= 1 ? limit : DEFAULT_LIMIT;
  const totalPages = total === 0 ? 0 : Math.ceil(total / safeLimit);
  return {
    data,
    pagination: {
      page,
      limit: safeLimit,
      total,
      totalPages,
      hasMore: page * safeLimit < total,
    },
  };
}
