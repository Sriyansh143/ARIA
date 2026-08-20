# src/lib/conductor/dispatcher.ts

**Category:** conductor

**Purpose:** src/lib/conductor/dispatcher.ts — Subagent Delegation Protocol

**Line count:** 389

**Core logic patterns:** database-access, timeout-handling, error-handling, event-emission

**Key functions:** dispatchToAgent, getSubAgentTasks, promoteNextNonBlockedTask

**Dependencies:** @/lib/db, @/lib/logger, @/lib/event-bus, @/lib/llm-client, @/lib/hermes/skills, @/lib/hermes/toolsets, @/lib/hermes/memory, @/lib/types, ../agent-blackboard

**Last modified:** 2026-08-17T18:18:20.000Z

**Indexed at:** 2026-08-19T09:41:49.309Z
