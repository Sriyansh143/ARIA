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

## Rule 15: NEVER Build From Scratch (CRITICAL)
- ALWAYS use code from the jarvis-mission-control-final.zip and open-source repos.
- Search the jarvis zip (/tmp/jarvis-check/) for existing implementations before writing new code.
- Adapt and modify existing code to fit the app — do NOT write from scratch.
- This applies to ALL agents, ALL cron jobs, ALL features.
- If a feature exists in the jarvis zip, port it (adapt imports, remove unavailable deps).

## Rule 16: CEO Agent Autonomous Operation
- The CEO agent monitors all tabs every 30 minutes.
- If a tab is empty, the CEO generates tasks to populate it based on the company's services.
- If a tab has data, the CEO looks for opportunities and issues.
- The CEO researches earning methods → creates step-by-step pipeline → generates lead-gen tasks.
- NO human needs to add tasks — the CEO does it autonomously.

## Rule 17: Telegram Approvals (Only Human-in-Loop)
- ALL actions that require permission (git push, npm publish, spending money, accessing personal accounts) must be sent to the owner via Telegram for approval.
- The owner approves or rejects via Telegram buttons.
- NO other human intervention is required — everything else is autonomous.
- The approval system is the ONLY checkpoint where the owner has control.

## Rule 18: Full System Access (With Permission)
- The app can log all files in the system and all folders on the laptop (with owner permission).
- This lets agents see what is useful and what is not.
- Requires explicit owner approval via Telegram before scanning.
- File access is sandboxed to the workspace by default; system-wide access requires approval.

## Rule 19: Update Documentation Every Run (CRITICAL)
- **PENDING_TASKS.md** MUST be updated every run — mark completed items ✅, add new pending items.
- **APP_DOCUMENTATION.md** MUST be updated when new features are added — append a new section.
- **worklog.md** MUST be appended every run (already Rule 1, reinforced here).
- **RULES.md** MUST be updated when new permanent rules are added.
- At the start of each session, agents MUST read PENDING_TASKS.md to know what to work on.
- At the end of each session, agents MUST update PENDING_TASKS.md with what was completed + what's still pending.

## Rule 20: Multi-Agent Discussion Before Implementation
- For complex tasks, multiple agents should be deployed to monitor tabs.
- Agents discuss findings, propose actions, reach consensus, THEN implement.
- This is more robust than single-agent decision-making.
- The CEO agent coordinates the discussion, C-Suite agents (CTO/CMO/COO/CFO) provide domain expertise.
- Discussion results are logged to memory for future reference.

## Rule 21: Agent Separation (Monitoring vs Executing)
- **Monitoring agents** (CEO, C-Suite, watchdogs) observe tabs, generate tasks, find issues, propose improvements. They do NOT execute tasks themselves.
- **Executing agents** (developers, researchers, writers, testers) complete tasks created by monitoring agents. They do NOT create tasks or monitor tabs.
- **Error handling agents** (incident responders, quality reviewers) catch failures, retry, rollback, report.
- Monitoring agents decide which executing agent gets which work based on skills, load, and department.
- Monitoring agents track the progress of executing agents until completion.

## Rule 22: Smart Model Selection (Not Always glm-4.6)
- Every agent should use the BEST model for its task, not always glm-4.6.
- The app has 453 models across 23 providers. Use them.
- Model selection criteria:
  - **Coding tasks**: use coding-specialist models (qwen3-coder, deepseek-coder, etc.)
  - **Reasoning tasks**: use reasoning models (glm-4.6, deepseek-v3.1, etc.)
  - **Vision tasks**: use vision models (qwen3-vl, glm-4v, etc.)
  - **Fast tasks**: use fast models (groq:llama-3.3-70b, glm-4-air, etc.)
  - **Creative tasks**: use creative models (glm-4.6, claude-3.5-sonnet, etc.)
- The `selectModel(taskKind)` function should query the Model table for available models matching the task kind and pick the best non-rate-limited one.

## Rule 23: No Idle Agents (Zero Idle Policy)
- If any agent is idle for more than 5 minutes, their supervisor/lead MUST assign them a new task.
- Supervisors check for idle agents every 5 minutes (via the health-check cron).
- Idle agents should be assigned:
  1. Pending tasks from the queue matching their skills.
  2. If no pending tasks: research/improvement tasks (read docs, learn skills, monitor tabs).
  3. If nothing to do: stand-by mode (but logged as "standby" not "idle").
- An agent should NEVER be idle — there is always something to learn, improve, or monitor.

## Rule 24: Task Queue System
- When all executing agents are busy, new tasks go into a queue.
- The queue auto-dispatches tasks when an agent becomes free.
- Queue priority: critical > high > medium > low.
- Within the same priority: oldest first (FIFO).
- The queue is checked every 30 seconds by the task dispatcher.
- If a task has been in the queue for >1 hour, escalate priority by one level.

## Rule 25: Setup File Must Match App
- The setup/README file must be updated whenever the app's dependencies, environment variables, or startup process changes.
- If a new mini-service is added, the setup file must document how to start it.
- If a new Prisma model is added, the setup file must mention running `bunx prisma db push`.
- If a new environment variable is required, the setup file must list it.
- This rule applies to ALL future changes — not just this session.

## Rule 26: Earning Method Approval Flow (Owner Checkpoint)
- When agents create an earning method, they MUST:
  1. **Research** the method (market demand, competition, pricing).
  2. **Simulate** the process (cost analysis, timeline, sample deliverable, risk assessment).
  3. **Prepare workflow** (step-by-step process from client inquiry to payment).
  4. **Request approval** from the owner with a summary.
  5. **Answer questions** — the owner can ask any questions before approving. The CEO answers honestly.
  6. **Deploy** only after explicit owner approval.
- The owner can **reject** a method — the CEO will research alternatives.
- No earning method goes live without owner approval. This is a hard checkpoint.

## Rule 27: Agent Network Transparency
- The Agent Network tab visualizes all 17+ agent personas with animated flows.
- Monitoring agents (CEO, C-Suite) are visually distinct from executing agents.
- Task flows are animated — when a task is being worked on, packets flow along the hierarchy.
- Agent status is live-updated (working/idle/thinking/error).
- The owner can click any agent to see its full persona, skills, goals, and current tasks.

## Rule 28: Continuous Improvement (Self-Evolving Rules)
- The app MUST improvise rules based on experience.
- If a rule causes problems, it should be revised (not removed).
- If a pattern is observed that needs a rule, a new rule should be proposed.
- Rules should be specific enough to be actionable, general enough to cover edge cases.
- The CEO agent proposes new rules during its sweep — they go to the owner for approval.
- This rule itself is the meta-rule that ensures the rule set evolves.

## Rule 29: No Touching Personal Accounts (MANDATORY — HIGHEST PRIORITY)
- AI agents MUST NEVER access, touch, or interact with:
  - Logged-in social media accounts (Facebook, Twitter/X, Instagram, LinkedIn, etc.)
  - Personal email accounts (Gmail, Outlook, etc.)
  - Personal banking/financial accounts
  - Any personal login session in the browser
- This rule OVERRIDES all other rules. No agent, no cron job, no autonomous action can bypass this.
- If an agent needs to post to social media or send email, it MUST:
  1. Create a new dedicated account for that purpose (never use owner's personal account).
  2. Get explicit owner approval via Telegram before creating the account.
  3. Use the dedicated account only — never the owner's personal one.
- Violation of this rule is a critical security incident and should trigger immediate shutdown of the offending agent.
- This rule is PERMANENT and CANNOT be removed or modified.

## Rule 30: Tool Monitoring (Installed Software Tracking)
- Agents can monitor available tools/software installed on the laptop.
- A tool inventory is maintained and checked periodically for changes.
- When new tools are detected, agents note them and assess if they can be used for future tasks.
- When tools are removed/updated, agents update the inventory.
- Tool inventory is stored in memory (not in personal files).
- Agents CANNOT install new software without owner approval via Telegram.
- This helps agents know what capabilities are available on the host system.

## Rule 31: Never Remove Models Due to Key Issues (CRITICAL)
- Models MUST NOT be purged/removed just because an API key doesn't work or isn't set.
- The `purgeBrokenModels()` function should ONLY remove models that return HTTP 404 (model truly doesn't exist on the provider) or HTTP 500 (server error).
- Models returning HTTP 401/403 (auth failed = key issue) MUST be KEPT — the key may be wrong, expired, or not yet set.
- Models returning HTTP 429 (rate limited) MUST be KEPT — they work, just throttled.
- Models with status='unknown' MUST be KEPT — they haven't been tested yet.
- Only models with status='broken' that return 404/500 can be purged.
- This rule is PERMANENT and protects the model catalog from accidental data loss.

## Rule 32: Auto-Use Environment API Keys
- The app MUST automatically read API keys from environment variables (.env file).
- Users should NEVER need to manually set keys for each provider in the UI.
- The `readProviderApiKey()` function checks:
  1. DB (encrypted key stored via UI or seed).
  2. Environment variable (fallback — auto-stores in DB for future use).
- Provider env var mapping: zai→ZAI_API_KEY, groq→GROQ_API_KEY, openai→OPENAI_API_KEY, etc.
- If a key is in .env, it's automatically used — no UI interaction needed.
- The setup script auto-stores all env keys into the DB on first run.
