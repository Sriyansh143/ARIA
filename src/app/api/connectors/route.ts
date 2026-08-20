import { NextRequest, NextResponse } from "next/server";
import {
  listConnectors,
  installConnector,
  uninstallConnector,
  getInstalledConnectors,
  type ConnectorCategory,
} from "@/lib/connector-marketplace";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/connectors
 *
 * Query params:
 *   - category=<ARIA|CRM|Comms|Payments|Documents>  — filter by category
 *   - installed=true                                  — return only installed
 *
 * Returns the connector catalogue with current install state.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const category = url.searchParams.get("category");
    const onlyInstalled = url.searchParams.get("installed") === "true";

    if (onlyInstalled) {
      const installed = await getInstalledConnectors();
      return NextResponse.json({
        connectors: installed,
        count: installed.length,
      });
    }

    const validCategories: ConnectorCategory[] = [
      "ARIA",
      "CRM",
      "Comms",
      "Payments",
      "Documents",
    ];
    const normalizedCat = category
      ? (category.charAt(0).toUpperCase() +
          category.slice(1).toLowerCase()) as ConnectorCategory
      : undefined;

    if (normalizedCat && !validCategories.includes(normalizedCat)) {
      return NextResponse.json(
        {
          error: `invalid category "${category}"`,
          validCategories,
        },
        { status: 400 },
      );
    }

    const connectors = await listConnectors(normalizedCat);
    return NextResponse.json({
      connectors,
      count: connectors.length,
      category: normalizedCat ?? "all",
    });
  } catch (err) {
    logger.error("api.connectors.get.error", { error: String(err) });
    return NextResponse.json(
      { error: "failed to load connectors", detail: String(err) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/connectors — install a connector.
 * Body: { id: string }
 *
 * DELETE /api/connectors — uninstall a connector.
 * Body: { id: string }
 */
export async function POST(req: NextRequest) {
  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body — expected { id: string }" },
      { status: 400 },
    );
  }

  const id = body?.id?.trim();
  if (!id) {
    return NextResponse.json(
      { error: "id is required" },
      { status: 400 },
    );
  }

  try {
    const result = await installConnector(id);
    if (!result.connector) {
      return NextResponse.json(
        { ok: false, error: `connector "${id}" not found` },
        { status: 404 },
      );
    }
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `connector "${id}" is not installable yet (status: ${result.connector.status})`,
          connector: result.connector,
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, connector: result.connector });
  } catch (err) {
    logger.error("api.connectors.post.error", { error: String(err) });
    return NextResponse.json(
      { ok: false, error: "install failed", detail: String(err) },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body — expected { id: string }" },
      { status: 400 },
    );
  }

  const id = body?.id?.trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const result = await uninstallConnector(id);
    if (!result.connector) {
      return NextResponse.json(
        { ok: false, error: `connector "${id}" not found` },
        { status: 404 },
      );
    }
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: `connector "${id}" cannot be uninstalled (built-in)` },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, connector: result.connector });
  } catch (err) {
    logger.error("api.connectors.delete.error", { error: String(err) });
    return NextResponse.json(
      { ok: false, error: "uninstall failed", detail: String(err) },
      { status: 500 },
    );
  }
}
