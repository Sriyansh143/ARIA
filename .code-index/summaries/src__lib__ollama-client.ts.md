# src/lib/ollama-client.ts

**Category:** llm

**Purpose:** src/lib/ollama-client.ts — Ollama LLM Client (fallback provider)

**Line count:** 524

**Core logic patterns:** vector-similarity, network-fetch, timeout-handling, error-handling, ollama-llm, env-config

**Key functions:** isOllamaAvailable, isOllamaRunning, listOllamaModels, autoDetectOllamaModels, ensureOllamaModel, callOllama, embedText, shouldSkipOllama, getLastOllamaLatency, cosineSimilarity

**Dependencies:** ./logger, child_process, util

**Last modified:** 2026-08-17T20:01:10.000Z

**Indexed at:** 2026-08-19T09:41:49.288Z
