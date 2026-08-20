/**
 * scripts/seed-from-embedded.ts — v76 Phase 26 (Digest and Discard)
 *
 * Seeds the Skill + KnowledgeBaseEntry tables from the EMBEDDED_SKILLS
 * and EMBEDDED_PROJECTS TypeScript files. Does NOT require the skills/
 * folder or the 500-projects repo to exist on disk.
 *
 * This is the production-safe seeding path — the app ships with the
 * intelligence embedded in src/lib/embedded-skills.ts (910 KB) and
 * src/lib/embedded-projects.ts (18 KB). No raw folders needed.
 *
 * Run: bun run scripts/seed-from-embedded.ts
 */

import { db } from "../src/lib/db";
import { EMBEDDED_SKILLS } from "../src/lib/embedded-skills";
import { EMBEDDED_PROJECTS } from "../src/lib/embedded-projects";

async function main() {
  console.log("🚀 v76 Phase 26 — Seeding from EMBEDDED_SKILLS + EMBEDDED_PROJECTS...");
  console.log(`   Embedded skills: ${EMBEDDED_SKILLS.length}`);
  console.log(`   Embedded projects: ${EMBEDDED_PROJECTS.length}`);
  console.log("");

  // ─── Seed Skills ───
  console.log("📥 Step 1: Seeding Skill table from EMBEDDED_SKILLS...");
  let skillsSeeded = 0;
  for (const skill of EMBEDDED_SKILLS) {
    await db.skill.upsert({
      where: { slug: skill.slug },
      update: {
        name: skill.name,
        category: skill.category,
        description: skill.description,
        instructions: skill.systemPrompt,
        script: skill.script,
        source: "embedded-skills",
      },
      create: {
        slug: skill.slug,
        name: skill.name,
        category: skill.category,
        description: skill.description,
        instructions: skill.systemPrompt,
        script: skill.script,
        source: "embedded-skills",
        autonomyTag: "HUMAN_ASSISTED",
      },
    });
    skillsSeeded++;
  }
  console.log(`   ✅ Seeded ${skillsSeeded} Skill records.`);

  // ─── Seed KnowledgeBaseEntry from EMBEDDED_PROJECTS ───
  console.log("");
  console.log("📥 Step 2: Seeding KnowledgeBaseEntry from EMBEDDED_PROJECTS...");
  let projectsSeeded = 0;
  for (const project of EMBEDDED_PROJECTS) {
    // Check if this KB entry already exists by title.
    const existing = await db.knowledgeBaseEntry.findFirst({
      where: { title: project.title },
      select: { id: true },
    });
    if (existing) {
      await db.knowledgeBaseEntry.update({
        where: { id: existing.id },
        data: {
        category: project.category,
        content: project.coreLogic,
        coreLogic: project.coreLogic,
        systemPromptTemplate: project.systemPromptTemplate,
        toolsRequired: JSON.stringify(project.toolsRequired),
        tags: JSON.stringify(project.tags),
        repoUrl: project.repoUrl,
        source: project.source,
      },
    });
    } else {
      await db.knowledgeBaseEntry.create({
        data: {
          title: project.title,
          category: project.category,
          content: project.coreLogic,
          coreLogic: project.coreLogic,
          systemPromptTemplate: project.systemPromptTemplate,
          toolsRequired: JSON.stringify(project.toolsRequired),
          tags: JSON.stringify(project.tags),
          repoUrl: project.repoUrl,
          source: project.source,
          filePath: null,
        },
      });
    }
    projectsSeeded++;
  }
  console.log(`   ✅ Seeded ${projectsSeeded} KnowledgeBaseEntry records.`);

  // ─── Verification ───
  console.log("");
  console.log("📊 Step 3: Verification...");
  const skillCount = await db.skill.count();
  const kbCount = await db.knowledgeBaseEntry.count();
  const withInstructions = await db.skill.count({
    where: { instructions: { not: null } },
  });

  console.log(`   Skill table: ${skillCount} records (${withInstructions} with instructions)`);
  console.log(`   KnowledgeBaseEntry: ${kbCount} records`);
  console.log("");

  // Show sample skill instruction lengths.
  const samples = await db.skill.findMany({
    take: 5,
    select: { slug: true, name: true, instructions: true },
  });
  console.log("   Sample skills (instruction lengths):");
  for (const s of samples) {
    console.log(`     - ${s.slug}: ${s.name} (${s.instructions?.length ?? 0} chars)`);
  }

  console.log("");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`🎉  Seeding complete! ${skillsSeeded} skills + ${projectsSeeded} projects seeded.`);
  console.log(`    No skills/ folder or 500-projects repo was needed.`);
  console.log("══════════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
