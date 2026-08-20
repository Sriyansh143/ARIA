/**
 * scripts/generate-embedded-skills.ts — v76 Phase 26
 *
 * "Digest and Discard" pipeline. Reads the skills/ folder (182 SKILL.md files,
 * 61MB raw), extracts the core intelligence from each, and writes a SINGLE
 * TypeScript file: src/lib/embedded-skills.ts.
 *
 * This file becomes the app's compiled "model" — the raw skills/ folder is
 * then excluded from the production zip. The app loads skills from this
 * embedded array (or from the DB seeded from it) at runtime.
 *
 * Run: bun run scripts/generate-embedded-skills.ts
 *
 * After running:
 *   - src/lib/embedded-skills.ts contains 132+ skill objects with full instructions
 *   - The skills/ folder is no longer needed for production
 *   - The zip size drops from 42MB back to ~2MB
 */

import * as fs from "fs";
import * as path from "path";

const SKILLS_DIR = path.resolve(process.cwd(), "skills");
const OUTPUT_FILE = path.resolve(process.cwd(), "src/lib/embedded-skills.ts");

interface EmbeddedSkill {
  slug: string;
  name: string;
  category: string;
  description: string;
  systemPrompt: string; // full SKILL.md content — the real intelligence
  requiredInputs: string[];
  expectedOutput: string;
  logicPattern: string;
  script: string | null;
  source: string;
}

function parseFrontmatter(content: string): Record<string, string> {
  const fm: Record<string, string> = {};
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return fm;
  for (const line of match[1].split("\n")) {
    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) fm[kvMatch[1]] = kvMatch[2].replace(/^["']|["']$/g, "").trim();
  }
  return fm;
}

function deriveCategory(slug: string, description: string): string {
  const lower = (slug + " " + description).toLowerCase();
  if (/llm|chat|conversation|text-generation|completion/.test(lower)) return "llm";
  if (/vlm|vision|image-understand|ocr/.test(lower)) return "media";
  if (/tts|speech|voice|audio/.test(lower)) return "media";
  if (/asr|transcri|speech-to-text/.test(lower)) return "media";
  if (/image-gen|image-generation|generate-image/.test(lower)) return "media";
  if (/video-gen|video-generation/.test(lower)) return "media";
  if (/web-search|search/.test(lower)) return "web";
  if (/web-reader|page-reader|read.*page|scrape/.test(lower)) return "web";
  if (/docx|word.*doc/.test(lower)) return "doc";
  if (/pptx|powerpoint|slide/.test(lower)) return "doc";
  if (/xlsx|excel|spreadsheet/.test(lower)) return "doc";
  if (/pdf/.test(lower)) return "doc";
  if (/chart|graph|diagram|visualization/.test(lower)) return "data";
  if (/code|coding|engineer|debug/.test(lower)) return "code";
  return "general";
}

function deriveRequiredInputs(content: string, slug: string): string[] {
  const lower = content.toLowerCase();
  const inputs: string[] = [];
  // Look for "## Inputs" or "## Required Inputs" sections
  const inputsSection = content.match(/## (?:required )?inputs?\s*\n([\s\S]*?)(?=\n##|\n---|$)/i);
  if (inputsSection) {
    const lines = inputsSection[1].split("\n");
    for (const line of lines) {
      const match = line.match(/[-*]\s*(\w+)/);
      if (match) inputs.push(match[1]);
    }
  }
  // Heuristic fallbacks
  if (inputs.length === 0) {
    if (/image|photo|picture/.test(lower)) inputs.push("image");
    if (/text|message|prompt|query/.test(lower)) inputs.push("text");
    if (/url|link|website/.test(lower)) inputs.push("url");
    if (/audio|voice|speech/.test(lower)) inputs.push("audio");
    if (inputs.length === 0) inputs.push("input");
  }
  return inputs;
}

function deriveExpectedOutput(content: string): string {
  const lower = content.toLowerCase();
  if (/html|web\s*page|landing\s*page/.test(lower)) return "html";
  if (/json|structured\s*data/.test(lower)) return "json";
  if (/markdown|md/.test(lower)) return "markdown";
  if (/code|script|function|class/.test(lower)) return "code";
  if (/image|picture|photo/.test(lower)) return "binary-url";
  if (/audio|voice|speech/.test(lower)) return "binary-url";
  return "text";
}

function deriveLogicPattern(content: string, slug: string): string {
  const lower = content.toLowerCase();
  if (/chain.of.thought|step.by.step|reasoning/.test(lower)) return "chain-of-thought";
  if (/template|fill.in|scaffold/.test(lower)) return "template-fill";
  if (/search|retrieve|fetch|scrape/.test(lower)) return "retrieve-and-summarize";
  if (/generate|create|build/.test(lower)) return "generate-from-spec";
  if (/analyze|review|audit|inspect/.test(lower)) return "analyze-and-report";
  if (/convert|transform|convert/.test(lower)) return "transform-format";
  return "direct-completion";
}

// ─── Main ────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.error("❌ skills/ folder not found. Cannot generate embedded-skills.ts.");
    console.error("   This script requires the skills/ folder to be present.");
    console.error("   Run scripts/generate-skills-folder.py first, or clone the ClawHub skills repo.");
    process.exit(1);
  }

  console.log("🚀 Phase 26 — Digest and Discard: generating src/lib/embedded-skills.ts...");
  console.log(`   Source: ${SKILLS_DIR}`);
  console.log(`   Output: ${OUTPUT_FILE}`);
  console.log("");

  // Walk the skills/ directory
  const skillFolders = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  console.log(`   Found ${skillFolders.length} skill directories.`);

  const skills: EmbeddedSkill[] = [];
  let skipped = 0;

  for (const folder of skillFolders) {
    const skillMdPath = path.join(SKILLS_DIR, folder, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) {
      skipped++;
      continue;
    }

    const content = fs.readFileSync(skillMdPath, "utf-8");
    const frontmatter = parseFrontmatter(content);
    const slug = folder.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const name = frontmatter.name || folder;
    const description = frontmatter.description || "";
    const category = frontmatter.category || deriveCategory(slug, description);
    const requiredInputs = deriveRequiredInputs(content, slug);
    const expectedOutput = deriveExpectedOutput(content);
    const logicPattern = deriveLogicPattern(content, slug);

    // Look for script references
    let script: string | null = null;
    const scriptMatch = content.match(/scripts\/([a-zA-Z0-9_-]+\.(ts|js|py))/);
    if (scriptMatch) {
      const scriptPath = path.join(SKILLS_DIR, folder, "scripts", scriptMatch[1]);
      if (fs.existsSync(scriptPath)) script = `scripts/${scriptMatch[1]}`;
    }

    skills.push({
      slug,
      name,
      category,
      description,
      systemPrompt: content, // the FULL SKILL.md content — real intelligence
      requiredInputs,
      expectedOutput,
      logicPattern,
      script,
      source: "embedded-skills",
    });
  }

  console.log(`   Parsed ${skills.length} skills (${skipped} skipped).`);
  console.log("");

  // Calculate stats
  const totalChars = skills.reduce((sum, s) => sum + s.systemPrompt.length, 0);
  const avgChars = Math.round(totalChars / skills.length);
  const maxChars = Math.max(...skills.map((s) => s.systemPrompt.length));
  const minChars = Math.min(...skills.map((s) => s.systemPrompt.length));
  const byCategory: Record<string, number> = {};
  for (const s of skills) byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;

  console.log("📊 Embedded skills stats:");
  console.log(`   Total skills: ${skills.length}`);
  console.log(`   Total chars: ${totalChars.toLocaleString()}`);
  console.log(`   Avg per skill: ${avgChars.toLocaleString()} chars`);
  console.log(`   Max: ${maxChars.toLocaleString()} chars`);
  console.log(`   Min: ${minChars} chars`);
  console.log(`   By category: ${Object.entries(byCategory).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log("");

  // Generate the TypeScript file
  const lines: string[] = [
    "/**",
    " * src/lib/embedded-skills.ts — v76 Phase 26 (Digest and Discard)",
    " *",
    " * AUTO-GENERATED by scripts/generate-embedded-skills.ts.",
    " * DO NOT EDIT MANUALLY — regenerate from the skills/ folder if needed.",
    " *",
    " * This file contains the FULL intelligence of all ${skills.length} skills,",
    " * extracted from the raw skills/ folder (182 SKILL.md files, 61MB).",
    " * The raw skills/ folder is EXCLUDED from the production zip — the app",
    " * loads all skill intelligence from this embedded array at runtime.",
    " *",
    " * Stats:",
    " *   - Total skills: ${skills.length}",
    " *   - Total chars: ${totalChars.toLocaleString()}",
    " *   - Avg per skill: ${avgChars.toLocaleString()} chars",
    " *   - Max: ${maxChars.toLocaleString()} chars (the largest skill's full instructions)",
    " *   - By category: ${Object.entries(byCategory).map(([k, v]) => `${k}=${v}`).join(\", \")}",
    " *",
    " * Usage:",
    " *   import { EMBEDDED_SKILLS } from './embedded-skills';",
    " *   const skill = EMBEDDED_SKILLS.find(s => s.slug === 'llm');",
    " *   // skill.systemPrompt contains the full 21,913-char instructions",
    " */",
    "",
    "export interface EmbeddedSkill {",
    "  slug: string;",
    "  name: string;",
    "  category: string;",
    "  description: string;",
    "  systemPrompt: string; // the FULL SKILL.md content — real intelligence",
    "  requiredInputs: string[];",
    "  expectedOutput: string;",
    "  logicPattern: string;",
    "  script: string | null;",
    "  source: string;",
    "}",
    "",
    `export const EMBEDDED_SKILLS: EmbeddedSkill[] = [`,
  ];

  for (const skill of skills) {
    lines.push("  {");
    lines.push(`    slug: ${JSON.stringify(skill.slug)},`);
    lines.push(`    name: ${JSON.stringify(skill.name)},`);
    lines.push(`    category: ${JSON.stringify(skill.category)},`);
    // Truncate the description BEFORE stringifying to avoid cutting in the middle
    // of an escape sequence or multi-byte character.
    const descTruncated = skill.description.slice(0, 300);
    lines.push(`    description: ${JSON.stringify(descTruncated)},`);
    // systemPrompt is the full skill content — no truncation. JSON.stringify
    // handles all escaping (newlines become \n, quotes become \", etc.).
    lines.push(`    systemPrompt: ${JSON.stringify(skill.systemPrompt)},`);
    lines.push(`    requiredInputs: ${JSON.stringify(skill.requiredInputs)},`);
    lines.push(`    expectedOutput: ${JSON.stringify(skill.expectedOutput)},`);
    lines.push(`    logicPattern: ${JSON.stringify(skill.logicPattern)},`);
    lines.push(`    script: ${JSON.stringify(skill.script)},`);
    lines.push(`    source: ${JSON.stringify(skill.source)},`);
    lines.push("  },");
  }

  lines.push("];");
  lines.push("");

  // Add helper functions
  lines.push("/**");
  lines.push(" * Get an embedded skill by slug.");
  lines.push(" */");
  lines.push("export function getEmbeddedSkill(slug: string): EmbeddedSkill | null {");
  lines.push("  return EMBEDDED_SKILLS.find((s) => s.slug === slug) ?? null;");
  lines.push("}");
  lines.push("");
  lines.push("/**");
  lines.push(" * Get all embedded skills in a category.");
  lines.push(" */");
  lines.push("export function getEmbeddedSkillsByCategory(category: string): EmbeddedSkill[] {");
  lines.push("  return EMBEDDED_SKILLS.filter((s) => s.category === category);");
  lines.push("}");
  lines.push("");
  lines.push("/**");
  lines.push(" * Count embedded skills.");
  lines.push(" */");
  lines.push("export function countEmbeddedSkills(): number {");
  lines.push("  return EMBEDDED_SKILLS.length;");
  lines.push("}");

  fs.writeFileSync(OUTPUT_FILE, lines.join("\n"), "utf-8");

  const fileSize = fs.statSync(OUTPUT_FILE).size;
  console.log(`✅ Generated ${OUTPUT_FILE}`);
  console.log(`   File size: ${(fileSize / 1024).toFixed(0)} KB`);
  console.log(`   Skills embedded: ${skills.length}`);
  console.log("");
  console.log("📋 Next steps:");
  console.log("   1. The skills/ folder is NO LONGER NEEDED for production.");
  console.log("   2. Run scripts/seed-from-embedded.ts to seed the DB from this file.");
  console.log("   3. Exclude skills/ from the production zip.");
  console.log("");
  console.log("🎉 Digest and Discard complete!");
}

main();
