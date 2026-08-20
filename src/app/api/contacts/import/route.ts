/**
 * POST /api/contacts/import — v72 Phase 22 (RULE-70)
 *
 * Owner uploads an Excel (.xlsx) / CSV / TSV file containing contact lists.
 * The file is parsed + each row becomes an ImportedContact record.
 *
 * Body: multipart/form-data with field "file" (the uploaded file).
 * Optional query param: ?tags=mumbai-restaurants,launch-2026
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrResponse } from "@/lib/auth";
import { importContactsFromFile } from "@/lib/lead-hunter/excel-importer";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuthOrResponse("POST", "/api/contacts/import");
  if (auth instanceof NextResponse) return auth;

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Missing 'file' field in multipart form data" },
        { status: 400 },
      );
    }

    const fileName = file.name || "contacts.xlsx";
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const tagsStr = req.nextUrl.searchParams.get("tags") ?? "";
    const tags = tagsStr ? tagsStr.split(",").map((t) => t.trim()).filter(Boolean) : [];

    const result = await importContactsFromFile(fileBuffer, fileName, tags);
    logger.info("api.contacts.import.complete", { ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error("api.contacts.import.failed", { error: String(err) });
    return NextResponse.json(
      { ok: false, error: String(err).slice(0, 200) },
      { status: 500 },
    );
  }
}

/**
 * GET /api/contacts/import — return recently imported contacts.
 */
export async function GET() {
  const auth = await requireAuthOrResponse("GET", "/api/contacts/import");
  if (auth instanceof NextResponse) return auth;

  try {
    const { db } = await import("@/lib/db");
    const contacts = await db.importedContact.findMany({
      orderBy: { importedAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ ok: true, count: contacts.length, contacts });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err).slice(0, 100) },
      { status: 500 },
    );
  }
}
