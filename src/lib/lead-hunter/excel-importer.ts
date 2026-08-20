/**
 * src/lib/lead-hunter/excel-importer.ts — v72 Phase 22 (RULE-70)
 *
 * Owner can upload an Excel (.xlsx) or CSV file containing contact lists
 * (name, email, phone, company, title, notes). The importer parses the
 * file and creates an ImportedContact row per row.
 *
 * Supported formats:
 *   - .xlsx (parsed via the `xlsx` npm package, lazy-loaded)
 *   - .csv (parsed natively — simple comma/newline split + quote handling)
 *   - .tsv (tab-separated)
 *
 * Column auto-detection: the importer looks for header columns named
 * "name"/"full name", "email"/"e-mail", "phone"/"mobile"/"whatsapp",
 * "company", "title"/"role", "notes"/"comments".
 *
 * Once imported, contacts flow through the same qualification pipeline
 * as social-scout + Google Maps leads — they can be matched to services,
 * qualified via the Scout/Risk/Sales debate, and pursued via outreach.
 */

import "server-only";
import { db } from "../db";
import { logger } from "../logger";
import { emit } from "../event-bus";

// ─── Types ────────────────────────────────────────────────────────────

export interface ImportedRow {
  name: string;
  email: string | null;
  phone: string | null;
  company: string;
  title: string;
  notes: string;
  tags: string[];
}

export interface ImportResult {
  totalRows: number;
  imported: number;
  duplicates: number;
  errors: number;
  sourceFile: string;
  importedContactIds: string[];
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Parse an uploaded Excel/CSV/TSV file + create ImportedContact rows.
 *
 * @param fileBuffer The raw file bytes (from the multipart upload).
 * @param fileName The original filename (used to detect format + store as source).
 * @param tagsJson Optional tags to apply to all imported contacts (e.g. ["mumbai-restaurants"]).
 * @returns Summary of the import.
 */
export async function importContactsFromFile(
  fileBuffer: Buffer,
  fileName: string,
  tagsJson: string[] = [],
): Promise<ImportResult> {
  logger.info("excel-importer.start", { fileName, sizeBytes: fileBuffer.length });
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: `📥 Phase 22 Excel Importer: parsing ${fileName} (${fileBuffer.length} bytes)...`,
    level: "info",
  });

  // Detect format from extension.
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "csv";
  let rows: ImportedRow[] = [];

  try {
    if (ext === "xlsx" || ext === "xls") {
      rows = await parseExcelFile(fileBuffer);
    } else if (ext === "csv" || ext === "tsv") {
      rows = parseCsvFile(fileBuffer.toString("utf-8"), ext === "tsv" ? "\t" : ",");
    } else {
      throw new Error(`Unsupported file extension: ${ext}`);
    }
  } catch (err) {
    logger.error("excel-importer.parse-failed", { fileName, error: String(err) });
    throw err;
  }

  if (rows.length === 0) {
    return {
      totalRows: 0,
      imported: 0,
      duplicates: 0,
      errors: 0,
      sourceFile: fileName,
      importedContactIds: [],
    };
  }

  // Persist each row.
  const importedContactIds: string[] = [];
  let imported = 0;
  let duplicates = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      // Skip rows with neither email nor phone — can't outreach them.
      if (!row.email && !row.phone) {
        errors++;
        continue;
      }
      // Deduplicate by (email OR phone) within the same source file.
      const existing = await db.importedContact.findFirst({
        where: {
          OR: [
            ...(row.email ? [{ email: row.email }] : []),
            ...(row.phone ? [{ phone: row.phone }] : []),
          ],
          source: "excel",
          sourceFile: fileName,
        },
      });
      if (existing) {
        duplicates++;
        continue;
      }

      const contact = await db.importedContact.create({
        data: {
          source: "excel",
          sourceFile: fileName,
          name: row.name.slice(0, 200),
          email: row.email,
          phone: row.phone,
          company: row.company.slice(0, 200),
          title: row.title.slice(0, 100),
          notes: row.notes.slice(0, 1000),
          tagsJson: JSON.stringify([...tagsJson, ...(row.tags || [])]),
          qualificationVerdict: "pending",
          qualificationScore: 0,
        },
      });
      importedContactIds.push(contact.id);
      imported++;
    } catch (err) {
      errors++;
      logger.warn("excel-importer.row-failed", { row, error: String(err).slice(0, 80) });
    }
  }

  logger.info("excel-importer.complete", {
    fileName,
    totalRows: rows.length,
    imported,
    duplicates,
    errors,
  });
  emit({
    type: "system",
    ts: new Date().toISOString(),
    message: `📥 Phase 22 Excel Importer: imported ${imported} contacts from ${fileName} (${duplicates} duplicates, ${errors} errors)`,
    level: imported > 0 ? "success" : "warn",
  });

  return {
    totalRows: rows.length,
    imported,
    duplicates,
    errors,
    sourceFile: fileName,
    importedContactIds,
  };
}

// ─── Excel parsing ────────────────────────────────────────────────────

async function parseExcelFile(buffer: Buffer): Promise<ImportedRow[]> {
  // Lazy-load the xlsx package — only needed when an Excel file is uploaded.
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  // header: 1 → returns array-of-arrays where first row is the headers.
  const json: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (json.length < 2) return [];

  const headers = (json[0] as any[]).map((h) => String(h).toLowerCase().trim());
  return json.slice(1).map((rowArr: any[]) => parseRow(headers, rowArr));
}

// ─── CSV / TSV parsing ─────────────────────────────────────────────────

function parseCsvFile(content: string, delimiter: string = ","): ImportedRow[] {
  const lines = content.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0], delimiter).map((h) => h.toLowerCase().trim());
  // Filter out empty lines (trailing newline at EOF produces a phantom empty row).
  return lines.slice(1)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const values = parseCsvLine(line, delimiter);
      return parseRow(headers, values);
    });
}

/**
 * Parse a single CSV line — handles quoted fields with embedded commas.
 */
function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === delimiter && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

/**
 * Map an array of values to ImportedRow using header names.
 * Recognizes common header variants per column.
 */
function parseRow(headers: string[], values: any[]): ImportedRow {
  const get = (variants: string[]): string => {
    for (const v of variants) {
      const idx = headers.indexOf(v);
      if (idx >= 0 && values[idx] != null) return String(values[idx]).trim();
    }
    return "";
  };

  const name = get(["name", "full name", "contact name", "first name"]);
  const email = get(["email", "e-mail", "email address", "email id"]) || null;
  const phone = get(["phone", "mobile", "whatsapp", "phone number", "mobile number", "contact"]) || null;
  const company = get(["company", "business", "organization", "organisation", "company name"]);
  const title = get(["title", "role", "designation", "position", "job title"]);
  const notes = get(["notes", "comments", "remark", "remarks", "description"]);
  const tagsStr = get(["tags", "label", "labels", "category", "categories"]);
  const tags = tagsStr ? tagsStr.split(/[;,|]/).map((t) => t.trim()).filter(Boolean) : [];

  return { name, email, phone, company, title, notes, tags };
}
