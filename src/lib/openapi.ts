/**
 * src/lib/openapi.ts — OpenAPI 3.0 spec generator.
 *
 * Walks the `API_ROUTES` registry in `central-registry.ts` and emits
 * a valid OpenAPI 3.0 document that Swagger UI, Postman, Redoc, or
 * any other OpenAPI consumer can ingest at `GET /api/openapi`.
 *
 * Why generate from the registry instead of hand-authoring YAML?
 *   - The registry is the single source of truth — every route that
 *     exists in code is automatically documented. No drift.
 *   - Adding a route only requires appending one line to API_ROUTES.
 *   - The dashboard's "API Documentation" panel renders the same
 *     spec the user can download, so what they see == what they get.
 *
 * Task ID: HARDEN-SCALE-DOCS (Task 4).
 */

import { API_ROUTES } from "@/lib/central-registry";

// ─── Types (subset of OpenAPI 3.0 we emit) ───────────────────────────

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface OpenApiInfo {
  title: string;
  version: string;
  description: string;
}

export interface OpenApiResponse {
  description: string;
  content?: Record<string, { schema: Record<string, unknown> }>;
}

export interface OpenApiOperation {
  summary: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  responses: Record<string, OpenApiResponse>;
  security?: Array<Record<string, unknown[]>>;
}

export interface OpenApiPathItem {
  [method: string]: OpenApiOperation;
}

export interface OpenApiSpec {
  openapi: "3.0.0";
  info: OpenApiInfo;
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, OpenApiPathItem>;
  components: {
    securitySchemes: Record<string, unknown>;
  };
  security: Array<Record<string, unknown[]>>;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Group a route path into a tag by its first path segment after `/api`.
 * Examples:
 *   /api/approvals         → "approvals"
 *   /api/approvals/[id]    → "approvals"
 *   /api/business-lifecycle/find → "business-lifecycle"
 *   /api                   → "root"
 */
function tagForPath(path: string): string {
  if (!path.startsWith("/api")) return "misc";
  const rest = path.slice("/api".length);
  if (!rest || rest === "/") return "root";
  const seg = rest.replace(/^\//, "").split("/")[0] ?? "misc";
  return seg || "root";
}

/**
 * Build a stable operationId from method + path so Swagger UI can
 * deep-link individual operations.
 *   POST /api/approvals/[id]/discuss → post_approvals__id__discuss
 */
function operationIdFor(method: string, path: string): string {
  const norm = path
    .replace(/^\//, "")
    .replace(/\//g, "_")
    .replace(/\[|\]/g, "");
  return `${method.toLowerCase()}_${norm}`;
}

/**
 * Convert a registry route's raw path (which may include `[id]`-style
 * Next.js dynamic segments) into an OpenAPI-style path with `{id}`.
 *   /api/approvals/[id] → /api/approvals/{id}
 */
function toOpenApiPath(path: string): string {
  return path.replace(/\[([^\]]+)\]/g, "{$1}");
}

// ─── Generator ───────────────────────────────────────────────────────

/**
 * Generate a complete OpenAPI 3.0 document from `API_ROUTES`.
 *
 * The spec declares bearer-token auth globally (`security`) and per-
 * operation (`security` on each op) so consumers can either send a
 * bearer token or omit it (public routes still document the scheme).
 */
export function generateOpenApiSpec(): OpenApiSpec {
  const paths: Record<string, OpenApiPathItem> = {};

  for (const route of API_ROUTES) {
    const method = route.method.toLowerCase() as HttpMethod;
    const oaPath = toOpenApiPath(route.path);
    if (!paths[oaPath]) paths[oaPath] = {};
    // If the same method on the same path is already declared (e.g.
    // GET /api/telephony/call appears once and POST /api/telephony/call
    // appears once), this is a no-op for the second occurrence.
    paths[oaPath][method] = {
      summary: route.desc,
      description: `${route.method} ${route.path} — ${route.desc}`,
      operationId: operationIdFor(route.method, route.path),
      tags: [tagForPath(route.path)],
      responses: {
        "200": {
          description: "Successful response",
          content: {
            "application/json": {
              schema: {
                type: "object",
                description: "Route-specific JSON payload. See route handler for shape.",
              },
            },
          },
        },
        "400": { description: "Bad request — validation failed or malformed body." },
        "401": { description: "Unauthorized — bearer token missing or invalid." },
        "500": { description: "Internal server error." },
      },
      security: [{ bearerAuth: [] }],
    };
  }

  return {
    openapi: "3.0.0",
    info: {
      title: "ARIA Mission Control API",
      version: "v28.0-hermes-autonomous",
      description:
        "Autonomous agent fleet + revenue engine API for ARIA Mission Control. " +
        "All routes are force-dynamic, return JSON via NextResponse, and are " +
        "documented from the central registry (`src/lib/central-registry.ts`). " +
        "Use this spec to drive Swagger UI / Postman / Redoc. List endpoints " +
        "support `?page=` + `?limit=` for paginated access (envelope: " +
        "`{ data, pagination: { page, limit, total, totalPages, hasMore } }`).",
    },
    servers: [
      { url: "/", description: "Same-origin (default — proxied through Caddy gateway)" },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Bearer token (JWT or session token) issued by NextAuth.js.",
        },
      },
    },
    security: [{ bearerAuth: [] }],
  };
}

export default generateOpenApiSpec;
