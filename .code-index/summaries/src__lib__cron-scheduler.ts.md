# src/lib/cron-scheduler.ts

**Category:** cron

**Purpose:** ARIA Mission Control — Real Cron Scheduler.

**Line count:** 239

**Core logic patterns:** simulation (verify gating), database-access, error-handling, event-emission

**Key functions:** runJobByName, startScheduler, stopScheduler

**Dependencies:** ./db, ./event-bus, ./types, ./logger, ./cron-handlers, ./autonomy-control

**Last modified:** 2026-08-17T21:06:52.000Z

**Indexed at:** 2026-08-19T09:41:49.295Z
