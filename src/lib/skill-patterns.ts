/**
 * src/lib/skill-patterns.ts — v61 Phase 3 (Skills as Patterns, Not Bloat)
 *
 * The owner's rule: "Do not ship 40MB of skill templates. Convert skills
 * into lightweight logic patterns/prompts."
 *
 * This module defines the core logic, system prompts, and expected output
 * shapes for the top essential skills as TypeScript objects — NO external
 * template files, NO 54MB design-templates directory. Each pattern is a
 * self-contained instruction set the LLM uses to perform the skill.
 *
 * The hermes/skills.ts executor checks these patterns FIRST (by slug)
 * before falling back to the DB-loaded Skill rows. This means:
 *   - Fresh installs work immediately (no need to load the skills/ dir).
 *   - The production zip excludes skills/ entirely (saves ~60MB).
 *   - Skill behavior is version-controlled in code, not in markdown files.
 */

import "server-only";

export interface SkillPattern {
  /** Unique slug — matches the Skill.slug in the DB. */
  slug: string;
  /** Human-readable name. */
  name: string;
  /** Category: llm | media | doc | data | web | code | comms | finance. */
  category: string;
  /** One-sentence description for the system prompt. */
  description: string;
  /** The system prompt that primes the LLM for this skill. */
  systemPrompt: string;
  /** Expected output shape — used by the zero-assumption guardrail. */
  expectedOutput: "text" | "json" | "markdown" | "html" | "code" | "binary-url";
  /** Required input fields — if any are missing, the task halts + asks. */
  requiredInputs: string[];
  /** Optional input fields. */
  optionalInputs?: string[];
  /** Default model complexity for this skill. */
  complexity: "low" | "medium" | "high";
  /** Whether this skill is free (local/no-login) or may incur cost. */
  freeOnly: boolean;
  /**
   * v61 Phase 5: path to the FULL skill file for high-complexity tasks.
   * When a task needs "Claude-level" reasoning, the workflow engine loads
   * the full text from this path (relative to the skills/ directory or
   * a knowledge-base DB table) into the context window instead of just
   * the 1KB systemPrompt. null = no full context available.
   */
  fullContextPath?: string | null;
}

/**
 * The top 12 essential skill patterns. These mirror the builtin skills
 * seeded in simulation/seed.ts but as self-contained logic — no external
 * files needed. Each is ~1KB of TS instead of ~500KB of markdown.
 */
export const SKILL_PATTERNS: Record<string, SkillPattern> = {
  llm: {
    slug: "llm",
    name: "LLM Chat",
    category: "llm",
    description: "Conversational large language model completions.",
    systemPrompt:
      "You are ARIA's conversational LLM. Respond clearly and concisely. " +
      "If the user's request is ambiguous, ask ONE clarifying question instead of guessing. " +
      "Never fabricate facts — if you don't know, say so.",
    expectedOutput: "text",
    requiredInputs: ["message"],
    optionalInputs: ["context", "systemOverride"],
    complexity: "medium",
    freeOnly: true,
    fullContextPath: "LLM/SKILL.md",
  },
  vlm: {
    slug: "vlm",
    name: "Vision Model",
    category: "llm",
    description: "Image + document understanding.",
    systemPrompt:
      "You are ARIA's vision model. Analyze the provided image and respond with: " +
      "(1) a factual description of what you see, (2) any text content transcribed, " +
      "(3) relevant context. If the image is unclear, state what you can + cannot determine.",
    expectedOutput: "text",
    requiredInputs: ["image"],
    optionalInputs: ["question"],
    complexity: "high",
    freeOnly: false,
    fullContextPath: "VLM/SKILL.md",
  },
  tts: {
    slug: "tts",
    name: "Text-to-Speech",
    category: "media",
    description: "Natural-sounding voice synthesis.",
    systemPrompt:
      "You are ARIA's TTS engine. Convert the input text to natural speech. " +
      "Output a URL to the generated audio file.",
    expectedOutput: "binary-url",
    requiredInputs: ["text"],
    optionalInputs: ["voice", "speed"],
    complexity: "low",
    freeOnly: false,
    fullContextPath: "TTS/SKILL.md",
  },
  asr: {
    slug: "asr",
    name: "Speech Recognition",
    category: "media",
    description: "Audio transcription.",
    systemPrompt:
      "You are ARIA's speech-to-text engine. Transcribe the provided audio accurately. " +
      "If audio is unclear, mark uncertain segments with [?].",
    expectedOutput: "text",
    requiredInputs: ["audio"],
    optionalInputs: ["language"],
    complexity: "medium",
    freeOnly: false,
    fullContextPath: "ASR/SKILL.md",
  },
  "image-gen": {
    slug: "image-gen",
    name: "Image Generation",
    category: "media",
    description: "Text-to-image synthesis.",
    systemPrompt:
      "You are ARIA's image generation engine. Generate an image matching the prompt. " +
      "Output a URL to the generated image. If the prompt is ambiguous, ask for clarification.",
    expectedOutput: "binary-url",
    requiredInputs: ["prompt"],
    optionalInputs: ["size", "style"],
    complexity: "medium",
    freeOnly: false,
    fullContextPath: "image-generation/SKILL.md",
  },
  "video-gen": {
    slug: "video-gen",
    name: "Video Generation",
    category: "media",
    description: "Text-to-video synthesis.",
    systemPrompt:
      "You are ARIA's video generation engine. Generate a short video matching the prompt. " +
      "Output a URL to the generated video.",
    expectedOutput: "binary-url",
    requiredInputs: ["prompt"],
    optionalInputs: ["duration", "style"],
    complexity: "high",
    freeOnly: false,
    fullContextPath: "video-generation/SKILL.md",
  },
  "web-search": {
    slug: "web-search",
    name: "Web Search",
    category: "web",
    description: "Real-time web retrieval.",
    systemPrompt:
      "You are ARIA's web search engine. Search the web for the query + return the top " +
      "results with title, URL, and a 1-sentence snippet. Cite sources. Never fabricate URLs.",
    expectedOutput: "json",
    requiredInputs: ["query"],
    optionalInputs: ["maxResults", "timeRange"],
    complexity: "low",
    freeOnly: true,
    fullContextPath: "web-search/SKILL.md",
  },
  "page-reader": {
    slug: "page-reader",
    name: "Page Reader",
    category: "web",
    description: "Article content extraction.",
    systemPrompt:
      "You are ARIA's page reader. Fetch the URL + extract the main article content " +
      "(title, body, publishDate). Strip ads/nav/footer. If the page is paywalled or " +
      "inaccessible, say so.",
    expectedOutput: "json",
    requiredInputs: ["url"],
    optionalInputs: ["selector"],
    complexity: "low",
    freeOnly: true,
    fullContextPath: "web-reader/SKILL.md",
  },
  docx: {
    slug: "docx",
    name: "Document Builder",
    category: "doc",
    description: "Word document creation.",
    systemPrompt:
      "You are ARIA's document builder. Generate a .docx file from the spec. " +
      "Output the file content + metadata. Structure: title, headings, paragraphs, tables.",
    expectedOutput: "binary-url",
    requiredInputs: ["title", "sections"],
    optionalInputs: ["template"],
    complexity: "medium",
    freeOnly: true,
    fullContextPath: "docx/SKILL.md",
  },
  pptx: {
    slug: "pptx",
    name: "Slide Builder",
    category: "doc",
    description: "Presentation generation.",
    systemPrompt:
      "You are ARIA's slide builder. Generate a .pptx from the spec. " +
      "Each slide: title + bullets + speaker notes. Max 7 bullets per slide.",
    expectedOutput: "binary-url",
    requiredInputs: ["title", "slides"],
    optionalInputs: ["template"],
    complexity: "medium",
    freeOnly: true,
    fullContextPath: "pptx/SKILL.md",
  },
  xlsx: {
    slug: "xlsx",
    name: "Spreadsheet Builder",
    category: "data",
    description: "Excel workbook generation.",
    systemPrompt:
      "You are ARIA's spreadsheet builder. Generate an .xlsx from the spec. " +
      "Each sheet: name + rows (array of arrays). Include formulas if requested.",
    expectedOutput: "binary-url",
    requiredInputs: ["sheets"],
    optionalInputs: ["formulas"],
    complexity: "medium",
    freeOnly: true,
    fullContextPath: "xlsx/SKILL.md",
  },
  pdf: {
    slug: "pdf",
    name: "PDF Toolkit",
    category: "doc",
    description: "Structured + creative PDF generation.",
    systemPrompt:
      "You are ARIA's PDF toolkit. Generate a PDF from the spec. " +
      "Support: reports (structured), creative (posters/infographics), academic (LaTeX).",
    expectedOutput: "binary-url",
    requiredInputs: ["type", "content"],
    optionalInputs: ["template"],
    complexity: "high",
    freeOnly: true,
    // v61 Phase 5: full skill file for Claude-level PDF generation.
    fullContextPath: "pdf/SKILL.md",
  },
};

/**
 * Look up a skill pattern by slug. Returns null if not found.
 */
export function getSkillPattern(slug: string): SkillPattern | null {
  return SKILL_PATTERNS[slug] ?? null;
}

/**
 * List all skill pattern slugs (for the system prompt's skill discovery).
 */
export function listSkillPatternSlugs(): string[] {
  return Object.keys(SKILL_PATTERNS);
}

/**
 * Check if a skill pattern is available in FREE_ONLY_MODE.
 * (All patterns in SKILL_PATTERNS are marked freeOnly=true/false individually.)
 */
export function isSkillPatternFree(slug: string): boolean {
  const pattern = getSkillPattern(slug);
  return pattern?.freeOnly ?? false;
}

/**
 * v61 Phase 5: Load the FULL skill file context for high-complexity tasks.
 *
 * When a task needs "Claude-level" reasoning, the workflow engine calls
 * this instead of using the 1KB systemPrompt. It reads the full skill file
 * from the skills/ directory (if present) or falls back to the pattern's
 * systemPrompt if the file isn't available (e.g. in the production zip
 * where skills/ is excluded).
 *
 * This gives the LLM the complete instructions, examples, and edge cases
 * from the original skill file — not just a 1KB summary.
 *
 * @param slug The skill slug (e.g. "pdf", "docx").
 * @param maxChars Maximum chars to load (default 8000 — fits in context).
 * @returns The full skill file text, or the pattern's systemPrompt if unavailable.
 */
/**
 * v61.3 Phase 8: Load the FULL skill context for high-complexity tasks.
 *
 * NO LAZY SUMMARIES. This function now queries the Skill database table
 * (populated by scripts/extract-all-skill-patterns.ts) for the REAL extracted
 * instructions (the full SKILL.md content, ~20KB per skill). Only if the DB
 * is unavailable or the skill isn't found does it fall back to the hardcoded
 * SKILL_PATTERNS array (the 12-pattern fallback).
 *
 * The DB is the source of truth — 69 real skills with full instructions,
 * not 12 generic 1-liners.
 *
 * @param slug The skill slug (e.g. "llm", "docx", "web-search").
 * @param maxChars Maximum chars to load (default 8000 — fits in context).
 * @returns The full skill instructions from the DB, or the fallback pattern.
 */
export async function loadFullSkillContext(slug: string, maxChars: number = 8000): Promise<string> {
  // v76 Phase 26: Query EMBEDDED_SKILLS FIRST (the compiled intelligence —
  // no skills/ folder or DB needed at runtime).
  try {
    const { getEmbeddedSkill } = await import("./embedded-skills");
    const embedded = getEmbeddedSkill(slug.toLowerCase());
    if (embedded && embedded.systemPrompt.length > 0) {
      if (embedded.systemPrompt.length > maxChars) {
        return embedded.systemPrompt.slice(0, maxChars) + "\n\n...(truncated, see embedded-skills.ts for full instructions)";
      }
      return embedded.systemPrompt;
    }
  } catch {
    // embedded-skills.ts not available — fall through.
  }

  // v61.3 Phase 8: Query the Skill DB table (seeded from EMBEDDED_SKILLS).
  try {
    const { db } = await import("./db");
    const skill = await db.skill.findUnique({
      where: { slug: slug.toLowerCase() },
      select: { instructions: true, name: true, description: true },
    });
    if (skill?.instructions && skill.instructions.length > 0) {
      const content = skill.instructions;
      if (content.length > maxChars) {
        return content.slice(0, maxChars) + "\n\n...(truncated, see full skill in the Skill table)";
      }
      return content;
    }
  } catch {
    // DB unavailable — fall through to the pattern fallback.
  }

  // Fallback: use the hardcoded SKILL_PATTERNS array (the 12-pattern fallback).
  const pattern = getSkillPattern(slug);
  if (!pattern) {
    return "Skill pattern not found.";
  }

  // Last resort: use the pattern's systemPrompt.
  return pattern.systemPrompt;
}

/**
 * v61.3 Phase 8: Query the KnowledgeBaseEntry table for patterns matching
 * the given tags. Used by the Conductor's planning logic to find real,
 * extracted patterns from the 500-AI-Agents-Projects repo.
 *
 * @param tags Array of tags to search for (e.g. ["multi-agent-debate", "code-review"]).
 * @param limit Max number of entries to return (default 5).
 * @returns Array of KnowledgeBaseEntry records with coreLogic + systemPromptTemplate.
 */
export async function queryKnowledgeBase(tags: string[], limit: number = 5): Promise<Array<{
  title: string;
  category: string;
  content: string;
  coreLogic: string | null;
  systemPromptTemplate: string | null;
  toolsRequired: string[];
  tags: string[];
}>> {
  try {
    const { db } = await import("./db");
    // Query entries where the tags JSON array contains any of the requested tags.
    // Since tags is stored as a JSON string, we use a string-contains search.
    const entries = await db.knowledgeBaseEntry.findMany({
      where: {
        OR: tags.flatMap((tag) => [
          { tags: { contains: tag } },
          { coreLogic: { contains: tag, not: null } },
          { content: { contains: tag } },
        ]),
      },
      take: limit,
      orderBy: { successRate: "desc" },
    });
    return entries.map((e) => ({
      title: e.title,
      category: e.category,
      content: e.content,
      coreLogic: e.coreLogic,
      systemPromptTemplate: e.systemPromptTemplate,
      toolsRequired: safeParseJsonArray(e.toolsRequired),
      tags: safeParseJsonArray(e.tags),
    }));
  } catch {
    return [];
  }
}

/**
 * v61.3 Phase 8: List all skill slugs from the DB (not the hardcoded array).
 */
export async function listAllSkillSlugs(): Promise<string[]> {
  try {
    const { db } = await import("./db");
    const skills = await db.skill.findMany({
      where: { status: "active" },
      select: { slug: true },
    });
    if (skills.length > 0) {
      return skills.map((s) => s.slug);
    }
  } catch {
    // DB unavailable — fall through to the hardcoded list.
  }
  return listSkillPatternSlugs();
}

/**
 * Helper: safely parse a JSON array string.
 */
function safeParseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
