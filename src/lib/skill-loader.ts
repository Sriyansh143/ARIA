/**
 * src/lib/skill-loader.ts — ClawHub Skill Loader.
 *
 * Reads all SKILL.md files from the skills/ directory at boot, parses
 * their YAML frontmatter + markdown body, and upserts them as Skill
 * records in the database. This makes all 65 ClawHub skills available
 * to the 66-agent fleet via the Hermes engine.
 *
 * The loader is idempotent — it upserts by slug, so re-running it
 * won't create duplicates. Skills that were manually created via
 * createSkillFromExecution() are preserved (source="learned").
 *
 * Task ID: v38-SKILLS.
 */
import "server-only";

import fs from "fs";
import path from "path";
import { db } from "./db";
import { logger } from "./logger";

export interface ParsedSkill {
  slug: string;
  name: string;
  category: string;
  description: string;
  instructions: string;
  source: string;
  status: string;
  filePath: string;
}

/**
 * Parse a SKILL.md file's YAML frontmatter + markdown body.
 * Returns null if the file is invalid or missing required fields.
 */
function parseSkillFile(filePath: string): ParsedSkill | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content.trim()) return null;

    // Extract YAML frontmatter (between --- markers)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let frontmatter: Record<string, string> = {};
    let body = content;

    if (fmMatch) {
      const fmText = fmMatch[1];
      body = content.slice(fmMatch[0].length).trim();

      // Parse simple YAML (key: value, key: |, key: >, key: "...")
      for (const line of fmText.split("\n")) {
        const match = line.match(/^(\w+):\s*(.*)$/);
        if (match) {
          const key = match[1];
          let value = match[2].trim();
          // Strip quotes
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          // Handle YAML block scalars (| and >) — just use the first line
          if (value === "|" || value === ">" || value === ">-") {
            value = ""; // will be filled from body
          }
          frontmatter[key] = value;
        }
      }
    }

    // Extract the skill name from the directory name if not in frontmatter
    const dirName = path.basename(path.dirname(filePath));
    const slug = frontmatter.slug || dirName;
    const name = frontmatter.name || dirName;
    const category = frontmatter.category || "general";
    const description = frontmatter.description || body.split("\n")[0]?.slice(0, 200) || "";
    const instructions = frontmatter.instructions || body.slice(0, 2000);
    const source = frontmatter.source || "builtin";

    if (!slug || !name) return null;

    return {
      slug,
      name,
      category,
      description,
      instructions,
      source,
      status: "active",
      filePath,
    };
  } catch {
    return null;
  }
}

/**
 * Load all skills from the skills/ directory into the database.
 *
 * Called once at boot by the self-heal supervisor. Idempotent — upserts
 * by slug, so existing skills are updated and new skills are created.
 */
export async function loadSkillsFromDisk(): Promise<{
  loaded: number;
  created: number;
  updated: number;
  skipped: number;
}> {
  const skillsDir = path.join(process.cwd(), "skills");

  if (!fs.existsSync(skillsDir)) {
    logger.warn("skill-loader.no-skills-dir", { dir: skillsDir });
    return { loaded: 0, created: 0, updated: 0, skipped: 0 };
  }

  // Find all SKILL.md files
  const skillFiles: string[] = [];
  function scanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name === "SKILL.md" || entry.name.endsWith(".skill.md")) {
        skillFiles.push(fullPath);
      }
    }
  }
  scanDir(skillsDir);

  logger.info("skill-loader.scan", { found: skillFiles.length, dir: skillsDir });

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const filePath of skillFiles) {
    const parsed = parseSkillFile(filePath);
    if (!parsed) {
      skipped++;
      continue;
    }

    try {
      // Upsert by slug — if the skill already exists, update it; otherwise create.
      const existing = await db.skill.findFirst({
        where: { slug: parsed.slug },
      });

      if (existing) {
        // Only update if source is "builtin" or "manual" — don't overwrite "learned" skills
        if (existing.source === "learned") {
          skipped++;
          continue;
        }
        await db.skill.update({
          where: { id: existing.id },
          data: {
            name: parsed.name,
            category: parsed.category as any,
            description: parsed.description,
            source: parsed.source,
            status: parsed.status as any,
          },
        });
        updated++;
      } else {
        await db.skill.create({
          data: {
            slug: parsed.slug,
            name: parsed.name,
            category: parsed.category as any,
            description: parsed.description,
            source: parsed.source,
            status: parsed.status as any,
            invocations: 0,
            successRate: 1.0,
          },
        });
        created++;
      }
    } catch (err) {
      logger.warn("skill-loader.upsert-failed", {
        slug: parsed.slug,
        error: String(err).slice(0, 100),
      });
      skipped++;
    }
  }

  logger.info("skill-loader.complete", {
    total: skillFiles.length,
    created,
    updated,
    skipped,
  });

  return {
    loaded: skillFiles.length,
    created,
    updated,
    skipped,
  };
}
