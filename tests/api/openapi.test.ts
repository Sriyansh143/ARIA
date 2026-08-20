/**
 * tests/api/openapi.test.ts — Unit tests for the OpenAPI spec generator.
 *
 * Verifies the spec shape (`openapi: "3.0.0"`, paths, securitySchemes)
 * and that the generated path count matches `API_ROUTES.length`.
 *
 * Uses `bun:test`.
 */
import { describe, test, expect } from "bun:test";

describe("generateOpenApiSpec", () => {
  test("returns an object with openapi = '3.0.0'", async () => {
    const { generateOpenApiSpec } = await import("../../src/lib/openapi");
    const spec = generateOpenApiSpec();
    expect(spec.openapi).toBe("3.0.0");
  });

  test("has a non-empty paths object", async () => {
    const { generateOpenApiSpec } = await import("../../src/lib/openapi");
    const spec = generateOpenApiSpec();
    expect(spec.paths).toBeDefined();
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
  });

  test("declares bearerAuth in securitySchemes", async () => {
    const { generateOpenApiSpec } = await import("../../src/lib/openapi");
    const spec = generateOpenApiSpec();
    expect(spec.components).toBeDefined();
    expect(spec.components.securitySchemes).toBeDefined();
    expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
    const bearer = spec.components.securitySchemes.bearerAuth as Record<string, unknown>;
    expect(bearer.type).toBe("http");
    expect(bearer.scheme).toBe("bearer");
  });

  test("each API_ROUTE has a corresponding path entry", async () => {
    const { generateOpenApiSpec } = await import("../../src/lib/openapi");
    const { API_ROUTES } = await import("../../src/lib/central-registry");
    const spec = generateOpenApiSpec();
    // Convert [id] → {id} the same way the generator does.
    const toOaPath = (p: string) => p.replace(/\[([^\]]+)\]/g, "{$1}");
    for (const route of API_ROUTES) {
      const oaPath = toOaPath(route.path);
      expect(spec.paths[oaPath]).toBeDefined();
      const method = route.method.toLowerCase();
      expect(spec.paths[oaPath][method]).toBeDefined();
      expect(spec.paths[oaPath][method].summary).toBe(route.desc);
    }
  });

  test("total unique path count matches API_ROUTES (deduped by path)", async () => {
    const { generateOpenApiSpec } = await import("../../src/lib/openapi");
    const { API_ROUTES } = await import("../../src/lib/central-registry");
    const spec = generateOpenApiSpec();
    const uniquePaths = new Set(
      API_ROUTES.map((r) => r.path.replace(/\[([^\]]+)\]/g, "{$1}"))
    );
    expect(Object.keys(spec.paths).length).toBe(uniquePaths.size);
  });

  test("info block has title + version", async () => {
    const { generateOpenApiSpec } = await import("../../src/lib/openapi");
    const spec = generateOpenApiSpec();
    expect(spec.info.title).toBeTruthy();
    expect(spec.info.version).toBeTruthy();
    expect(typeof spec.info.description).toBe("string");
  });
});
