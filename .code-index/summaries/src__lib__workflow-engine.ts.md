# src/lib/workflow-engine.ts

**Category:** workflow

**Purpose:** ARIA Mission Control — n8n-style Step-by-Step Automation Workflow Engine.

**Line count:** 899

**Core logic patterns:** database-access, timeout-handling, error-handling, event-emission, telegram-integration, ollama-llm

**Key functions:** executeWorkflow, getWorkflowTemplates, getActiveRuns

**Dependencies:** ./db, ./event-bus, ./types, ./logger, ./conductor/router, ./autonomy-control, ./execution-trace, ./llm-client, ./context-manager, ./constitution, ./global-logics, ./step-debate, ./production-gate, ./telegram-notifier, ./zero-assumption-guard

**Last modified:** 2026-08-19T04:14:28.000Z

**Indexed at:** 2026-08-19T09:41:49.296Z
