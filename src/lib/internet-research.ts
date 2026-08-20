/**
 * src/lib/internet-research.ts — v61 Phase 5 (Internet Research for Complex Tasks)
 *
 * Owner's rule: "Include checking skill files and intelligence from internet
 * also for complex and lengthy tasks and enhance prompt always for user
 * requested tasks and agent given tasks."
 *
 * Before executing a high-complexity task, the system can use Z-AI's
 * web_search function to pull fresh context from the internet + inject
 * it into the prompt. This gives the LLM up-to-date information for tasks
 * like:
 *   - Research (competitor analysis, market trends)
 *   - Code generation (latest library APIs, best practices)
 *   - Outreach (company news, recent funding)
 *   - Compliance (latest GDPR/CCPA requirements)
 *
 * Optimization for Oracle Free Tier: only run internet research for
 * tasks marked complexity='high' or 'research'. Low/medium tasks skip
 * this step to conserve LLM calls.
 */

import "server-only";
import { logger } from "./logger";

export interface ResearchResult {
  /** Whether the research succeeded. */
  ok: boolean;
  /** The query used. */
  query: string;
  /** The synthesized research summary (max 2000 chars). */
  summary: string;
  /** Source URLs cited. */
  sources: string[];
  /** Number of results found. */
  resultCount: number;
}

/**
 * Run internet research for a task using Z-AI's web_search function.
 *
 * @param taskDescription The task description to research.
 * @param maxResults Max results to return (default 5).
 * @returns The research result with a synthesized summary + sources.
 */
export async function researchTaskContext(
  taskDescription: string,
  maxResults: number = 5,
): Promise<ResearchResult> {
  const query = taskDescription.slice(0, 200);

  try {
    // v78 Phase 28: Use unified webSearchWithFallback.
    const { webSearchWithFallback } = await import("./utils/web-search-fallback");

    const searchResults = await webSearchWithFallback(query, maxResults);

    if (!searchResults || searchResults.length === 0) {
      return { ok: false, query, summary: "", sources: [], resultCount: 0 };
    }

    const results = searchResults;
    const sources: string[] = [];
    const summaries: string[] = [];

    for (const r of results.slice(0, maxResults)) {
      const title = (r as { title?: string; name?: string }).title ?? (r as { name?: string }).name ?? "(untitled)";
      const url = (r as { url?: string; link?: string; uri?: string }).url ?? (r as { link?: string }).link ?? (r as { uri?: string }).uri ?? "";
      const snippet = (r as { snippet?: string; description?: string; summary?: string }).snippet ?? (r as { description?: string }).description ?? (r as { summary?: string }).summary ?? "";
      if (url) sources.push(url);
      summaries.push(`• ${title}: ${snippet.slice(0, 200)}`);
    }

    const summary = summaries.join("\n").slice(0, 2000);

    logger.info("internet-research.complete", {
      query: query.slice(0, 80),
      resultCount: results.length,
      sources: sources.length,
    });

    return {
      ok: true,
      query,
      summary,
      sources,
      resultCount: results.length,
    };
  } catch (err) {
    logger.warn("internet-research.failed", { query: query.slice(0, 80), error: String(err) });
    return { ok: false, query, summary: "", sources: [], resultCount: 0 };
  }
}

/**
 * Enhance a task prompt with internet research + skill file context.
 *
 * Called by the step-debate for high-complexity tasks. Pulls:
 *   1. Internet research (via Z-AI web_search)
 *   2. Full skill file context (via loadFullSkillContext)
 *   3. Global logics (via buildGlobalLogicsPrompt)
 *
 * All three are merged into the original prompt to give the LLM maximum
 * context for production-grade output.
 */
export async function enhancePromptWithResearch(
  originalPrompt: string,
  taskDescription: string,
  skillSlug?: string,
  complexity: "low" | "medium" | "high" = "medium",
): Promise<string> {
  // Only enhance for high-complexity tasks (Oracle Free Tier optimization).
  if (complexity !== "high") {
    return originalPrompt;
  }

  let enhanced = originalPrompt;

  // 1. Internet research.
  try {
    const research = await researchTaskContext(taskDescription);
    if (research.ok && research.summary) {
      enhanced += `\n\nINTERNET RESEARCH (fresh context for this task):\n${research.summary}`;
      if (research.sources.length > 0) {
        enhanced += `\n\nSources:\n${research.sources.slice(0, 3).join("\n")}`;
      }
    }
  } catch {
    // best-effort — don't fail the task if research fails.
  }

  // 2. Full skill file context (if a skill slug is provided).
  if (skillSlug) {
    try {
      const { loadFullSkillContext } = await import("./skill-patterns");
      const fullContext = await loadFullSkillContext(skillSlug, 4000);
      if (fullContext && fullContext.length > 100) {
        enhanced += `\n\nFULL SKILL CONTEXT (${skillSlug}):\n${fullContext}`;
      }
    } catch {
      // best-effort.
    }
  }

  // 3. v61.3 Phase 8: Query the KnowledgeBaseEntry table for real extracted
  // patterns from the 500-AI-Agents-Projects repo. This gives the LLM access
  // to the actual algorithmic approaches (coreLogic + systemPromptTemplate)
  // used by 20+ reference agent implementations — not generic summaries.
  try {
    const { queryKnowledgeBase } = await import("./skill-patterns");
    // Derive tags from the task description.
    const tags = deriveTagsFromTask(taskDescription);
    if (tags.length > 0) {
      const kbEntries = await queryKnowledgeBase(tags, 3);
      if (kbEntries.length > 0) {
        const kbBlock = kbEntries
          .map(
            (e, i) =>
              `### Pattern ${i + 1}: ${e.title}\n` +
              `**Category:** ${e.category}\n` +
              `**Tags:** ${e.tags.join(", ")}\n` +
              `**Tools required:** ${e.toolsRequired.join(", ") || "none"}\n` +
              `**Core logic:**\n${e.coreLogic ?? "(not extracted)"}\n` +
              (e.systemPromptTemplate
                ? `**System prompt template:**\n\`\`\`\n${e.systemPromptTemplate.slice(0, 1000)}\n\`\`\`\n`
                : ""),
          )
          .join("\n---\n\n");
        enhanced += `\n\nKNOWLEDGE BASE PATTERNS (from 500-AI-Agents-Projects repo, matched by tags: ${tags.join(", ")}):\n${kbBlock}`;
      }
    }
  } catch {
    // best-effort — don't fail the task if KB query fails.
  }

  return enhanced;
}

/**
 * v61.3 Phase 8: Derive search tags from the task description.
 * Maps common task keywords to the tags used in the KnowledgeBaseEntry table.
 */
function deriveTagsFromTask(taskDescription: string): string[] {
  const lower = taskDescription.toLowerCase();
  const tags: string[] = [];
  if (/debate|multi-agent|council|proposer|critic/.test(lower)) tags.push("multi-agent-debate");
  if (/code.?review|pull.?request|pr/.test(lower)) tags.push("code-review");
  if (/research|analyz|investigat/.test(lower)) tags.push("research");
  if (/email|outreach|draft/.test(lower)) tags.push("email-drafting");
  if (/summariz|summary|digest/.test(lower)) tags.push("news-summarizer");
  if (/sql|database|query/.test(lower)) tags.push("sql-query");
  if (/pdf|document/.test(lower)) tags.push("pdf-qa");
  if (/test|unit.?test|coverage/.test(lower)) tags.push("unit-test");
  if (/doc|documentation|readme/.test(lower)) tags.push("documentation");
  if (/support|ticket|customer/.test(lower)) tags.push("customer-support");
  if (/stock|finance|market/.test(lower)) tags.push("stock-research");
  if (/travel|plan|itinerary/.test(lower)) tags.push("travel-planner");
  if (/resume|cv|job/.test(lower)) tags.push("resume-parser");
  if (/meeting|notes|transcript/.test(lower)) tags.push("meeting-notes");
  if (/github|issue|triager/.test(lower)) tags.push("github-issue");
  if (/competitor|competitive/.test(lower)) tags.push("competitive-analysis");
  if (/social|media|content/.test(lower)) tags.push("social-media");
  if (/recipe|food/.test(lower)) tags.push("recipe");
  // Add framework tags.
  if (/langgraph|langchain|crewai|autogen|agno/.test(lower)) {
    const frameworkMatch = lower.match(/(langgraph|langchain|crewai|autogen|agno)/);
    if (frameworkMatch) tags.push(frameworkMatch[1]);
  }
  return tags;
}
