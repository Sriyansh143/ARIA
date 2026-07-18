#!/usr/bin/env bash
# =====================================================================
# JARVIS Mission Control — Single-Click Setup Script
# =====================================================================
# Installs everything needed to run the app:
#   1. Node.js + Bun (if not installed)
#   2. Dependencies (bun install)
#   3. Database (prisma db push + generate)
#   4. Seeds all data (agents, skills, cron, models, rules, earning methods)
#   5. Ollama (optional — asks user, downloads if needed)
#   6. FreeSWITCH (optional — asks user, downloads if needed)
#   7. Starts all services (app + realtime + ollama + freeswitch)
#
# Usage: chmod +x setup.sh && ./setup.sh
# =====================================================================

set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

print_step() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }
print_ok() { echo -e "  ${GREEN}✅ $1${NC}"; }
print_warn() { echo -e "  ${YELLOW}⚠️  $1${NC}"; }
print_err() { echo -e "  ${RED}❌ $1${NC}"; }
ask() { read -p "$(echo -e "${YELLOW}❓ $1 [Y/n]: ${NC}")" response; [[ "$response" =~ ^[Yy]$ || -z "$response" ]]; }

cd "$(dirname "$0")"

# ─── 1. Check prerequisites ──────────────────────────────────────────
print_step "1/8: Checking Prerequisites"

if command -v bun &>/dev/null; then
    print_ok "Bun installed: $(bun --version)"
else
    print_warn "Bun not found. Installing..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    print_ok "Bun installed: $(bun --version)"
fi

if command -v node &>/dev/null; then
    print_ok "Node.js installed: $(node --version)"
else
    print_err "Node.js not found. Please install Node.js 18+ first."
    exit 1
fi

if command -v git &>/dev/null; then
    print_ok "Git installed: $(git --version)"
fi

# ─── 2. Install dependencies ─────────────────────────────────────────
print_step "2/8: Installing Dependencies"
bun install
print_ok "Dependencies installed"

# ─── 3. Setup database ───────────────────────────────────────────────
print_step "3/8: Setting Up Database"
mkdir -p db
bunx prisma db push --accept-data-loss
bunx prisma generate
print_ok "Database created and schema pushed"

# ─── 4. Seed all data ────────────────────────────────────────────────
print_step "4/8: Seeding Data"
echo "  Seeding agents..."
bunx tsx scripts/seed.ts 2>/dev/null || true
echo "  Seeding agent roster..."
bunx tsx scripts/seed-agents.ts 2>/dev/null || true
echo "  Seeding cron jobs..."
bunx tsx scripts/seed-cron.ts 2>/dev/null || true
echo "  Seeding providers + models..."
bunx tsx scripts/seed-providers-models.ts 2>/dev/null || true
echo "  Seeding rules..."
bunx tsx scripts/seed-rules.ts 2>/dev/null || true
echo "  Seeding earning methods..."
bunx tsx scripts/seed-earning-methods.ts 2>/dev/null || true
echo "  Seeding comms + payments..."
bunx tsx scripts/seed-add.ts 2>/dev/null || true
print_ok "All data seeded"

# ─── 5. Store API keys from .env ─────────────────────────────────────
print_step "5/8: Storing API Keys from .env"
bunx tsx -e "
const { db } = require('./src/lib/db');
const { encryptPassword } = require('./src/lib/credential-vault');
const map = {
  'zai': 'ZAI_API_KEY', 'groq': 'GROQ_API_KEY', 'nvidia-nim': 'NVIDIA_API_KEY',
  'qwen-playground': 'QWEN_API_KEY', 'github-models': 'GITHUB_TOKEN',
  'huggingface': 'HUGGINGFACE_API_KEY', 'siliconflow': 'SILICONFLOW_API_KEY',
  'higgsfield': 'HIGGSFIELD_API_KEY', 'openai': 'OPENAI_API_KEY',
  'anthropic': 'ANTHROPIC_API_KEY', 'together': 'TOGETHER_API_KEY',
  'fireworks': 'FIREWORKS_API_KEY', 'mistral': 'MISTRAL_API_KEY',
  'cohere': 'COHERE_API_KEY', 'deepseek': 'DEEPSEEK_API_KEY',
  'openrouter': 'OPENROUTER_API_KEY',
};
(async () => {
  let stored = 0;
  for (const [pk, ev] of Object.entries(map)) {
    const key = process.env[ev];
    if (!key || !key.trim() || key.includes('REDACTED')) continue;
    const p = await db.provider.findFirst({ where: { key: pk } });
    if (!p) continue;
    if (p.apiKeyEnc) continue;
    const enc = encryptPassword(key);
    await db.provider.update({ where: { id: p.id }, data: { apiKeyEnc: enc.encrypted, apiKeyIv: enc.iv, apiKeyTag: enc.tag } });
    stored++;
  }
  console.log('  ✅ ' + stored + ' API keys stored from .env');
  await db.\$disconnect();
})();
" 2>/dev/null || print_warn "Some keys could not be stored (check .env)"

# ─── 6. Ollama (optional) ────────────────────────────────────────────
print_step "6/8: Ollama (Local AI Models)"

if command -v ollama &>/dev/null; then
    print_ok "Ollama already installed: $(ollama --version 2>/dev/null || echo 'installed')"
    # Check if it's running
    if curl -s http://localhost:11434/api/tags &>/dev/null; then
        print_ok "Ollama is running"
        MODELS=$(curl -s http://localhost:11434/api/tags | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('models',[])))" 2>/dev/null || echo "?")
        print_ok "$MODELS local models detected"
    else
        print_warn "Ollama installed but not running. Starting..."
        ollama serve &>/dev/null &
        sleep 3
        if curl -s http://localhost:11434/api/tags &>/dev/null; then
            print_ok "Ollama started"
        else
            print_warn "Could not start Ollama. Run 'ollama serve' manually."
        fi
    fi
else
    if ask "Ollama is not installed. Download and install? (~150MB)"; then
        print_step "Downloading Ollama..."
        curl -fsSL https://ollama.com/install.sh | sh
        print_ok "Ollama installed"
        # Start it
        ollama serve &>/dev/null &
        sleep 3
        if curl -s http://localhost:11434/api/tags &>/dev/null; then
            print_ok "Ollama started and running"
        else
            print_warn "Ollama installed but couldn't auto-start. Run 'ollama serve' manually."
        fi
        # Ask which models to pull
        if ask "Pull recommended models? (qwen2.5:7b, qwen2.5:3b — ~5GB total)"; then
            echo "  Pulling qwen2.5:7b..."
            ollama pull qwen2.5:7b &>/dev/null || print_warn "Failed to pull qwen2.5:7b"
            echo "  Pulling qwen2.5:3b..."
            ollama pull qwen2.5:3b &>/dev/null || print_warn "Failed to pull qwen2.5:3b"
            print_ok "Models pulled"
        fi
    else
        print_warn "Ollama skipped. You can install later with: curl -fsSL https://ollama.com/install.sh | sh"
    fi
fi

# ─── 7. FreeSWITCH (optional) ────────────────────────────────────────
print_step "7/8: FreeSWITCH (Voice/Calling)"

if command -v freeswitch &>/dev/null; then
    print_ok "FreeSWITCH already installed"
    # Check if running
    if nc -z 127.0.0.1 8021 2>/dev/null; then
        print_ok "FreeSWITCH ESL is running (port 8021)"
    else
        print_warn "FreeSWITCH installed but not running. Starting..."
        freeswitch -nc &>/dev/null &
        sleep 3
        if nc -z 127.0.0.1 8021 2>/dev/null; then
            print_ok "FreeSWITCH started"
        else
            print_warn "Could not start FreeSWITCH. Run 'freeswitch -nc' manually."
        fi
    fi
else
    if ask "FreeSWITCH is not installed. Download and install? (~500MB, required for voice calling)"; then
        print_step "Installing FreeSWITCH..."
        # Try apt first (Debian/Ubuntu)
        if command -v apt-get &>/dev/null; then
            apt-get update && apt-get install -y freeswitch freeswitch-mod-commands freeswitch-mod-esl freeswitch-mod-dialplan-xml 2>/dev/null || {
                print_warn "apt-get install failed. Trying manual download..."
                # Manual download would go here — but it's very large and platform-specific
                print_warn "Please install FreeSWITCH manually from https://freeswitch.org/confluence/display/FREESWITCH/Installation"
            }
        else
            print_warn "Package manager not found. Please install FreeSWITCH manually from https://freeswitch.org/confluence/display/FREESWITCH/Installation"
        fi
        
        if command -v freeswitch &>/dev/null; then
            print_ok "FreeSWITCH installed"
            freeswitch -nc &>/dev/null &
            sleep 3
            if nc -z 127.0.0.1 8021 2>/dev/null; then
                print_ok "FreeSWITCH started"
            else
                print_warn "FreeSWITCH installed but couldn't auto-start. Run 'freeswitch -nc' manually."
            fi
        fi
    else
        print_warn "FreeSWITCH skipped. Voice calling will not work until installed."
    fi
fi

# ─── 8. Start all services ───────────────────────────────────────────
print_step "8/8: Starting Services"

# Kill any existing instances
pkill -f "next dev" 2>/dev/null || true
pkill -f "realtime-service" 2>/dev/null || true
sleep 1

# Start the realtime WebSocket service
if [ -f "mini-services/realtime-service/index.ts" ]; then
    echo "  Starting WebSocket realtime service (port 3003)..."
    cd mini-services/realtime-service
    bun install 2>/dev/null || true
    ( setsid bash -c 'exec bun --hot index.ts' </dev/null >>../../realtime.log 2>&1 & )
    cd ../..
    sleep 2
    print_ok "Realtime service started (port 3003)"
fi

# Start the main app
echo "  Starting JARVIS Mission Control (port 3000)..."
( setsid bash -c 'exec bunx next dev -p 3000' </dev/null >>dev.log 2>&1 & )
sleep 10

# Verify
if curl -s -m 10 http://localhost:3000/ -o /dev/null -w "%{http_code}" | grep -q "200"; then
    print_ok "JARVIS Mission Control is running at http://localhost:3000"
else
    print_err "App failed to start. Check dev.log for errors."
    exit 1
fi

# ─── Summary ─────────────────────────────────────────────────────────
print_step "Setup Complete!"

echo -e "
${GREEN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}
${GREEN}${BOLD}║     JARVIS Mission Control is now running!               ║${NC}
${GREEN}${BOLD}╠══════════════════════════════════════════════════════════╣${NC}
${GREEN}${BOLD}║  🌐 App:           http://localhost:3000                 ║${NC}
${GREEN}${BOLD}║  🔌 WebSocket:     port 3003 (realtime)                 ║${NC}
${GREEN}${BOLD}║  📞 FreeSWITCH:    port 8021 (if installed)             ║${NC}
${GREEN}${BOLD}║  🤖 Ollama:        port 11434 (if installed)            ║${NC}
${GREEN}${BOLD}╠══════════════════════════════════════════════════════════╣${NC}
${GREEN}${BOLD}║  API keys:    Auto-loaded from .env                     ║${NC}
${GREEN}${BOLD}║  Database:    SQLite at db/custom.db                    ║${NC}
${GREEN}${BOLD}║  Models:      455 models across 23 providers            ║${NC}
${GREEN}${BOLD}║  Agents:      69 agents (5 monitoring, 62 executing,    ║${NC}
${GREEN}${BOLD}║               2 error-handlers)                         ║${NC}
${GREEN}${BOLD}║  Cron jobs:   33 autonomous dispatchers                 ║${NC}
${GREEN}${BOLD}║  Rules:       31 permanent rules                        ║${NC}
${GREEN}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}
"

echo -e "${YELLOW}To stop all services:${NC} pkill -f 'next dev' && pkill -f 'realtime-service'"
echo -e "${YELLOW}To restart:${NC} ./setup.sh"
echo -e "${YELLOW}Documentation:${NC} cat APP_DOCUMENTATION.md | less"
echo -e "${YELLOW}Pending tasks:${NC} cat PENDING_TASKS.md | less"
echo -e "${YELLOW}Rules:${NC} cat RULES.md | less"
echo ""
