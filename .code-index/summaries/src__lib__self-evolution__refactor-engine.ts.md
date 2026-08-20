# src/lib/self-evolution/refactor-engine.ts

**Category:** general

**Purpose:** src/lib/self-evolution/refactor-engine.ts — v73 Phase 23 (RULE-72)

**Line count:** 967

**Core logic patterns:** database-access, timeout-handling, error-handling, event-emission, telegram-integration, ollama-llm, env-config

**Key functions:** detectFailingModules, draftAndProposeRefactor, executeMerge, runWeeklyAudit, runPreFlightAudit, handleReviewCommand, handleSuggestCommand, rollbackIfCrashed, generateCoverageMatrix

**Dependencies:** ../db, ../logger, ../event-bus, ../llm-client, ../context-manager, ../constitution, fs, path, child_process, ../telegram-notifier

**Last modified:** 2026-08-19T06:54:17.000Z

**Indexed at:** 2026-08-19T09:41:49.308Z
