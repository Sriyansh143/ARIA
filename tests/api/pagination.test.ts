/**
 * tests/api/pagination.test.ts — Unit tests for pagination helpers.
 *
 * Tests `parsePagination` (default, custom, max-cap, invalid) and
 * `paginatedResponse` envelope shape.
 *
 * Uses `bun:test`. Constructs a `NextRequest` from a URL string so the
 * searchParams parsing path is exercised end-to-end.
 */
import { describe, test, expect } from "bun:test";
import { NextRequest } from "next/server";

function makeReq(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost"));
}

describe("pagination.parsePagination", () => {
  test("returns defaults when no query params are present", async () => {
    const { parsePagination, DEFAULT_PAGE, DEFAULT_LIMIT } = await import("../../src/lib/pagination");
    const req = makeReq("http://localhost/api/tasks");
    const p = parsePagination(req);
    expect(p.page).toBe(DEFAULT_PAGE);
    expect(p.limit).toBe(DEFAULT_LIMIT);
    expect(p.take).toBe(DEFAULT_LIMIT);
    expect(p.skip).toBe(0);
  });

  test("honours custom page + limit", async () => {
    const { parsePagination } = await import("../../src/lib/pagination");
    const req = makeReq("http://localhost/api/tasks?page=3&limit=25");
    const p = parsePagination(req);
    expect(p.page).toBe(3);
    expect(p.limit).toBe(25);
    expect(p.take).toBe(25);
    expect(p.skip).toBe(50); // (3-1)*25
  });

  test("caps limit at MAX_LIMIT (200)", async () => {
    const { parsePagination, MAX_LIMIT } = await import("../../src/lib/pagination");
    const req = makeReq("http://localhost/api/tasks?page=1&limit=10000");
    const p = parsePagination(req);
    expect(p.limit).toBe(MAX_LIMIT);
    expect(p.limit).toBe(200);
    expect(p.take).toBe(200);
  });

  test("falls back to defaults for invalid (NaN / non-positive) input", async () => {
    const { parsePagination, DEFAULT_PAGE, DEFAULT_LIMIT } = await import("../../src/lib/pagination");
    const req = makeReq("http://localhost/api/tasks?page=abc&limit=-5");
    const p = parsePagination(req);
    expect(p.page).toBe(DEFAULT_PAGE);
    expect(p.limit).toBe(DEFAULT_LIMIT);
  });

  test("computes correct skip for page=10 limit=20", async () => {
    const { parsePagination } = await import("../../src/lib/pagination");
    const req = makeReq("http://localhost/api/tasks?page=10&limit=20");
    const p = parsePagination(req);
    expect(p.skip).toBe(180); // (10-1)*20
    expect(p.take).toBe(20);
  });
});

describe("pagination.paginatedResponse", () => {
  test("produces the standard envelope shape", async () => {
    const { paginatedResponse } = await import("../../src/lib/pagination");
    const data = [1, 2, 3];
    const res = paginatedResponse(data, 100, 2, 10);
    expect(res.data).toBe(data);
    expect(res.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 100,
      totalPages: 10,
      hasMore: true, // 2*10=20 < 100
    });
  });

  test("hasMore=false on the last page", async () => {
    const { paginatedResponse } = await import("../../src/lib/pagination");
    const res = paginatedResponse(["a"], 100, 10, 10);
    expect(res.pagination.hasMore).toBe(false); // 10*10=100, not < 100
  });

  test("totalPages=0 when total=0 (empty state)", async () => {
    const { paginatedResponse } = await import("../../src/lib/pagination");
    const res = paginatedResponse([], 0, 1, 50);
    expect(res.pagination.totalPages).toBe(0);
    expect(res.pagination.hasMore).toBe(false);
    expect(res.pagination.total).toBe(0);
  });

  test("totalPages=ceil(total/limit) for non-even divisions", async () => {
    const { paginatedResponse } = await import("../../src/lib/pagination");
    const res = paginatedResponse([1], 25, 1, 10);
    expect(res.pagination.totalPages).toBe(3); // ceil(25/10)=3
  });
});
