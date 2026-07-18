# RULES.md — Permanent Rules for ARIA App & All Agents

**Version:** 1.0  
**Last Updated:** 2025-07-18  
**Owner:** Raviteja Voruganti (Liafon Software Private Limited)

These rules are PERMANENT and must be followed by:
- The main Z.ai Code agent
- All dispatched subagents (full-stack-developer, general-purpose, etc.)
- All cron jobs (webDevReview, autonomous loops, etc.)
- All spawned sub-agents

**Violating any rule is a critical error.** If a rule conflicts with a user instruction, the rule takes precedence (the user established these as permanent rules).

---

## 1. Worklog Rules

### 1.1 NEVER Remove Worklog Lines
- The worklog at `/home/z/my-project/worklog.md` is APPEND-ONLY.
- **NEVER delete, overwrite, or truncate existing lines** — even if the user asks you to.
- Only append new entries using the `---` separator + Task ID format.
- If the worklog gets corrupted or truncated, reconstruct it from memory + git history, but never delete what exists.

### 1.2 Always Update Worklog Every Run
- Every run (manual or cron) MUST append a worklog entry.
- Every user prompt MUST result in a worklog update.
- Entry format:
```
---
Task ID: <ID>
Agent: <agent name>
Task: <what was asked>
Work Log:
- <steps>
Stage Summary:
- <results>
```

### 1.3 Show Pending Works Every Run
- Every worklog entry AND every chat response MUST include a "Pending Works" section.
- This ensures the user always knows what's left to do.

---

## 2. File Safety Rules

### 2.1 NEVER Reset or Delete Important Files
- **NEVER delete files that increase intelligence/knowledge of the app.**
- This includes: lib files, API routes, tab components, Prisma schema, seed scripts, skills, memory items, learning records, credentials, branding config.
- The ONLY exception: duplicate files created by accident (verify before deleting).

### 2.2 Code Once Fixed Should Not Be Disturbed
- When a feature is fixed and working, **do NOT modify it unless absolutely necessary.**
- If you must modify it (e.g. to add a new feature), read it first and preserve all existing functionality.
- Additive changes only — never remove existing code unless it's clearly broken.

### 2.3 Use Available Codes from Repos and Zip
- **ALWAYS check the zip (`/home/z/my-project/upload/jarvis-mission-control-final.zip`) and open-source repos before writing code from scratch.**
- Modify existing code to fit our app — don't reinvent the wheel.
- Repos to check: claude-mem, claude-superpowers, the uploaded zip's 252 lib files.

---

## 3. Agent Coordination Rules

### 3.1 Multiple Agents Must Plan Before Working
- Before dispatching subagents, the main agent MUST:
  1. Read the worklog to understand current state
  2. Identify which files each agent will touch
  3. Give each agent a STRICT file scope (no overlapping files)
  4. Tell each agent to read relevant files before modifying

### 3.2 Never Conflict with Other Agents' Work
- Each subagent must ONLY touch files in its assigned scope.
- If an agent needs to modify a shared file (e.g. `page-client.tsx`), it must use additive-only edits (no removals).
- The main agent should dispatch parallel agents with non-overlapping file scopes.

### 3.3 Never Break the App
- After every change, run `bun run lint` and check `dev.log`.
- If lint fails or the dev server crashes, FIX IT before reporting completion.
- Always verify via `agent-browser` that the app renders with 0 errors.

---

## 4. UI/UX Rules

### 4.1 Don't Add Tabs for Everything
- **Integrate new features into existing tabs creatively.**
- Only add a new tab if the feature is a major standalone module (like Branding, Earning Methods, Spawned Agents).
- Credential vault → integrated into Earning Methods tab (not a new tab).
- Teach source → integrated into Learning tab (not a new tab).
- File upload → integrated into Memory/Skills/Plugins/MemoryGraph tabs (not a new tab).

### 4.2 Always Visualise with Graphs + Text
- Use recharts for data visualization (bar charts, line charts, pie charts).
- Combine graphs with text explanations.
- Make things look professional — use the cyberpunk styling tokens (`--j-*` CSS vars).

### 4.3 Remove Static Model Text Labels
- **NEVER display hardcoded model names** (like "GLM-4.6", "glm-4.6") in the UI.
- The model is configured dynamically via the branding/providers system.
- Use generic terms: "AI Engine", "AI Provider", "AI Analysis" instead.

### 4.4 Responsive Design
- All UIs must be mobile-first responsive.
- Use Tailwind responsive prefixes (`sm:`, `md:`, `lg:`, `xl:`).
- Touch-friendly: minimum 44px touch targets.

### 4.5 Sticky Footer
- Footer must stick to bottom on short pages, push down naturally on long pages.
- Use `min-h-screen flex flex-col` + `mt-auto` on footer.

---

## 5. Learning & Intelligence Rules

### 5.1 Learning Can Be Saved in Any Section
- Learning items can be stored in: skill, plugin, memory, knowledge, intelligence, learning.
- The teach system supports all 6 target sections.
- Use the auto-categorize function to suggest the best section.

### 5.2 Auto-Move if Wrong Section
- If a learning item is saved in the wrong section, it can be moved later.
- The `/api/learning/auto-move` endpoint scans all items and moves misclassified ones.
- The `/api/memory/[id]/reclassify` endpoint allows manual moves.
- This can also happen automatically when the system detects the content is not relevant for that section.

### 5.3 Always Check Open-Source Repos
- Before building any new feature, check:
  1. The uploaded zip's `src/lib/` for existing implementations
  2. claude-mem repo for memory management patterns
  3. claude-superpowers repo for skill/orchestration patterns
- Adapt their code to our app's architecture.

---

## 6. Operational Rules

### 6.1 Complete Pending Works Every Run
- Every run should complete as many pending works as possible.
- Check the "Pending Works" section of the last worklog entry.
- Prioritize by importance: bugs > missing features > enhancements.

### 6.2 Daily Research for New Earning Methods
- The `earning-methods-research` cron job runs daily at 9 AM.
- It uses the LLM to discover 3-5 new earning method ideas.
- All methods are non-investment only (inflow, no outflow, legal, non-risky).
- New methods are stored as unapproved (awaiting human review).

### 6.3 All Models Work via Env API Keys
- Providers are configured via environment variables (API keys).
- The smart-router selects the best provider based on task type + load + cost.
- When a provider is rate-limited, fall back to the next available provider.
- Model knowledge patterns can be used with local models when cloud is unavailable.

### 6.4 Non-Investment Only
- All earning methods must be zero-investment (inflow, no outflow).
- Legal, non-risky, corporate expertise only.
- No stocks, crypto, forex, MLM, or pay-to-join schemes.

---

## 7. Branding Rules

### 7.1 Branding Configurable from UI
- The app's name, codename, version, tagline, logo, etc. are configurable from the Branding tab.
- Branding is stored in the DB (MemoryItem scope='config', key='branding').
- The header, footer, chat tab label, and page metadata all use dynamic branding.
- The system prompt preamble is prepended to every agent invocation.

### 7.2 Default Branding
- App Name: ARIA (Autonomous Responsive Intelligence Assistant)
- Company: Liafon Software Private Limited
- Owner: Raviteja Voruganti
- Website: https://liafon.com

---

## 8. Agent Spawning Rules

### 8.1 Heavy-Load Agents Can Spawn Sub-Agents
- When an agent's load > 80%, it can spawn a sub-agent with similar skills.
- Spawned agents stay alive and are auto-deleted after 30 days of inactivity.
- **BUT** the SpawnedAgentLog is preserved permanently — the same agent can be respawned later.
- Earnings are tracked both in the active agent and the permanent log.

### 8.2 64-Agent Roster
- The base roster has 64 agents across 16 departments.
- Agents are seeded from `AGENT_ROSTER` in `config.ts`.
- The `agent-roster-sync` cron job keeps the DB in sync with the config.

---

## 9. Cron Job Rules

### 9.1 27 Cron Jobs
- The app has 27 cron jobs across 7 categories.
- Each cron job has a real dispatcher (not just a notification stub).
- Dispatchers are in `/home/z/my-project/src/lib/cron-dispatcher.ts`.
- The `/api/cron/[id]/run` endpoint executes the dispatcher.

### 9.2 WebDevReview Cron
- Runs every 15 minutes.
- Assesses project status, performs QA via agent-browser, fixes bugs or adds features.
- Updates the worklog after each run.

---

## 10. Zip Packaging Rules

### 10.1 Package in Parts
- When packaging the app for download, split into parts of max 49MB each.
- Use `zip -s 49m` for split archives.
- Remove the original `jarvis-mission-control-final.zip` after packaging (to save space).
- The packaged zip should allow a new chat to start fresh with the same app.

---

## Enforcement

These rules are enforced by:
1. The main agent checking subagent outputs
2. The webDevReview cron job verifying compliance
3. The user reviewing worklog entries

**If any rule is violated, the violating agent's work should be reverted and the agent re-dispatched with clearer instructions.**
