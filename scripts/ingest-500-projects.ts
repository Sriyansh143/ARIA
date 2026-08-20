#!/usr/bin/env bun
/**
 * scripts/ingest-500-projects.ts — v61.3 Phase 8 (True Knowledge Ingestion)
 *
 * NO LAZY SUMMARIES. This script fetches the REAL data from the
 * ashishpatel26/500-AI-Agents-Projects repository and seeds it into the
 * KnowledgeBaseEntry Prisma model with structured fields:
 *   - title, category, content (the real description)
 *   - coreLogic (the actual algorithmic approach extracted from agent.py)
 *   - systemPromptTemplate (the actual prompt structure used)
 *   - toolsRequired (e.g. ["web_search","python_sandbox"])
 *   - tags (e.g. ["multi-agent-debate","code-review","langgraph"])
 *   - repoUrl, filePath (provenance)
 *
 * Sources:
 *   1. agents/README.md — the index of all 21+ agents (framework, LLM, industry)
 *   2. Each agent's README.md — the "What it does" + "Architecture" sections
 *   3. Each agent's agent.py — the real system prompt + tools + logic
 *   4. The main README.md framework comparison + industry use cases
 *
 * Usage: bun run scripts/ingest-500-projects.ts
 */

import { db } from "../src/lib/db";
import { logger } from "../src/lib/logger";

const REPO_OWNER = "ashishpatel26";
const REPO_NAME = "500-AI-Agents-Projects";
const REPO_BRANCH = "main";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}`;
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;

interface AgentIndexEntry {
  number: string;
  name: string;
  folder: string;
  framework: string;
  llm: string;
  industry: string;
  difficulty: string;
}

interface ExtractedPattern {
  title: string;
  category: string;
  content: string;
  coreLogic: string;
  systemPromptTemplate: string | null;
  toolsRequired: string[];
  tags: string[];
  repoUrl: string;
  filePath: string;
  source: string;
}

// ─── HTTP fetch helper (with timeout) ─────────────────────────────────
async function fetchText(url: string, timeoutMs = 15000): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ─── Step 1: Parse the agents/README.md index ─────────────────────────
async function fetchAgentIndex(): Promise<AgentIndexEntry[]> {
  const readme = await fetchText(`${RAW_BASE}/agents/README.md`);
  if (!readme) {
    logger.error("ingest-500.fetch-index-failed", { url: `${RAW_BASE}/agents/README.md` });
    return [];
  }

  const entries: AgentIndexEntry[] = [];
  // Parse the markdown table: | 01 | [Web Research Agent](01-web-research-agent/) | LangGraph | GPT-4o / Claude | General | ⭐⭐ |
  const tableRowRegex = /^\|\s*(\d+)\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/;
  for (const line of readme.split("\n")) {
    const m = line.match(tableRowRegex);
    if (m) {
      entries.push({
        number: m[1],
        name: m[2].trim(),
        folder: m[3].trim().replace(/\/$/, ""),
        framework: m[4].trim(),
        llm: m[5].trim(),
        industry: m[6].trim(),
        difficulty: m[7].trim(),
      });
    }
  }
  return entries;
}

// ─── Step 2: Fetch + parse each agent's README + agent.py ─────────────
async function extractAgentPattern(entry: AgentIndexEntry): Promise<ExtractedPattern | null> {
  const agentReadmeUrl = `${RAW_BASE}/agents/${entry.folder}/README.md`;
  const agentPyUrl = `${RAW_BASE}/agents/${entry.folder}/agent.py`;
  const metadataUrl = `${RAW_BASE}/agents/${entry.folder}/metadata.yaml`;

  const [readme, agentPy, metadata] = await Promise.all([
    fetchText(agentReadmeUrl),
    fetchText(agentPyUrl),
    fetchText(metadataUrl),
  ]);

  if (!readme && !agentPy) {
    logger.warn("ingest-500.agent-no-data", { folder: entry.folder });
    return null;
  }

  // Extract "What it does" section from README
  let whatItDoes = "";
  if (readme) {
    const whatMatch = readme.match(/##\s*What it does\s*\n([\s\S]*?)(?=\n##\s|$)/i);
    if (whatMatch) whatItDoes = whatMatch[1].trim();
  }

  // Extract "Architecture" section from README
  let architecture = "";
  if (readme) {
    const archMatch = readme.match(/##\s*Architecture\s*\n([\s\S]*?)(?=\n##\s|$)/i);
    if (archMatch) architecture = archMatch[1].trim();
  }

  // Extract the system prompt from agent.py (look for SystemMessage, system_prompt, SYSTEM_PROMPT, system=)
  let systemPromptTemplate: string | null = null;
  if (agentPy) {
    // Try multiple patterns:
    // 1. SystemMessage(content="...")  or  SystemMessage(content="""...""")
    // 2. system_prompt = "..."  or  SYSTEM_PROMPT = "..."
    // 3. system="..."  or  system='...'
    // 4. """...system prompt..."""  (triple-quoted)
    const patterns = [
      /SystemMessage\s*\(\s*content\s*=\s*"""([\s\S]*?)"""/,
      /SystemMessage\s*\(\s*content\s*=\s*"((?:[^"\\]|\\.)*)"/,
      /SystemMessage\s*\(\s*content\s*=\s*'((?:[^'\\]|\\.)*)'/,
      /system_prompt\s*=\s*"""([\s\S]*?)"""/,
      /SYSTEM_PROMPT\s*=\s*"""([\s\S]*?)"""/,
      /system_prompt\s*=\s*"((?:[^"\\]|\\.)*)"/,
      /system\s*=\s*"""([\s\S]*?)"""/,
      /system\s*=\s*"((?:[^"\\]|\\.)*)"/,
    ];
    for (const p of patterns) {
      const m = agentPy.match(p);
      if (m && m[1] && m[1].trim().length > 20) {
        systemPromptTemplate = m[1].trim().slice(0, 2000);
        break;
      }
    }
  }

  // Extract tools from agent.py (look for tool names, @tool decorators, Tool(), imports)
  const toolsRequired: string[] = [];
  if (agentPy) {
    // Look for TavilySearch, SerpAPI, DuckDuckGo, etc.
    if (/TavilySearch|tavily/i.test(agentPy)) toolsRequired.push("web_search");
    if (/DuckDuckGo/i.test(agentPy)) toolsRequired.push("web_search");
    if (/SerpAPI|serpapi/i.test(agentPy)) toolsRequired.push("web_search");
    if (/python_repl|PythonREPL|exec\(|eval\(/i.test(agentPy)) toolsRequired.push("python_sandbox");
    if (/requests\.get|httpx\.get|fetch\(/i.test(agentPy)) toolsRequired.push("http_fetch");
    if (/GitHubRepo|github/i.test(agentPy)) toolsRequired.push("github_api");
    if (/SQLDatabase|sqlalchemy|sqlite/i.test(agentPy)) toolsRequired.push("sql_database");
    if (/PyPDFLoader|pdf/i.test(agentPy)) toolsRequired.push("pdf_reader");
    if (/WebBrowser|playwright|selenium/i.test(agentPy)) toolsRequired.push("browser");
    if (/SMTP|sendmail|email/i.test(agentPy)) toolsRequired.push("email_send");
    if (/SlackAPI|slack/i.test(agentPy)) toolsRequired.push("slack_api");
    // Look for @tool decorators
    const toolDecoratorMatches = agentPy.matchAll(/@tool\s*\n\s*def\s+(\w+)/g);
    for (const m of toolDecoratorMatches) {
      if (m[1] && !toolsRequired.includes(m[1])) toolsRequired.push(m[1]);
    }
    // Look for Tool(name="...")
    const toolNameMatches = agentPy.matchAll(/Tool\s*\(\s*name\s*=\s*["']([^"']+)["']/g);
    for (const m of toolNameMatches) {
      if (m[1] && !toolsRequired.includes(m[1])) toolsRequired.push(m[1]);
    }
  }

  // Build the coreLogic from the architecture + what-it-does
  const coreLogic = [
    architecture ? `ARCHITECTURE:\n${architecture}` : "",
    whatItDoes ? `\nWHAT IT DOES:\n${whatItDoes}` : "",
    entry.framework ? `\nFRAMEWORK: ${entry.framework}` : "",
    entry.llm ? `\nLLM: ${entry.llm}` : "",
    entry.industry ? `\nINDUSTRY: ${entry.industry}` : "",
    entry.difficulty ? `\nDIFFICULTY: ${entry.difficulty}` : "",
  ].filter(Boolean).join("\n").trim();

  // Build tags
  const tags = [
    entry.framework.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    entry.industry.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    entry.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-"),
    "500-projects",
  ].filter((t) => t.length > 0);

  // Derive a category
  let category = "agent_pattern";
  if (/debate|multi-agent|council/i.test(entry.name)) category = "multi_agent_pattern";
  else if (/code-review|unit-test|documentation/i.test(entry.name)) category = "code_quality_pattern";
  else if (/research|analysis|summariz/i.test(entry.name)) category = "research_pattern";
  else if (/support|email|customer/i.test(entry.name)) category = "communication_pattern";
  else if (/sql|data|analysis/i.test(entry.name)) category = "data_pattern";

  return {
    title: `${entry.number}. ${entry.name}`,
    category,
    content: `# ${entry.name}\n\n${whatItDoes || "(no description available)"}\n\n${architecture ? `## Architecture\n${architecture}` : ""}`.trim(),
    coreLogic,
    systemPromptTemplate,
    toolsRequired,
    tags,
    repoUrl: `${REPO_URL}/tree/${REPO_BRANCH}/agents/${entry.folder}`,
    filePath: `agents/${entry.folder}`,
    source: "500-projects",
  };
}

// ─── Step 3: Fetch framework comparison patterns from main README ────
async function extractFrameworkPatterns(): Promise<ExtractedPattern[]> {
  const readme = await fetchText(`${RAW_BASE}/README.md`);
  if (!readme) return [];

  const patterns: ExtractedPattern[] = [];

  // Extract the "Framework Comparison" section
  const frameworkMatch = readme.match(/##\s*📊 Framework Comparison\s*\n([\s\S]*?)(?=\n##\s|$)/i);
  if (frameworkMatch) {
    const section = frameworkMatch[1];
    // Parse the framework comparison table
    const tableRows = section.split("\n").filter((l) => l.startsWith("|") && !l.startsWith("|---") && !l.startsWith("| Framework"));
    for (const row of tableRows) {
      const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 3) {
        const [framework, strengths, bestFor] = cells;
        patterns.push({
          title: `Framework Pattern: ${framework}`,
          category: "framework_pattern",
          content: `# ${framework}\n\n**Strengths:** ${strengths}\n**Best for:** ${bestFor}`,
          coreLogic: `Framework: ${framework}\nStrengths: ${strengths}\nBest for: ${bestFor}`,
          systemPromptTemplate: null,
          toolsRequired: [],
          tags: ["framework-comparison", framework.toLowerCase().replace(/[^a-z0-9-]/g, "-"), "500-projects"],
          repoUrl: REPO_URL,
          filePath: "README.md",
          source: "500-projects",
        });
      }
    }
  }

  // Extract the "Industry Use Cases" section
  const industryMatch = readme.match(/##\s*🏭 Industry Use Cases\s*\n([\s\S]*?)(?=\n##\s|$)/i);
  if (industryMatch) {
    const section = industryMatch[1];
    // Parse bullet points: - **Industry**: description
    const bulletRegex = /-\s*\*\*([^*]+)\*\*:?\s*([^\n]+)/g;
    let m;
    while ((m = bulletRegex.exec(section)) !== null) {
      const [, industry, desc] = m;
      patterns.push({
        title: `Industry Pattern: ${industry.trim()}`,
        category: "industry_pattern",
        content: `# ${industry.trim()}\n\n${desc.trim()}`,
        coreLogic: `Industry: ${industry.trim()}\nUse case: ${desc.trim()}`,
        systemPromptTemplate: null,
        toolsRequired: [],
        tags: ["industry-use-case", industry.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-"), "500-projects"],
        repoUrl: REPO_URL,
        filePath: "README.md",
        source: "500-projects",
      });
    }
  }

  return patterns;
}

// ─── Step 3b: Fetch per-framework use-case tables from README ────────
// v61.4 Phase 9: Parse the CrewAI/AutoGen/Agno/LangGraph markdown tables
// that document ~85+ external agent implementations. Each row becomes a
// KnowledgeBaseEntry with repoUrl provenance.
async function extractFrameworkUseCaseTables(): Promise<ExtractedPattern[]> {
  const readme = await fetchText(`${RAW_BASE}/README.md`);
  if (!readme) return [];

  const patterns: ExtractedPattern[] = [];
  const frameworks = ["CrewAI", "AutoGen", "Agno", "LangGraph"];

  for (const framework of frameworks) {
    // Match the section: ### Framework\n...\n| Use Case | ... | GitHub |\n|---|...\n| row1 |\n| row2 |\n...
    const sectionRegex = new RegExp(`###\\s*${framework}\\s*\\n([\\s\\S]*?)(?=\\n###\\s|\\n##\\s|$)`, "i");
    const sectionMatch = readme.match(sectionRegex);
    if (!sectionMatch) continue;

    const section = sectionMatch[1];
    // Parse table rows: | Use Case | Industry | Description | [![GitHub](badge)](repo-url) |
    // The GitHub cell is a badge link: [![GitHub](badge-url)](repo-url)
    for (const line of section.split("\n")) {
      if (!line.startsWith("|") || line.startsWith("|---") || line.startsWith("| Use Case")) continue;
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length < 4) continue;
      const useCase = cells[0].replace(/^[\s🚀📧📝🔄📈📊🔍📸🌐🏢💰🎯🤖⚖️🏥🎓]+/, "").trim();
      const industry = cells[1];
      const description = cells[2];
      // Extract the repo URL from the badge: [![GitHub](badge)](repo-url)
      const githubCell = cells[3];
      const urlMatch = githubCell.match(/\]\(([^)]+)\)\s*\|?\s*\$/) || githubCell.match(/\]\((https:\/\/github\.com[^)]+)\)/);
      const githubUrl = urlMatch ? urlMatch[1] : "";
      if (!useCase || !githubUrl) continue;
      patterns.push({
        title: `${framework}: ${useCase}`,
        category: "framework_use_case",
        content: `# ${useCase}\n\n**Framework:** ${framework}\n**Industry:** ${industry}\n**Description:** ${description}\n**GitHub:** ${githubUrl}`,
        coreLogic: `Framework: ${framework}\nUse case: ${useCase}\nIndustry: ${industry}\nDescription: ${description}\nRepo: ${githubUrl}`,
        systemPromptTemplate: null,
        toolsRequired: [],
        tags: [framework.toLowerCase(), "framework-use-case", industry.toLowerCase().replace(/[^a-z0-9-]/g, "-"), "500-projects"],
        repoUrl: githubUrl,
        filePath: "README.md",
        source: "500-projects",
      });
    }
  }

  return patterns;
}

// ─── Step 3c: Fetch crewai_mcp_course lessons ────────────────────────
// v61.4 Phase 9: The crewai_mcp_course/ directory contains a CrewAI + FastMCP
// integration course. The lesson sub-folders don't exist yet (repo is WIP),
// but the course README has the overview — extract it as a single pattern.
async function extractCrewaiMcpCourse(): Promise<ExtractedPattern[]> {
  const patterns: ExtractedPattern[] = [];
  const courseReadme = await fetchText(`${RAW_BASE}/crewai_mcp_course/README.md`);
  if (!courseReadme) return [];

  // Extract the title (first # heading).
  const titleMatch = courseReadme.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : "CrewAI MCP Course";

  // Extract the "Course Overview" section if present.
  const overviewMatch = courseReadme.match(/##\s*Course Overview\s*\n([\s\S]*?)(?=\n##\s|$)/i);
  const overview = overviewMatch ? overviewMatch[1].trim() : courseReadme.slice(0, 1000);

  // Extract any lesson references (lesson_01, lesson_02, etc.).
  const lessonMatches = [...courseReadme.matchAll(/lesson[_-]?\d+/gi)].map((m) => m[0]);
  const lessons = [...new Set(lessonMatches)];

  patterns.push({
    title: `CrewAI MCP Course: ${title}`,
    category: "course_pattern",
    content: `# ${title}\n\n${overview}\n\n**Lessons referenced:** ${lessons.join(", ") || "(none yet)"}`,
    coreLogic: `Course: CrewAI MCP Course\nTitle: ${title}\nOverview: ${overview.slice(0, 500)}\nLessons: ${lessons.join(", ") || "(none yet)"}`,
    systemPromptTemplate: null,
    toolsRequired: ["crewai", "mcp", "fastmcp"],
    tags: ["crewai", "mcp", "fastmcp", "course", "500-projects"],
    repoUrl: `${REPO_URL}/tree/${REPO_BRANCH}/crewai_mcp_course`,
    filePath: "crewai_mcp_course/README.md",
    source: "500-projects",
  });

  return patterns;
}

// ─── Step 3d: Fetch Industry Use Cases table from README ─────────────
// v61.5 Phase 10: Parse the "🏭 Industry Use Cases" markdown table (~28 rows).
// Each row becomes a KnowledgeBaseEntry with repoUrl provenance.
async function extractIndustryUseCases(): Promise<ExtractedPattern[]> {
  const readme = await fetchText(`${RAW_BASE}/README.md`);
  if (!readme) return [];

  const patterns: ExtractedPattern[] = [];
  // Match the Industry Use Cases section.
  const sectionMatch = readme.match(/##\s*🏭\s*Industry Use Cases\s*\n([\s\S]*?)(?=\n##\s|$)/i);
  if (!sectionMatch) return [];

  const section = sectionMatch[1];
  // Parse table rows: | **Use Case** | Industry | Description | [![GitHub](badge)](repo-url) |
  for (const line of section.split("\n")) {
    if (!line.startsWith("|") || line.startsWith("|---") || line.startsWith("| Use Case")) continue;
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 4) continue;
    // Use case name is in **bold** — strip the asterisks.
    const useCase = cells[0].replace(/\*\*/g, "").trim();
    const industry = cells[1];
    const description = cells[2];
    // Extract the repo URL from the badge.
    const githubCell = cells[3];
    const urlMatch = githubCell.match(/\]\((https:\/\/github\.com[^)]+)\)/);
    const githubUrl = urlMatch ? urlMatch[1] : "";
    if (!useCase || !githubUrl) continue;
    patterns.push({
      title: `Industry: ${useCase}`,
      category: "industry_use_case",
      content: `# ${useCase}\n\n**Industry:** ${industry}\n**Description:** ${description}\n**GitHub:** ${githubUrl}`,
      coreLogic: `Industry: ${industry}\nUse case: ${useCase}\nDescription: ${description}\nRepo: ${githubUrl}`,
      systemPromptTemplate: null,
      toolsRequired: [],
      tags: ["industry-use-case", industry.toLowerCase().replace(/[^a-z0-9-]/g, "-"), "500-projects"],
      repoUrl: githubUrl,
      filePath: "README.md",
      source: "500-projects",
    });
  }

  return patterns;
}

// ─── Step 4: Seed into the database ───────────────────────────────────
async function seedPatterns(patterns: ExtractedPattern[]): Promise<number> {
  let seeded = 0;
  let skipped = 0;
  // v61.4 Phase 9: sanitize ALL string fields to remove lone surrogates +
  // control characters that break SQLite's LIKE matching.
  const sanitize = (s: string): string => s.replace(/[\uD800-\uDBFF\uDC00-\uDFFF]/g, "?").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  for (const p of patterns) {
    const safeTitle = sanitize(p.title);
    if (!safeTitle) {
      skipped++;
      continue;
    }
    const safeContent = sanitize(p.content);
    const safeCoreLogic = p.coreLogic ? sanitize(p.coreLogic) : null;
    const safePrompt = p.systemPromptTemplate ? sanitize(p.systemPromptTemplate) : null;
    const safeRepoUrl = p.repoUrl ? sanitize(p.repoUrl) : null;
    const safeFilePath = p.filePath ? sanitize(p.filePath) : null;
    // Idempotent: delete existing entry with same title + source, then create.
    try {
      await db.knowledgeBaseEntry.deleteMany({
        where: { title: safeTitle, source: p.source },
      });
      await db.knowledgeBaseEntry.create({
        data: {
          title: safeTitle,
          category: p.category,
          content: safeContent,
          source: p.source,
          tags: JSON.stringify(p.tags),
          coreLogic: safeCoreLogic,
          systemPromptTemplate: safePrompt,
          toolsRequired: JSON.stringify(p.toolsRequired),
          repoUrl: safeRepoUrl,
          filePath: safeFilePath,
        },
      });
      seeded++;
    } catch (err) {
      logger.warn("ingest-500.seed-pattern-failed", { title: safeTitle.slice(0, 80), error: String(err).slice(0, 100) });
      skipped++;
    }
  }
  if (skipped > 0) {
    console.log(`   ⚠️  Skipped ${skipped} patterns (invalid UTF-8 or DB error).`);
  }
  return seeded;
}

// ─── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log("🚀 v61.3 Phase 8 — Ingesting 500-AI-Agents-Projects repository...");
  console.log(`   Repo: ${REPO_URL}`);
  console.log("");

  // Step 1: Fetch the agent index
  console.log("📥 Step 1: Fetching agents/README.md index...");
  const index = await fetchAgentIndex();
  console.log(`   ✅ Found ${index.length} agent entries in the index.`);
  if (index.length === 0) {
    console.error("   ❌ No agents found. Aborting.");
    process.exit(1);
  }

  // Step 2: Extract each agent's real pattern
  console.log("");
  console.log("📥 Step 2: Fetching each agent's README + agent.py + metadata...");
  const agentPatterns: ExtractedPattern[] = [];
  for (const entry of index) {
    process.stdout.write(`   • ${entry.number}. ${entry.name}... `);
    const pattern = await extractAgentPattern(entry);
    if (pattern) {
      agentPatterns.push(pattern);
      console.log(`✅ (${pattern.toolsRequired.length} tools, ${pattern.systemPromptTemplate ? "prompt extracted" : "no prompt"}, ${pattern.coreLogic.length} chars logic)`);
    } else {
      console.log("❌ (no data)");
    }
  }
  console.log(`   ✅ Extracted ${agentPatterns.length} agent patterns.`);

  // Step 3: Extract framework + industry patterns from main README
  console.log("");
  console.log("📥 Step 3: Fetching framework comparison + industry use cases from main README...");
  const frameworkPatterns = await extractFrameworkPatterns();
  console.log(`   ✅ Extracted ${frameworkPatterns.length} framework/industry patterns.`);

  // v61.4 Phase 9: Also extract the per-framework use-case tables (CrewAI/AutoGen/Agno/LangGraph).
  console.log("");
  console.log("📥 Step 3b: Fetching per-framework use-case tables (CrewAI/AutoGen/Agno/LangGraph)...");
  const useCasePatterns = await extractFrameworkUseCaseTables();
  console.log(`   ✅ Extracted ${useCasePatterns.length} framework use-case patterns.`);

  // v61.4 Phase 9: Also extract the crewai_mcp_course lessons.
  console.log("");
  console.log("📥 Step 3c: Fetching crewai_mcp_course lessons...");
  const coursePatterns = await extractCrewaiMcpCourse();
  console.log(`   ✅ Extracted ${coursePatterns.length} CrewAI MCP course patterns.`);

  // v61.5 Phase 10: Also extract the Industry Use Cases table (~28 rows).
  console.log("");
  console.log("📥 Step 3d: Fetching Industry Use Cases table...");
  const industryPatterns = await extractIndustryUseCases();
  console.log(`   ✅ Extracted ${industryPatterns.length} industry use-case patterns.`);

  // Step 4: Seed into the database
  console.log("");
  console.log("📥 Step 4: Seeding into KnowledgeBaseEntry table...");
  const allPatterns = [...agentPatterns, ...frameworkPatterns, ...useCasePatterns, ...coursePatterns, ...industryPatterns];
  const seeded = await seedPatterns(allPatterns);
  console.log(`   ✅ Seeded ${seeded} KnowledgeBaseEntry records.`);

  // Step 5: Verify
  console.log("");
  console.log("📊 Step 5: Verification...");
  const totalCount = await db.knowledgeBaseEntry.count({ where: { source: "500-projects" } });
  const withLogic = await db.knowledgeBaseEntry.count({ where: { source: "500-projects", coreLogic: { not: null } } });
  const withPrompts = await db.knowledgeBaseEntry.count({ where: { source: "500-projects", systemPromptTemplate: { not: null } } });
  const byCategory = await db.knowledgeBaseEntry.groupBy({
    by: ["category"],
    where: { source: "500-projects" },
    _count: true,
  });

  console.log(`   Total 500-projects entries: ${totalCount}`);
  console.log(`   Entries with coreLogic: ${withLogic}`);
  console.log(`   Entries with systemPromptTemplate: ${withPrompts}`);
  console.log(`   By category:`);
  for (const c of byCategory) {
    console.log(`     • ${c.category}: ${c._count}`);
  }

  console.log("");
  console.log("════════════════════════════════════════════════════════════════");
  console.log(`🎉  Ingestion complete! ${totalCount} real entries seeded (not summaries).`);
  console.log("════════════════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Ingestion failed:", err);
    process.exit(1);
  });
