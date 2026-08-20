import { NextResponse } from "next/server";
import { generateOpenApiSpec } from "@/lib/openapi";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/openapi — emit the OpenAPI 3.0 spec for the entire API.
 *
 * Returns `Content-Type: application/json` so Swagger UI / Postman /
 * Redoc can consume it directly. The spec is generated on-demand from
 * the central registry (`src/lib/central-registry.ts`) so it never
 * drifts from the actual routes registered in code.
 *
 * Cache control: `no-store` because the registry is in-memory and
 * may change between deploys; we never want a stale spec cached.
 */
export async function GET() {
  try {
    const spec = generateOpenApiSpec();
    return new NextResponse(JSON.stringify(spec, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        // CORS allow-all so external Swagger UI instances can fetch.
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  } catch (err) {
    logger.error("api.openapi.get.error", { error: String(err) });
    return NextResponse.json(
      { error: "failed to generate OpenAPI spec", detail: String(err) },
      { status: 500 },
    );
  }
}

/**
 * OPTIONS /api/openapi — respond to CORS preflight so external tools
 * (Swagger UI hosted elsewhere) can fetch the spec.
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
