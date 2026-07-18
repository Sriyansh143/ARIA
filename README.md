# JARVIS Mission Control

Autonomous AI agent orchestration dashboard — an AI company that can SEE, DO, and EARN.

## Quick Start (Single Click)

```bash
chmod +x setup.sh && ./setup.sh
```

This will:
1. Install dependencies (bun install)
2. Setup database (prisma db push + seed all data)
3. Auto-store API keys from .env (no manual key entry needed)
4. Optionally download + start Ollama (asks permission for ~150MB download)
5. Optionally download + start FreeSWITCH (asks permission for ~500MB download)
6. Start the realtime WebSocket service (port 3003)
7. Start the main app (port 3000)

## Manual Start

```bash
bun install
bunx prisma db push --accept-data-loss
bunx prisma generate
bunx tsx scripts/seed.ts
bunx tsx scripts/seed-agents.ts
bunx tsx scripts/seed-cron.ts
bunx tsx scripts/seed-providers-models.ts
bunx tsx scripts/seed-rules.ts
bunx tsx scripts/seed-earning-methods.ts
bunx tsx scripts/seed-add.ts
bun run dev
```

## Environment Variables

All API keys are read from `.env` automatically. No manual key entry needed in the UI.

Key variables (see `.env` for full list):
- `ZAI_API_KEY` — Z.ai (GLM-4.6)
- `GROQ_API_KEY` — Groq (Llama 3.3)
- `NVIDIA_API_KEY` — NVIDIA NIM
- `QWEN_API_KEY` — Qwen Playground
- `HUGGINGFACE_API_KEY` — Hugging Face
- `SILICONFLOW_API_KEY` — SiliconFlow
- `HIGGSFIELD_API_KEY` — Higgsfield
- `GITHUB_TOKEN` — GitHub Models
- `TELEGRAM_BOT_TOKEN` — Telegram bot
- `FREESWITCH_ESL_HOST/PORT/PASSWORD` — FreeSWITCH voice
- `DATABASE_URL` — SQLite path

## Architecture

- **Framework**: Next.js 16 + TypeScript + Tailwind CSS 4
- **Database**: Prisma ORM + SQLite
- **AI**: z-ai-web-dev-sdk (GLM-4.6) + 23 providers + 455 models
- **Realtime**: Socket.io mini-service (port 3003)
- **Voice**: FreeSWITCH ESL (port 8021)
- **Local AI**: Ollama (port 11434)

## Stats

- 27 tabs | 137 API routes | 42 Prisma models | 33 cron jobs
- 69 agents (5 monitoring, 62 executing, 2 error-handlers)
- 455 models across 23 providers
- 27+ Orion intents | 31 rules | 17 agent personas

## Documentation

- `APP_DOCUMENTATION.md` — Complete app documentation (3,557 lines)
- `PENDING_TASKS.md` — Living log of pending works
- `RULES.md` — 31 permanent rules
- `worklog.md` — Full development history

## Rules (Key)

- **Rule 15**: Never build from scratch — always port from jarvis zip + open source
- **Rule 22**: Smart model selection — use best model per task, not always glm-4.6
- **Rule 23**: No idle agents — zero idle policy
- **Rule 29**: Never touch personal accounts (MANDATORY, HIGHEST PRIORITY)
- **Rule 31**: Never remove models due to key issues

## License

Private — Liafon Software Private Limited
