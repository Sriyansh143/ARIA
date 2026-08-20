# ARIA Mission Control — Deployment Topology (v66 Phase 16)

**Oracle Free Tier:** 24GB RAM ARM (Ampere A1) · 4 vCPU · 200GB block storage · NO GPU

---

## What Runs Where

### Oracle VM (In-Process — Next.js + Ollama + SQLite)

| Component | Memory | CPU | Port | Notes |
|---|---|---|---|---|
| **Next.js app** | ~512MB | 1 vCPU | 3000 | The main app — all TypeScript logic |
| **Ollama** | ~2-4GB | 1 vCPU | 11434 | Local LLM: llama3.2:3b (chat), qwen2.5-coder:7b (code), qwen2.5vl:3b (vision), nomic-embed-text (embeddings) |
| **SQLite** | ~100MB | shared | file | Dev database (PostgreSQL for production) |
| **Piper TTS** | ~100MB | 0.5 vCPU | 5000 | Fast filler voice (<100ms latency, runs natively on ARM) |
| **Pipecat** | ~200MB | 0.5 vCPU | 8080 | Python voice bridge (FreeSWITCH ↔ LLM ↔ TTS) |

**Total Oracle VM usage:** ~3-5GB RAM · 3 vCPU · fits comfortably in 24GB / 4 vCPU.

### Docker Containers (On Oracle VM)

| Container | Image | Port | Purpose |
|---|---|---|---|
| **FreeSWITCH** | `bettervoice/freeswitch-container:latest` | 5060 (SIP), 8021 (ESL) | SIP/RTP phone call routing |
| **Pipecat** | Custom (`services/pipecat/`) | 8080 | Voice conversation orchestration (VAD + barge-in + Dual-TTS) |
| **Piper TTS** | `rhasspy/piper:latest` | 5000 | Instant filler voice generation |

### External Services (If Oracle CPU Can't Handle)

| Service | When to Use | Free Option |
|---|---|---|
| **Fish Audio** | Voice cloning (premium quality) | Free API tier (limited) OR self-host on free Colab/Kaggle GPU |
| **CosyVoice** | Alternative to Fish Audio (lighter) | Self-host on Oracle VM (CPU mode, slower but works) |
| **WhatsApp (Baileys)** | Zero-cost WhatsApp messaging | `@whiskeysockets/baileys` npm package (no paid API) |
| **Z-AI** | LLM provider (when Ollama is overloaded) | Free tier via z-ai-web-dev-sdk |

### v69 Phase 19 BLOCKER 8: Fish Audio ARM64 Auto-Fallback

The Oracle Free Tier runs on ARM64 (Ampere A1) without a GPU. `fish-speech`
(self-hosted Fish Audio) does NOT run on ARM64 without significant
quantization work. To prevent runtime crashes on Oracle deployments:

1. **Auto-detection** (services/pipecat/main.py:`_check_fish_audio`):
   - If `FISH_AUDIO_MODE=api` + `FISH_AUDIO_API_KEY` is set → use the cloud
     Fish Audio API (works on any arch, costs API credits).
   - If `FISH_AUDIO_MODE=local` or `cosyvoice` AND the platform is ARM64
     without `fish_speech` importable → set `_fish_available = False` and
     log a warning. All TTS output then uses Piper (Piper-only mode).
   - If neither condition holds → default to Piper-only mode.

2. **Operational implication**: on Oracle Free Tier, you have two viable
   Fish Audio paths:
   - **Path A (free, recommended)**: set `FISH_AUDIO_MODE=api` and leave
     `FISH_AUDIO_API_KEY=""`. The service will run in Piper-only mode —
     every TTS output uses Piper. Lower quality but zero cost + zero GPU.
   - **Path B (premium quality, paid)**: set `FISH_AUDIO_MODE=api` and
     provide a `FISH_AUDIO_API_KEY`. Fish Audio cloud API is used for
     brain responses; Piper is still the filler voice.

3. **No runtime crashes**: the `_check_fish_audio()` check runs ONCE at
   `DualTTSPipeline.__init__()` time and sets a class-level flag. All
   subsequent calls reference the flag — no per-call try/catch failures
   surface to the caller.


---

## Dual-TTS Architecture (RULE-59)

```
Customer speaks
    ↓
Pipecat (VAD detects speech end)
    ↓
Ollama LLM generates response (1-2s)
    ↓ INSTANTLY (0ms)
Piper TTS plays filler: "Let me check that for you..."
    ↓ MEANWHILE
Fish Audio generates premium cloned voice response
    ↓ When ready
Fish Audio streams the actual answer
    ↓
Customer hears one continuous, natural response
```

**Latency budget:**
- Piper filler: <100ms (instant — runs natively on ARM)
- Fish Audio: 500-1500ms (acceptable — if >800ms, degrade to Piper per RULE-59)
- Total perceived latency: 0ms (filler covers the gap)

---

## FreeSWITCH + Pipecat Flow

```
Phone call arrives (SIP)
    ↓
FreeSWITCH (Docker, port 5060)
    ↓ ESL connection (port 8021)
Pipecat (Python, port 8080)
    ↓
    ├─ VAD: detects when customer starts/stops speaking
    ├─ Barge-in: if customer interrupts, stop AI audio immediately
    ├─ LLM: calls Ollama (localhost:11434) for response generation
    ├─ TTS: Piper (filler) + Fish Audio (brain)
    └─ State: tracks conversation stage (hook → demo → negotiate → close)
    ↓
Audio streamed back via RTP to FreeSWITCH → customer's phone
```

---

## WhatsApp via Baileys (RULE-58)

```
Outreach Executor
    ↓
src/lib/whatsapp/business.ts (existing — WhatsApp Business Cloud API)
    ↓ FALLBACK (if no paid API key)
@whiskeysockets/baileys (NEW — zero-cost, open-source)
    ↓
QR code scan → WhatsApp Web session
    ↓
Send preview images, take confirmations, schedule calls
    ↓
Respect: business hours (9-18 recipient tz) + rate limits + opt-out
```

---

## Build → Preview → Publish Flow (Z.ai-Style)

```
Service Builder generates deliverable
    ↓
Pre-Publish Quality Gate (RULE-51) — score >= 70?
    ↓ YES
Protected Preview created (RULE-55)
    ↓
Owner gets preview link (always)
    ↓
Owner clicks "Approve → Publish"
    ↓
Service goes live (status: "launched") — visible to customers
    ↓
Customer requests preview → gets view-only link with watermark
    ↓
Customer can SEE but not COPY (anti-copy layers active)
```

---

## Installation Commands

```bash
# 1. On Oracle VM — install Ollama + pull models
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2:3b
ollama pull qwen2.5-coder:7b
ollama pull qwen2.5vl:3b
ollama pull nomic-embed-text

# 2. Install Piper TTS (native ARM binary)
wget https://github.com/rhasspy/piper/releases/latest/download/piper_linux_aarch64.tar.gz
tar -xzf piper_linux_aarch64.tar.gz
./piper/piper --model en_US-lessac-medium.onnx --output_file test.wav

# 3. Start Docker services (FreeSWITCH + Pipecat + Piper)
docker-compose up -d

# 4. Start the Next.js app
bun run start:prod

# 5. Verify all services are running
curl http://localhost:3000/api/health
curl http://localhost:11434/api/tags  # Ollama
curl http://localhost:8080/health      # Pipecat
```

---

## Resource Limits & Fallbacks

| Scenario | Detection | Fallback |
|---|---|---|
| Ollama CPU overloaded | Response latency > 10s | Route to Z-AI free tier |
| Fish Audio latency > 800ms | Measured per-call | Degrade to Piper TTS (RULE-59) |
| FreeSWITCH unavailable | ESL connection fails | Use Twilio trial (free $15 credit) |
| WhatsApp Baileys session expired | QR code re-scan needed | Re-scan + log + notify owner |
| Oracle VM RAM > 20GB | `free -m` check | Stop non-critical Docker containers |
| SQLite lock contention | Write queue > 1000 | Switch to PostgreSQL |

---

*This document is the single source of truth for deployment architecture. Update it whenever a service moves or a new component is added.*
