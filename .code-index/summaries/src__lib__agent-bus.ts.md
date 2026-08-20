# src/lib/agent-bus.ts

**Category:** general

**Purpose:** src/lib/agent-bus.ts — inter-agent messaging via db.agentMessage + SSE.

**Line count:** 176

**Core logic patterns:** database-access, error-handling, event-emission

**Key functions:** sendDirect, broadcast, listInbox, postBlackboard

**Dependencies:** @prisma/client, ./db, ./logger, ./event-bus, ./types

**Last modified:** 2026-08-17T03:11:39.000Z

**Indexed at:** 2026-08-19T09:41:49.284Z
