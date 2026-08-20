# ARIA Mission Control — Deployment Guide

## Option 1: Git Clone (Recommended for Production)

```bash
# Clone the repository
git clone <your-repo-url> aria-mission-control
cd aria-mission-control

# Install dependencies
bun install

# Copy + edit environment
cp .env.example .env
nano .env  # fill in your keys

# Set up the database (SQLite dev or Supabase prod)
DATABASE_URL="file:./db/custom.db" bunx prisma db push --accept-data-loss
bunx prisma generate

# Start the dev server
bun run dev

# OR build for production
bun run build
NODE_ENV=production bun .next/standalone/server.js
```

## Option 2: SCP (For Large Zips > 25MB)

If the zip is too large for the platform's download mechanism, use SCP:

```bash
# On your local machine
scp aria-mission-control-v61-FULL.zip ubuntu@<your-server-ip>:~/

# SSH into the server
ssh ubuntu@<your-server-ip>

# Unzip + install
unzip aria-mission-control-v61-FULL.zip -d aria-mission-control
cd aria-mission-control
bun install
cp .env.example .env
nano .env
DATABASE_URL="file:./db/custom.db" bunx prisma db push --accept-data-loss
bunx prisma generate
bun run dev
```

## Option 3: rsync (For Incremental Updates)

```bash
# Sync only changed files (fast)
rsync -avz --exclude node_modules --exclude .next --exclude db/ \
  ./ ubuntu@<your-server-ip>:/home/ubuntu/aria-mission-control/

# On the server
ssh ubuntu@<your-server-ip>
cd aria-mission-control
bun install
bunx prisma db push
bun run dev
```

## Oracle Cloud Free Tier Setup

### 1. Create the VM

- Go to cloud.oracle.com → Compute → Create Instance
- Image: Canonical Ubuntu 22.04
- Shape: VM.Standard.A1.Flex (ARM Ampere, 4 OCPU + 24GB RAM — free tier)
- Add SSH key

### 2. Install Ollama (Local AI)

```bash
ssh ubuntu@<your-vm-ip>

# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull lightweight models (uses ~8GB RAM total)
ollama pull qwen2.5-coder:7b
ollama pull llama3.2:3b
ollama pull qwen2.5-coder:1.5b

# Start the server (runs on localhost:11434)
ollama serve &

# Verify
curl http://localhost:11434/api/tags
```

### 3. Install Bun + ARIA

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Clone + install ARIA
git clone <your-repo-url> aria-mission-control
cd aria-mission-control
bun install

# Configure environment
cp .env.example .env
# Edit .env:
#   DATABASE_URL=postgresql://postgres:...@db.xxx.supabase.co:5432/postgres
#   OLLAMA_HOST=http://localhost:11434
#   DEPLOYMENT_ENV=oracle-free-tier
#   FREE_ONLY_MODE=true
#   OWNER_TIMEZONE=Asia/Kolkata
nano .env

# Set up database
bunx prisma db push --accept-data-loss
bunx prisma generate

# Build + start
bun run build
NODE_ENV=production nohup bun .next/standalone/server.js > app.log 2>&1 &
```

### 4. Set Up Supabase (Managed PostgreSQL)

1. Go to https://supabase.com → New Project (free tier)
2. Settings → Database → Connection string → Copy URI
3. Set `DATABASE_URL` in `.env` to the Supabase connection string
4. Run `bunx prisma db push --accept-data-loss`
5. Supabase gives you: automatic backups, real-time subscriptions, REST API, dashboard

### 5. Configure Telegram Bot

1. Talk to @BotFather on Telegram → /newbot → get the token
2. Get your chat ID (talk to @userinfobot)
3. Set in `.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
   TELEGRAM_CHAT_ID=5390514958
   ```
4. Set the webhook:
   ```
   curl https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-domain>/api/telegram/webhook
   ```

### 6. Configure Firewall (Oracle Cloud)

```bash
# Open ports 3000 (app) + 80/443 (if using Caddy/nginx)
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT
sudo netfilter-persistent save

# Also add an Ingress Rule in the Oracle Cloud dashboard:
# VCN → Security Lists → Add Ingress Rule → Port 3000, Source 0.0.0.0/0
```

## Environment Variables (Critical)

| Variable | Value | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://...supabase.co...` | Supabase PostgreSQL |
| `OLLAMA_HOST` | `http://localhost:11434` | Local Ollama on the VM |
| `DEPLOYMENT_ENV` | `oracle-free-tier` | Enforce lightweight routing |
| `FREE_ONLY_MODE` | `true` | Skip paid LLM providers |
| `OWNER_TIMEZONE` | `Asia/Kolkata` | Business hours 9 AM-6 PM |
| `TELEGRAM_BOT_TOKEN` | `123456:ABC...` | Telegram bot for approvals |
| `TELEGRAM_CHAT_ID` | `5390514958` | Owner's Telegram chat ID |
| `ENCRYPTION_MASTER_KEY` | `openssl rand -hex 32` | AES-256-GCM for credential vault |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` | JWT session signing |
| `NEXTAUTH_URL` | `https://your-domain.com` | Public URL |

## Verification After Deployment

```bash
# Type check
bunx tsc --noEmit

# Tests
bun test ./tests/*.test.ts ./tests/api/*.test.ts

# Build
bun run build

# Health check
curl http://localhost:3000/api/health

# Telegram test
# Send /status to your bot — it should reply with the system status
```
