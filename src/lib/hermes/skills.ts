/**
 * src/lib/hermes/skills.ts — Dynamic Skill Acquisition & Learning Engine
 *
 * Native TypeScript port of Hermes' dynamic skill discovery + learning loop.
 *
 * Progressive Disclosure:
 *   1. discoverSkills() returns light summaries (id, name, description) for
 *      the system prompt — does NOT load full instructions.
 *   2. loadSkillInstructions() loads the full instructions + script only
 *      when the agent invokes the skill.
 *   3. createSkillFromExecution() synthesizes a new reusable Skill after
 *      a successful multi-step task completion (the learning loop).
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
// v61 (Audit B3): wire the autonomy router into the skill execution path.
// loadSkillInstructions() is the progressive-disclosure invoke point — it
// is only called when an agent actually wants to RUN a skill (not when
// listing them for the system prompt). Routing here gates every real
// skill invocation by its autonomy tag.
import { routeSkillByAutonomy } from "@/lib/conductor/router";

export interface SkillSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  invocations: number;
  successRate: number;
}

export interface SkillFull extends SkillSummary {
  instructions: string | null;
  script: string | null;
  source: string;
  status: string;
}

export interface ExecutionStep {
  step: number;
  action: string;
  result: string;
  success: boolean;
}

/**
 * Light skill discovery — returns summaries only (progressive disclosure).
 * Used to build the system prompt: the agent sees skill names + descriptions
 * but NOT the full instructions (those are loaded on invoke).
 */
export async function discoverSkills(agentRole?: string): Promise<SkillSummary[]> {
  try {
    const skills = await db.skill.findMany({
      where: { status: "active" },
      orderBy: [{ invocations: "desc" }, { successRate: "desc" }],
      take: 50,
    });
    return skills.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      description: s.description,
      category: s.category,
      invocations: s.invocations,
      successRate: s.successRate,
    }));
  } catch (err) {
    logger.warn("hermes-skills.discover.error", { error: String(err) });
    return [];
  }
}

/**
 * Load full skill instructions — only called when the agent invokes a skill.
 * This is the "progressive disclosure" pattern: the full instructions are
 * loaded into memory only when needed, keeping the system prompt small.
 */
export async function loadSkillInstructions(skillId: string): Promise<SkillFull | null> {
  try {
    const skill = await db.skill.findUnique({ where: { id: skillId } });
    if (!skill || skill.status !== "active") return null;

    // ─── v61 (Audit B3): Autonomy Router Gate ───────────────────────
    // Before returning the full instructions (which the agent will then
    // execute), ask the conductor router whether this skill may run under
    // its autonomy tag. HUMAN_LED → refuse (return null). HUMAN_ASSISTED
    // → queue an Approval + send a Telegram brief, then return null so
    // the agent sees the skill as unavailable this turn (the owner must
    // approve + the agent re-invokes). FULLY_AUTONOMOUS → proceed.
    try {
      const decision = await routeSkillByAutonomy(skill.id, "hermes-toolset");
      if (!decision.allowed) {
        logger.info("hermes-skills.autonomy-blocked", {
          skillId: skill.id,
          slug: skill.slug,
          autonomyTag: decision.autonomyTag,
          approvalId: decision.approvalId,
          reason: decision.reason,
        });
        // Return null so the tool handler reports the skill as unavailable.
        // The queued Approval (if any) is visible in the dashboard + via
        // the Telegram brief the router already sent.
        return null;
      }
    } catch (routeErr) {
      // Fail-closed: if the router itself errors, refuse to load the skill.
      logger.warn("hermes-skills.autonomy-router-error", {
        skillId,
        error: String(routeErr),
      });
      return null;
    }

    return {
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      instructions: skill.instructions,
      script: skill.script,
      source: skill.source,
      status: skill.status,
      invocations: skill.invocations,
      successRate: skill.successRate,
    };
  } catch (err) {
    logger.warn("hermes-skills.load.error", { skillId, error: String(err) });
    return null;
  }
}

/**
 * Find a skill by slug (convenience for tool calling).
 *
 * v61 Phase 3 (Skills as Patterns): checks the lightweight SKILL_PATTERNS
 * first (in-code, no DB lookup needed). If a pattern exists for this slug,
 * returns it immediately as a SkillFull — this means fresh installs work
 * without loading the 60MB skills/ directory. Falls back to the DB-loaded
 * Skill row only for custom/learned skills not in the pattern registry.
 */
export async function findSkillBySlug(slug: string): Promise<SkillFull | null> {
  // Phase 3: check the lightweight pattern registry first.
  try {
    const { getSkillPattern } = await import("@/lib/skill-patterns");
    const pattern = getSkillPattern(slug);
    if (pattern) {
      // Run the autonomy router gate (same as DB-loaded skills).
      try {
        const { routeSkillByAutonomy } = await import("@/lib/conductor/router");
        // Look up the DB skill by slug to get the id for the router.
        const dbSkill = await db.skill.findUnique({ where: { slug } });
        if (dbSkill) {
          const decision = await routeSkillByAutonomy(dbSkill.id, "hermes-toolset");
          if (!decision.allowed) {
            logger.info("hermes-skills.pattern.autonomy-blocked", {
              slug,
              autonomyTag: decision.autonomyTag,
              approvalId: decision.approvalId,
            });
            return null;
          }
        }
      } catch { /* fail-open if router unavailable */ }

      // Return the pattern as a SkillFull — instructions = systemPrompt.
      return {
        id: `pattern:${slug}`,
        slug: pattern.slug,
        name: pattern.name,
        description: pattern.description,
        category: pattern.category,
        instructions: pattern.systemPrompt,
        script: null, // patterns have no script — they ARE the logic
        source: "pattern",
        status: "active",
        invocations: 0,
        successRate: 1.0,
      };
    }
  } catch (patternErr) {
    logger.warn("hermes-skills.pattern-lookup-failed", { slug, error: String(patternErr) });
  }

  // Fallback: DB-loaded skill (for custom/learned skills not in patterns).
  try {
    const skill = await db.skill.findUnique({ where: { slug } });
    if (!skill) return null;
    return await loadSkillInstructions(skill.id);
  } catch {
    return null;
  }
}

/**
 * Increment skill usage + update success rate.
 * Called after every skill invocation.
 */
export async function incrementSkillUsage(
  skillId: string,
  success: boolean,
): Promise<void> {
  try {
    const skill = await db.skill.findUnique({ where: { id: skillId } });
    if (!skill) return;

    const newInvocations = skill.invocations + 1;
    // Exponential moving average for success rate (α = 0.1)
    const newSuccessRate =
      skill.successRate * 0.9 + (success ? 1.0 : 0.0) * 0.1;

    await db.skill.update({
      where: { id: skillId },
      data: {
        invocations: newInvocations,
        successRate: newSuccessRate,
      },
    });
  } catch (err) {
    logger.warn("hermes-skills.increment.error", { skillId, error: String(err) });
  }
}

/**
 * Create a new reusable Skill from a successful multi-step execution.
 *
 * This is the "learning loop" — when an agent successfully completes a
 * complex task, we synthesize the execution steps into a new Skill record
 * so future agents can reuse the same approach.
 *
 * Uses the LLM to generate a name, description, instructions, and script
 * template from the execution trace.
 */
export async function createSkillFromExecution(
  steps: ExecutionStep[],
  agentRole: string,
  taskDescription: string,
): Promise<SkillFull | null> {
  try {
    // Import callLLM dynamically to avoid circular deps
    const { callLLM } = await import("@/lib/llm-client");

    const stepsText = steps
      .map(
        (s, i) =>
          `Step ${i + 1}: ${s.action}\nResult: ${s.result}\nSuccess: ${s.success}`,
      )
      .join("\n\n");

    const prompt = `You are a skill synthesis engine. Given the following successful task execution, create a reusable skill.

Task: ${taskDescription}
Agent Role: ${agentRole}

Execution Steps:
${stepsText}

Respond in EXACTLY this JSON format (no markdown, no code fences):
{
  "name": "Short skill name (2-4 words, Title Case)",
  "description": "One-sentence description of what this skill does",
  "category": "One of: llm, media, doc, data, web, code, comms, finance",
  "instructions": "Step-by-step instructions an agent should follow to use this skill. Be specific about what inputs are needed and what outputs to expect.",
  "script": "A template script (pseudocode or TypeScript) showing the execution pattern. Use {{input}} for variables."
}`;

    const result = await callLLM("Skill-Synthesizer", "Conductor", prompt, {
      maxRetries: 1,
    });

    // Parse the JSON response
    let parsed: {
      name: string;
      description: string;
      category: string;
      instructions: string;
      script: string;
    };
    try {
      // Strip any markdown fences if present
      const clean = result.content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      parsed = JSON.parse(clean);
    } catch {
      // If JSON parse fails, create a minimal skill from the raw content
      parsed = {
        name: `Skill-${Date.now().toString(36)}`,
        description: taskDescription.slice(0, 100),
        category: "llm",
        instructions: result.content.slice(0, 500),
        script: stepsText.slice(0, 500),
      };
    }

    const slug = parsed.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 50);

    // Check if skill with this slug already exists — if so, update it
    const existing = await db.skill.findUnique({ where: { slug } });
    if (existing) {
      const updated = await db.skill.update({
        where: { slug },
        data: {
          description: parsed.description,
          instructions: parsed.instructions,
          script: parsed.script,
          source: "learned",
          status: "active",
        },
      });
      logger.info("hermes-skills.updated", { slug, name: updated.name });
      return loadSkillInstructions(updated.id);
    }

    const skill = await db.skill.create({
      data: {
        slug,
        name: parsed.name,
        category: parsed.category,
        description: parsed.description,
        instructions: parsed.instructions,
        script: parsed.script,
        source: "learned",
        status: "active",
        invocations: 0,
        successRate: 1.0,
      },
    });

    logger.info("hermes-skills.created", {
      slug: skill.slug,
      name: skill.name,
      category: skill.category,
    });
    return await loadSkillInstructions(skill.id);
  } catch (err) {
    logger.error("hermes-skills.create.error", { error: String(err) });
    return null;
  }
}

/**
 * Build the system prompt section for skill discovery.
 * Returns a light summary (progressive disclosure) — names + descriptions only.
 */
export async function SKILL_SYSTEM_PROMPT_SECTION(agentRole?: string): Promise<string> {
  const skills = await discoverSkills(agentRole);
  if (skills.length === 0) {
    return "No skills currently registered.";
  }
  const lines = skills.map(
    (s) =>
      `- ${s.slug}: ${s.name} — ${s.description ?? "(no description)"} (${s.invocations} uses, ${Math.round(s.successRate * 100)}% success)`,
  );
  return [
    "Available Skills (invoke by slug to load full instructions):",
    ...lines,
  ].join("\n");
}
