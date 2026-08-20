# ARIA Mission Control — Complete Deployment Guide (v68 Final)

**Version:** v68 FINAL AUDITED · **Status:** Production-Ready · **Date:** 2026-08-17

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Local Development Setup (5 minutes)](#2-local-development-setup)
3. [Oracle Cloud Free Tier Deployment (30 minutes)](#3-oracle-cloud-free-tier-deployment)
4. [Voice Services Setup (Pipecat + FreeSWITCH + Piper)](#4-voice-services-setup)
5. [WhatsApp Setup (Baileys — Zero Cost)](#5-whatsapp-setup)
6. [Post-Deployment Verification](#6-post-deployment-verification)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Prerequisites

### For Local Development
- **Node.js 20+** (or Bun 1.3+)
- **Git**
- **Ollama** (for local LLM models — free, runs on your machine)
- **Telegram Bot Token** (free — from @BotFather) — for approval notifications

### For Oracle Cloud Deployment
- **Oracle Cloud Free Tier account** (Always Free: 24GB RAM ARM VM)
- **Domain name** (optional — for HTTPS via Caddy)
- **Telegram Bot Token** + **Telegram Chat ID** (for owner notifications)

---

## 2. Local Development Setup (5 minutes)

### Step 1: Clone + Install

```bash
# Clone the repository (or unzip the deliverable)
git clone <your-repo> aria-mission-control
cd aria-mission-control

# Install dependencies (Bun preferred — 10x faster than npm)
bun install

# Or with npm (fallback)
npm install
```

### Step 2: Environment Setup

```bash
# The auto-bootstrap system generates secrets on first start.
# Just copy the example env file:
cp .env.example .env

# Edit .env and set these CRITICAL variables:
# DATABASE_URL=file:./db/custom.db     (SQLite for dev — already set)
# ARIA_OWNER_EMAIL=your@email.com       (owner alerts)
# ZAI_API_KEY=your-zai-key              (free LLM provider — get from z.ai)
# TELEGRAM_BOT_TOKEN=your-token         (from @BotFather)
# TELEGRAM_CHAT_ID=your-chat-id         (your personal chat ID)
```

### Step 3: Database Setup

> **v69 Phase 19 BLOCKER 5 (Pragmatic DB Initialization)**: `bunx prisma db push`
> is a ONE-TIME setup step. It is run by `setup.sh` / `setup.ps1` automatically.
> It is NOT injected into per-test hooks (per the architectural principle
> "Pragmatic DB Initialization"). If you skip `setup.sh` and run `bun test`
> cold, you will see 48 of 135 tests fail with "Unable to open the database
> file." Fix: run `bunx prisma db push` once before `bun test`.

```bash
# Generate the Prisma client (required before first run)
bunx prisma generate

# Create the database schema (50 models)
bunx prisma db push --accept-data-loss

# Seed the knowledge base (69 skills + 200+ KB entries)
bun run scripts/seed-knowledge-base.ts

# Generate the Code Index (292 files indexed)
bun run scripts/generate-code-index.ts
```

### Step 4: Start the App

```bash
# Development mode (hot reload)
bun run dev

# The app starts on http://localhost:3000
# Dashboard: http://localhost:3000/dashboard
# Settings: http://localhost:3000/dashboard/settings
```

### Step 5: Install Ollama (Local LLM — Free)

```bash
# Install Ollama (macOS/Linux)
curl -fsSL https://ollama.com/install.sh | sh

# Pull the required models (one-time, ~5GB total)
ollama pull llama3.2:3b           # Chat model (2GB)
ollama pull qwen2.5-coder:7b      # Code model (4.5GB)
ollama pull qwen2.5vl:3b          # Vision model (2GB) — for brand extraction
ollama pull nomic-embed-text      # Embedding model (270MB) — for vector memory

# Verify Ollama is running
curl http://localhost:11434/api/tags
```

### Step 6: Verify Everything Works

```bash
# Type check
bunx tsc --noEmit                  # → 0 errors

# Run tests
bun test ./tests/*.test.ts ./tests/api/*.test.ts  # → 135 pass

# Run chaos tests
bun run scripts/chaos-test.ts      # → 8/8 pass

# Run simulations (200 scenarios)
bun run scripts/daily-knowledge-refresh.ts  # → seeds lessons from worklog
```

**Local setup is complete!** The app is running with:
- 57-agent fleet across 15 departments
- 69 skills with full instructions
- 200+ Knowledge Base entries
- 37 Constitution rules (ALL injected into every LLM call)
- 200 simulation scenarios across 6 suites
- Real vector memory (cosine similarity via nomic-embed-text)
- 12-layer safety defense system

---

## 3. Oracle Cloud Free Tier Deployment (30 minutes)

### Step 1: Create the VM

1. Log in to [Oracle Cloud Console](https://cloud.oracle.com)
2. **Compute → Instances → Create Instance**
3. Configure:
   - **Shape:** VM.Standard.A1.Flex (Always Free: 4 OCPU + 24GB RAM)
   - **Image:** Canonical Ubuntu 22.04
   - **SSH Key:** Add your public key
   - **VNIC:** Assign a public IP
4. Click **Create**

### Step 2: SSH + Install Dependencies

```bash
# SSH into the VM
ssh ubuntu@<your-vm-public-ip>

# Update system
sudo apt update && sudo apt upgrade -y

# Install Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull models (run in background — takes ~10 min)
nohup sh -c 'ollama pull llama3.2:3b && ollama pull qwen2.5-coder:7b && ollama pull qwen2.5vl:3b && ollama pull nomic-embed-text' &

# Install Docker (for FreeSWITCH + Pipecat + Piper)
sudo apt install docker.io docker-compose -y
sudo usermod -aG docker ubuntu
# Log out and back in for docker group to take effect

# Install Git
sudo apt install git -y
```

### Step 3: Deploy the App

```bash
# Clone the repository
git clone <your-repo> aria-mission-control
cd aria-mission-control

# Install dependencies
bun install

# Set up environment
cp .env.example .env
nano .env  # Set: DATABASE_URL, ARIA_OWNER_EMAIL, ZAI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, NEXTAUTH_URL=https://your-domain.com

# Database setup
bunx prisma generate
bunx prisma db push --accept-data-loss
bun run scripts/seed-knowledge-base.ts
bun run scripts/generate-code-index.ts

# Build for production
bun run build

# Start the production server
bun run start:prod
```

### Step 4: Set Up Caddy (HTTPS Reverse Proxy)

```bash
# Install Caddy
sudo apt install debian-keyring debian-archive-keyring apt-transport-https -y
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy -y

# Configure Caddy (edit /etc/caddy/Caddyfile)
sudo nano /etc/caddy/Caddyfile
```

Caddyfile content:
```
your-domain.com {
    reverse_proxy localhost:3000
}
```

```bash
# Restart Caddy
sudo systemctl restart caddy
```

### Step 5: Set Up as a Systemd Service (Auto-Restart)

```bash
sudo nano /etc/systemd/system/aria.service
```

Service file:
```ini
[Unit]
Description=ARIA Mission Control
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/aria-mission-control
ExecStart=/home/ubuntu/.bun/bin/bun run start:prod
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable aria
sudo systemctl start aria
sudo systemctl status aria  # Verify it's running
```

### Step 6: Configure Telegram Bot

1. Open Telegram, search for **@BotFather**
2. Send `/newbot` → follow prompts → get the Bot Token
3. Send `/setcommands` to BotFather → paste:
   ```
   approve - Approve a pending item
   deny - Deny a pending item
   discuss - Ask a question before approving
   pay-approve - Approve a payment (60s cooldown)
   pause - Pause all autonomous operations
   resume - Resume autonomous operations
   answer - Answer a context gap question
   status - Check system status
   ```
4. Get your Chat ID: send a message to your bot, then visit:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
5. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`

---

## 4. Voice Services Setup (Pipecat + FreeSWITCH + Piper)

### Step 1: Start Docker Services

```bash
cd ~/aria-mission-control

# Start FreeSWITCH + Pipecat + Piper TTS
docker-compose up -d

# Verify all 3 containers are running
docker-compose ps
```

### Step 2: Install Piper TTS Voice Model

```bash
# Download the default voice (en_US-lessac-medium, ~60MB)
mkdir -p voices
cd voices
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
cd ..
```

### Step 3: Fish Audio Setup (Premium Voice Cloning)

**Option A: Free API Tier (Recommended for Oracle)**
1. Register at [fish.audio](https://fish.audio)
2. Get your API key from the dashboard
3. Set in `.env`: `FISH_AUDIO_API_KEY=your-key`
4. Set in `.env`: `FISH_AUDIO_MODE=api`

**Option B: Self-Host (Requires GPU — NOT available on Oracle Free Tier)**
- Not recommended for Oracle Free Tier (ARM CPU only, no GPU)
- If you have a separate GPU machine, run Fish Speech there + set `FISH_AUDIO_URL`

**Option C: Fallback to Piper Only**
- If Fish Audio is unavailable, set `FISH_AUDIO_MODE=piper`
- All voice will use Piper TTS (slightly less natural but zero latency)

### Step 4: Verify Voice Pipeline

```bash
# Check Pipecat health
curl http://localhost:8080/health

# Check Piper TTS
curl http://localhost:5000/health

# Check FreeSWITCH ESL
echo "api status" | nc localhost 8021
```

### Step 5: AI Caller Safety Gate

Before making any calls, you MUST enable the safety gate in `.env`:
```bash
AI_CALLER_ENABLED=true
AI_CALLER_CONSENT_VERIFIED=true
```

**Legal note:** AI-driven outbound calls require documented consent in most jurisdictions. Only enable if you have legal clearance.

---

## 5. WhatsApp Setup (Baileys — Zero Cost)

### Step 1: Start the App

The Baileys WhatsApp client initializes automatically on the first `sendWhatsAppMessage` call.

### Step 2: Scan the QR Code

1. Start the app: `bun run start:prod`
2. Check the logs for the QR code event:
   ```bash
   tail -f logs/server.log | grep "QR"
   ```
3. The QR code will be displayed in the dashboard under **Settings → WhatsApp**
4. Open WhatsApp on your phone → **Settings → Linked Devices → Link a Device**
5. Scan the QR code

### Step 3: Verify Connection

Once connected, you'll see:
```
✅ WhatsApp connected via Baileys (open-source, zero-cost)
```

Messages will now be sent via WhatsApp Web (free, no paid API).

---

## 6. Post-Deployment Verification

### Step 1: Verify the App is Running

```bash
# Health check
curl https://your-domain.com/api/health

# Dashboard
open https://your-domain.com/dashboard

# Settings (verify all env vars are loaded)
open https://your-domain.com/dashboard/settings
```

### Step 2: Verify Ollama Models

```bash
curl http://localhost:11434/api/tags

# Should list: llama3.2:3b, qwen2.5-coder:7b, qwen2.5vl:3b, nomic-embed-text
```

### Step 3: Verify Docker Services

```bash
docker-compose ps

# All 3 should be "Up":
# aria-freeswitch   Up   0.0.0.0:5060->5060/udp
# aria-pipecat      Up   0.0.0.0:8080->8080
# aria-piper-tts    Up   0.0.0.0:5000->5000
```

### Step 4: Verify Telegram Bot

Send a message to your Telegram bot:
```
/status
```
It should respond with the system status.

### Step 5: Run the Simulation Suite

```bash
# Trigger all 200 simulations manually
curl -X POST https://your-domain.com/api/simulations/run \
  -H "Content-Type: application/json" \
  -d '{"suite":"all"}'

# Check the report
curl https://your-domain.com/api/simulations/report
```

### Step 6: Verify Knowledge Base

```bash
# Check Skill count (should be 69+)
curl https://your-domain.com/api/knowledge-base

# Check simulation metrics
curl https://your-domain.com/api/simulations/metrics
```

### Step 7: Verify Autonomy Controls

```bash
# Test the kill switch (pauses all autonomous operations)
curl -X POST https://your-domain.com/api/autonomy/pause

# Verify it's paused
curl https://your-domain.com/api/system | jq '.autonomyPaused'

# Resume
curl -X POST https://your-domain.com/api/autonomy/resume
```

---

## 7. Troubleshooting

### Ollama Not Responding

```bash
# Check if Ollama is running
systemctl status ollama

# If not, start it
sudo systemctl start ollama

# Check model availability
ollama list

# If models are missing, pull them
ollama pull llama3.2:3b
```

### Database Locked (SQLite)

```bash
# If you see "database is locked" errors:
# 1. Stop the app
sudo systemctl stop aria

# 2. Check for locked WAL files
ls -la db/custom.db*

# 3. Delete the WAL + SHM files (safe — they're just caches)
rm -f db/custom.db-wal db/custom.db-shm

# 4. Restart
sudo systemctl start aria
```

### WhatsApp Not Connecting

```bash
# Delete the session and re-scan QR
rm -rf whatsapp-session/

# Restart the app — a new QR code will be generated
sudo systemctl restart aria
```

### Pipecat Not Connecting to FreeSWITCH

```bash
# Check FreeSWITCH ESL
echo "api status" | nc localhost 8021

# If connection refused, restart FreeSWITCH
docker-compose restart freeswitch

# Check Pipecat logs
docker-compose logs pipecat
```

### App Crashes on Startup

```bash
# Check the logs
journalctl -u aria -n 50

# Common causes:
# 1. Missing .env file → cp .env.example .env
# 2. Missing Prisma client → bunx prisma generate
# 3. Missing database → bunx prisma db push --accept-data-loss
# 4. Missing node_modules → bun install
```

---

## Quick Reference: Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes | `file:./db/custom.db` | SQLite dev / PostgreSQL prod |
| `ARIA_OWNER_EMAIL` | Yes | — | Owner alerts (escalations) |
| `ZAI_API_KEY` | Yes | — | Primary LLM provider (free) |
| `TELEGRAM_BOT_TOKEN` | Yes | — | Approval notifications |
| `TELEGRAM_CHAT_ID` | Yes | — | Your personal chat ID |
| `NEXTAUTH_URL` | Prod | `http://localhost:3000` | Public URL (HTTPS) |
| `NEXTAUTH_SECRET` | Auto | auto-generated | Session signing |
| `ENCRYPTION_MASTER_KEY` | Auto | auto-generated | Credential Vault AES-256-GCM |
| `CRYPTO_WALLET_ADDRESS` | No | — | For crypto payments |
| `RESEND_API_KEY` | No | — | For email outreach |
| `RESEND_FROM_EMAIL` | No | — | Verified sender domain |
| `AI_CALLER_ENABLED` | No | `false` | Outbound calls (legal gate) |
| `AI_CALLER_CONSENT_VERIFIED` | No | `false` | Consent verification |
| `DEPLOYMENT_ENV` | No | — | `oracle-free-tier` for free mode |
| `FREE_ONLY_MODE` | No | `false` | Skip all paid LLM providers |
| `ARIA_SIMULATION_MODE` | No | `false` | Generate demo data |
| `FISH_AUDIO_API_KEY` | No | — | Premium voice cloning |
| `FISH_AUDIO_MODE` | No | `api` | `api` / `local` / `piper` |

---

## Resource Usage on Oracle Free Tier (24GB ARM)

| Component | RAM | CPU | Status |
|---|---|---|---|
| Next.js app | ~512MB | 1 vCPU | ✅ Runs natively |
| Ollama (4 models) | ~4GB | 1 vCPU | ✅ Runs natively on ARM |
| SQLite database | ~100MB | shared | ✅ File-based |
| FreeSWITCH (Docker) | ~256MB | 0.5 vCPU | ✅ Docker container |
| Pipecat (Docker) | ~200MB | 0.5 vCPU | ✅ Docker container |
| Piper TTS (Docker) | ~100MB | 0.25 vCPU | ✅ Docker container |
| Caddy (HTTPS) | ~50MB | shared | ✅ System service |
| **Total** | **~5.2GB** | **3.25 vCPU** | **Fits in 24GB / 4 vCPU** |

**Remaining headroom:** ~19GB RAM + 0.75 vCPU — plenty for scaling.

---

*This guide is the complete, step-by-step deployment manual for ARIA Mission Control v68. Follow it in order — each step builds on the previous one.*
