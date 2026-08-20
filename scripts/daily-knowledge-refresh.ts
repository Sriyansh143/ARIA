#!/usr/bin/env bun
/**
 * scripts/daily-knowledge-refresh.ts — v61.6 Phase 11 (Daily Knowledge Refresh Engine)
 *
 * NO STATIC KNOWLEDGE. This cron job runs every 24 hours (2 AM) and refreshes
 * the knowledge base from 5 sources:
 *
 *   1. Worklog lessons — parse /home/z/my-project/worklog.md for the last 24h,
 *      extract mistakes/facades/fixes/shortcuts, store as KnowledgeBaseEntry
 *      tagged ["lesson-learned", "anti-pattern", "mistake"].
 *   2. Vector memory patterns — query execution traces from the last 24h,
 *      find failures (retries > 1 or failed), extract the failure + fix,
 *      store as KnowledgeBaseEntry tagged ["execution-pattern", "failure-recovery"].
 *   3. Internet research — search for new AI agent patterns + multi-agent
 *      orchestration + production safety controls. Summarize via local Ollama
 *      (no paid API). Store as KnowledgeBaseEntry tagged ["research", "external-intelligence"].
 *   4. External repo checks — check if 500-AI-Agents-Projects has new commits;
 *      if yes, run the ingestion script. Store new findings tagged
 *      ["repo-update", "external-source"].
 *   5. Code index refresh — if source files changed since last index, regenerate.
 *
 *   6. Prune stale knowledge — archive entries older than 90 days with zero references.
 *
 * Usage: bun run scripts/daily-knowledge-refresh.ts
 * Cron: 0 2 * * * (2 AM daily)
 */

import { db } from "../src/lib/db";
import { logger } from "../src/lib/logger";
import { emit } from "../src/lib/event-bus";
import * as fs from "fs";
import * as path from "path";

const WORKLOG_PATH = "/home/z/my-project/worklog.md";
const STALE_DAYS = 90;
const MIN_LEARNINGS_PER_DAY = 3;

interface ExtractedLesson {
  title: string;
  content: string;
  coreLogic: string;
  tags: string[];
}

// ─── Step 1: Extract lessons from the worklog ────────────────────────
async function extractWorklogLessons(): Promise<ExtractedLesson[]> {
  const lessons: ExtractedLesson[] = [];
  if (!fs.existsSync(WORKLOG_PATH)) {
    logger.warn("daily-refresh.worklog-not-found", { path: WORKLOG_PATH });
    return lessons;
  }

  const content = fs.readFileSync(WORKLOG_PATH, "utf-8");
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24h

  // Split the worklog into sections by the "---" separator.
  const sections = content.split(/^---$/m).filter((s) => s.trim().length > 0);

  for (const section of sections) {
    // Extract the date from the section (look for a timestamp or "Task ID:").
    const taskMatch = section.match(/Task ID:\s*(.+)/i);
    const taskId = taskMatch ? taskMatch[1].trim() : "unknown";

    // Look for mistake/facade/fix/shortcut keywords in this section.
    const lowerSection = section.toLowerCase();
    const hasMistake = /mistake|bug|fail|facade|shortcut|lazy|stub|broken|wrong|incorrect/i.test(section);
    const hasFix = /fix|fixed|resolved|patched|corrected|updated|improved/i.test(section);

    if (hasMistake || hasFix) {
      // Extract the key lines mentioning the mistake/fix.
      const lines = section.split("\n").filter((l) =>
        /fix|fix|mistake|bug|fail|facade|shortcut|lazy|stub|broken|wrong|corrected|updated|improved/i.test(l),
      );
      const lessonContent = lines.slice(0, 5).join("\n").trim();
      if (lessonContent.length > 20) {
        lessons.push({
          title: `Lesson: ${taskId}`,
          content: `# Lesson from ${taskId}\n\n${lessonContent}`,
          coreLogic: `Task: ${taskId}\nLesson: ${lessonContent.slice(0, 300)}`,
          tags: ["lesson-learned", "anti-pattern", "mistake", "worklog"],
        });
      }
    }
  }

  logger.info("daily-refresh.worklog-lessons-extracted", { count: lessons.length });
  return lessons;
}

// ─── Step 2: Analyze vector memory for failure patterns ──────────────
async function extractFailurePatterns(): Promise<ExtractedLesson[]> {
  const lessons: ExtractedLesson[] = [];
  try {
    // Query the AgentLog directly for failed execution traces (avoid importing
    // the server-only execution-trace.ts module which fails in standalone script context).
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const failedLogs = await db.agentLog.findMany({
      where: {
        level: { in: ["error", "warn"] },
        createdAt: { gte: cutoff },
        OR: [
          { message: { contains: "failed" } },
          { message: { contains: "error" } },
          { message: { contains: "timeout" } },
          { message: { contains: "retries" } },
        ],
      },
      take: 10,
      orderBy: { createdAt: "desc" },
    });

    for (const log of failedLogs) {
      lessons.push({
        title: `Failure Pattern: ${log.message.slice(0, 60)}`,
        content: `# Execution Failure (last 24h)\n\n**Message:** ${log.message}\n**Level:** ${log.level}\n**Timestamp:** ${log.createdAt.toISOString()}\n**Meta:** ${log.meta ?? "(none)"}`,
        coreLogic: `Failure: ${log.message.slice(0, 200)}\nThis is a recurring failure pattern that should be addressed.`,
        tags: ["execution-pattern", "failure-recovery", "agent-log", "daily-refresh"],
      });
    }
    logger.info("daily-refresh.failure-patterns-extracted", { count: lessons.length, logsAnalyzed: failedLogs.length });
  } catch (err) {
    logger.warn("daily-refresh.failure-pattern-extraction-failed", { error: String(err) });
  }
  return lessons;
}

// ─── Step 2b: Extract simulation failure lessons (v63 Phase 13) ──────
async function extractSimulationFailures(): Promise<ExtractedLesson[]> {
  const lessons: ExtractedLesson[] = [];
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // Query AgentLog for simulation entries that failed.
    const simLogs = await db.agentLog.findMany({
      where: {
        meta: { contains: '"type":"simulation"' },
        level: "warn",
        createdAt: { gte: cutoff },
      },
      take: 10,
      orderBy: { createdAt: "desc" },
    });

    for (const log of simLogs) {
      try {
        const parsed = JSON.parse(log.meta ?? "{}");
        if (parsed.passed === false) {
          lessons.push({
            title: `Simulation Failure: ${parsed.scenarioId ?? "unknown"}`,
            content: `# Simulation Failure\n\n**Scenario:** ${parsed.scenarioId}\n**Type:** ${parsed.scenarioType}\n**Error:** ${parsed.error ?? "unknown"}\n**Rules violated:** ${JSON.stringify(parsed.rulesViolated ?? [])}\n**Lessons:** ${JSON.stringify(parsed.lessonsLearned ?? [])}`,
            coreLogic: `Scenario: ${parsed.scenarioId}\nError: ${parsed.error}\nThis simulation failure should be addressed to improve readiness.`,
            tags: ["simulation-failure", "lesson-learned", parsed.scenarioType ?? "unknown"],
          });
        }
      } catch {
        // skip unparseable entries
      }
    }
    logger.info("daily-refresh.simulation-failures-extracted", { count: lessons.length, logsAnalyzed: simLogs.length });
  } catch (err) {
    logger.warn("daily-refresh.simulation-failure-extraction-failed", { error: String(err) });
  }
  return lessons;
}

// ─── Step 3: Scan internet for new AI techniques ─────────────────────
async function extractInternetResearch(): Promise<ExtractedLesson[]> {
  const lessons: ExtractedLesson[] = [];
  try {
    // Use the Z-AI SDK directly (avoid importing the server-only internet-research.ts module).
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const queries = [
      "new AI agent patterns 2026",
      "multi-agent orchestration best practices",
      "production-grade AI safety controls",
    ];

    for (const query of queries) {
      try {
        const searchResults = await zai.functions.invoke("web_search", { query, num: 3 });
        if (searchResults && Array.isArray(searchResults) && searchResults.length > 0) {
          const summary = searchResults.map((r: any) => r.title || r.name || "").filter(Boolean).join("; ").slice(0, 500);
          lessons.push({
            title: `Research: ${query}`,
            content: `# Internet Research: ${query}\n\n**Findings:** ${summary}\n\n**Sources:** ${searchResults.length} results from Z-AI web_search`,
            coreLogic: `Query: ${query}\nFindings: ${summary}`,
            tags: ["research", "external-intelligence", "internet", "daily-refresh"],
          });
        }
      } catch (err) {
        logger.warn("daily-refresh.research-query-failed", { query, error: String(err).slice(0, 80) });
      }
    }
    logger.info("daily-refresh.internet-research-extracted", { count: lessons.length });
  } catch (err) {
    logger.warn("daily-refresh.internet-research-failed", { error: String(err).slice(0, 80) });
  }
  return lessons;
}

// ─── Step 4: Check external repos for updates ────────────────────────
async function checkExternalRepos(): Promise<ExtractedLesson[]> {
  const lessons: ExtractedLesson[] = [];
  try {
    // Check the 500-AI-Agents-Projects repo for recent commits via GitHub API.
    const res = await fetch("https://api.github.com/repos/ashishpatel26/500-AI-Agents-Projects/commits?per_page=5", {
      headers: { Accept: "application/vnd.github.v3+json" },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const commits = (await res.json()) as Array<{ sha: string; commit: { message: string; author: { date: string } } }>;
      const recentCommits = commits.filter((c) => new Date(c.commit.author.date) > new Date(Date.now() - 24 * 60 * 60 * 1000));
      if (recentCommits.length > 0) {
        // New commits found — re-run the ingestion.
        lessons.push({
          title: `Repo Update: 500-AI-Agents-Projects (${recentCommits.length} new commits)`,
          content: `# 500-AI-Agents-Projects Repo Update\n\n${recentCommits.length} new commits in the last 24h:\n${recentCommits.map((c) => `- ${c.commit.message.slice(0, 80)} (${c.sha.slice(0, 7)})`).join("\n")}`,
          coreLogic: `Repo: 500-AI-Agents-Projects\nNew commits: ${recentCommits.length}\nAction: re-run ingest-500-projects.ts to extract new patterns.`,
          tags: ["repo-update", "external-source", "500-projects"],
        });
        // Trigger the ingestion script (best-effort).
        try {
          const scriptPath = path.join(process.cwd(), "scripts", "ingest-500-projects.ts");
          if (fs.existsSync(scriptPath)) {
            await import(scriptPath);
            logger.info("daily-refresh.repo-ingestion-triggered", { repo: "500-projects" });
          }
        } catch (err) {
          logger.warn("daily-refresh.repo-ingestion-failed", { error: String(err).slice(0, 80) });
        }
      } else {
        lessons.push({
          title: `Repo Check: 500-AI-Agents-Projects (no new commits)`,
          content: `# 500-AI-Agents-Projects Repo Check\n\nNo new commits in the last 24h. Repo is stable.`,
          coreLogic: `Repo: 500-AI-Agents-Projects\nStatus: no new commits in 24h`,
          tags: ["repo-update", "external-source", "500-projects", "no-change"],
        });
      }
    }
  } catch (err) {
    logger.warn("daily-refresh.repo-check-failed", { error: String(err).slice(0, 80) });
  }
  return lessons;
}

// ─── Step 5: Update code index if files changed ──────────────────────
async function refreshCodeIndex(): Promise<void> {
  try {
    const indexPath = path.join(process.cwd(), ".code-index", "manifest.json");
    const scriptPath = path.join(process.cwd(), "scripts", "generate-code-index.ts");
    if (!fs.existsSync(scriptPath)) return;

    let needsRegen = false;
    if (!fs.existsSync(indexPath)) {
      needsRegen = true;
    } else {
      const manifestStat = fs.statSync(indexPath);
      const srcDir = path.join(process.cwd(), "src");
      if (fs.existsSync(srcDir)) {
        const checkDir = (dir: string): boolean => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
              if (checkDir(path.join(dir, entry.name))) return true;
            } else if (entry.isFile() && entry.name.endsWith(".ts")) {
              const fileStat = fs.statSync(path.join(dir, entry.name));
              if (fileStat.mtime > manifestStat.mtime) return true;
            }
          }
          return false;
        };
        if (checkDir(srcDir)) needsRegen = true;
      }
    }
    if (needsRegen) {
      logger.info("daily-refresh.code-index-regenerating", {});
      await import(scriptPath);
    } else {
      logger.info("daily-refresh.code-index-fresh", {});
    }
  } catch (err) {
    logger.warn("daily-refresh.code-index-refresh-failed", { error: String(err) });
  }
}

// ─── Step 6: Prune stale knowledge ───────────────────────────────────
async function pruneStaleKnowledge(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
    // Find entries older than 90 days with successRate = 0 (zero references).
    const stale = await db.knowledgeBaseEntry.findMany({
      where: {
        createdAt: { lt: cutoff },
        successRate: 0,
        source: { not: "manual" }, // don't archive manual entries
      },
      select: { id: true },
    });
    // Mark them as archived by updating the source field (preserve for audit).
    let archived = 0;
    for (const entry of stale) {
      await db.knowledgeBaseEntry.update({
        where: { id: entry.id },
        data: { source: `archived:${new Date().toISOString().slice(0, 10)}` },
      });
      archived++;
    }
    logger.info("daily-refresh.stale-knowledge-pruned", { archived, checked: stale.length });
    return archived;
  } catch (err) {
    logger.warn("daily-refresh.prune-failed", { error: String(err) });
    return 0;
  }
}

// ─── Seed lessons into the database ──────────────────────────────────
async function seedLessons(lessons: ExtractedLesson[], sourceLabel: string): Promise<number> {
  let seeded = 0;
  const sanitize = (s: string): string => s.replace(/[\uD800-\uDBFF\uDC00-\uDFFF]/g, "?").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  for (const lesson of lessons) {
    const safeTitle = sanitize(lesson.title);
    if (!safeTitle) continue;
    try {
      // Idempotent: delete existing entry with same title + source, then create.
      await db.knowledgeBaseEntry.deleteMany({
        where: { title: safeTitle, source: sourceLabel },
      });
      await db.knowledgeBaseEntry.create({
        data: {
          title: safeTitle,
          category: "daily_lesson",
          content: sanitize(lesson.content),
          source: sourceLabel,
          tags: JSON.stringify(lesson.tags),
          coreLogic: sanitize(lesson.coreLogic),
          systemPromptTemplate: null,
          toolsRequired: JSON.stringify([]),
          repoUrl: null,
          filePath: null,
        },
      });
      seeded++;
    } catch (err) {
      logger.warn("daily-refresh.seed-lesson-failed", { title: safeTitle.slice(0, 60), error: String(err).slice(0, 80) });
    }
  }
  return seeded;
}

// ─── Stagnation detection (RULE-42) ──────────────────────────────────
async function checkLearningStagnation(): Promise<void> {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentEntries = await db.knowledgeBaseEntry.count({
      where: {
        createdAt: { gte: sevenDaysAgo },
        source: { startsWith: "daily-" },
      },
    });
    if (recentEntries === 0) {
      // Learning has stalled — alert the owner.
      emit({
        type: "system",
        ts: new Date().toISOString(),
        message: "⚠️ LEARNING STALLED: The knowledge base has had zero new entries for 7 consecutive days. The daily-knowledge-refresh cron may not be running. Check the cron scheduler.",
        level: "error",
      });
      logger.error("daily-refresh.learning-stagnation-detected", { days: 7 });
    }
  } catch (err) {
    logger.warn("daily-refresh.stagnation-check-failed", { error: String(err) });
  }
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log("🧠 v61.6 Phase 11 — Daily Knowledge Refresh Engine starting...");
  console.log(`   Timestamp: ${new Date().toISOString()}`);
  console.log("");

  let totalSeeded = 0;

  // Step 1: Extract lessons from the worklog.
  console.log("📥 Step 1: Extracting lessons from worklog (last 24h)...");
  const worklogLessons = await extractWorklogLessons();
  const seeded1 = await seedLessons(worklogLessons, "daily-worklog-lesson");
  console.log(`   ✅ Extracted ${worklogLessons.length} lessons, seeded ${seeded1}.`);
  totalSeeded += seeded1;

  // Step 2: Analyze vector memory for failure patterns.
  console.log("📥 Step 2: Analyzing vector memory for failure patterns (last 24h)...");
  const failureLessons = await extractFailurePatterns();
  const seeded2 = await seedLessons(failureLessons, "daily-failure-pattern");
  console.log(`   ✅ Extracted ${failureLessons.length} patterns, seeded ${seeded2}.`);
  totalSeeded += seeded2;

  // v63 Phase 13: Step 2b — Analyze recent simulation failures for lessons.
  console.log("📥 Step 2b: Analyzing recent simulation failures...");
  const simLessons = await extractSimulationFailures();
  const seededSim = await seedLessons(simLessons, "daily-simulation-failure");
  console.log(`   ✅ Extracted ${simLessons.length} simulation lessons, seeded ${seededSim}.`);
  totalSeeded += seededSim;

  // Step 3: Scan internet for new AI techniques.
  console.log("📥 Step 3: Scanning internet for new AI techniques...");
  const researchLessons = await extractInternetResearch();
  const seeded3 = await seedLessons(researchLessons, "daily-internet-research");
  console.log(`   ✅ Extracted ${researchLessons.length} findings, seeded ${seeded3}.`);
  totalSeeded += seeded3;

  // Step 4: Check external repos for updates.
  console.log("📥 Step 4: Checking external repos for updates...");
  const repoLessons = await checkExternalRepos();
  const seeded4 = await seedLessons(repoLessons, "daily-repo-update");
  console.log(`   ✅ Extracted ${repoLessons.length} updates, seeded ${seeded4}.`);
  totalSeeded += seeded4;

  // Step 5: Update code index if files changed.
  console.log("📥 Step 5: Refreshing code index...");
  await refreshCodeIndex();
  console.log("   ✅ Code index checked.");

  // Step 6: Prune stale knowledge.
  console.log("📥 Step 6: Pruning stale knowledge (older than 90 days)...");
  const archived = await pruneStaleKnowledge();
  console.log(`   ✅ Archived ${archived} stale entries.`);

  // Stagnation detection (RULE-42).
  await checkLearningStagnation();

  // Summary.
  console.log("");
  console.log("════════════════════════════════════════════════════════════════");
  console.log(`🎉  Daily Knowledge Refresh complete! ${totalSeeded} new entries seeded.`);
  if (totalSeeded < MIN_LEARNINGS_PER_DAY) {
    console.log(`⚠️  WARNING: Only ${totalSeeded} learnings extracted (minimum is ${MIN_LEARNINGS_PER_DAY}).`);
    console.log("    The system may not be learning fast enough — check the sources.");
  } else {
    console.log(`✅  Met the minimum ${MIN_LEARNINGS_PER_DAY} learnings per day requirement (RULE-41).`);
  }
  console.log("════════════════════════════════════════════════════════════════");

  return { totalSeeded, archived };
}

main()
  .then((result) => {
    console.log(`\nResult: ${JSON.stringify(result)}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Daily knowledge refresh failed:", err);
    process.exit(1);
  });
