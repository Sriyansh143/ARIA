"use client";

/**
 * /dashboard/settings — Comprehensive Settings Page (v57).
 *
 * Lets the owner configure EVERYTHING from the browser:
 *   - LLM providers (Z-AI, Groq, NVIDIA, Ollama, OpenAI, Anthropic, Gemini)
 *   - Telephony (FreeSWITCH, Dograh, Twilio, owner phone, AI caller gate)
 *   - Lead Gen enrichment (Apollo, Hunter, Snov, Clearbit, ZoomInfo)
 *   - Payments (Crypto, UPI, Stripe, PayPal, Razorpay, Bank)
 *   - Email (Resend)
 *   - WhatsApp Business
 *   - Telegram
 *   - VAPID (Web Push)
 *   - Safety kill-switches
 *
 * All writes go through /api/settings/env which is auth-gated.
 */

import { useState, useEffect, FormEvent, useCallback } from "react";
import {
  Save, Eye, EyeOff, CheckCircle2, AlertTriangle, Loader2, RefreshCw,
  Cpu, Phone, Search, DollarSign, Mail, MessageSquare, Send,
  Shield, Power, Zap, Server, Settings as SettingsIcon,
} from "lucide-react";

interface KeyStatus {
  configured: boolean;
  masked: string | null;
}

interface ProviderStatus {
  keys: Record<string, KeyStatus>;
}

type Section = "llm" | "telephony" | "leadgen" | "payments" | "email" | "whatsapp" | "telegram" | "push" | "safety";

interface FieldDef {
  key: string;
  label?: string;
  placeholder?: string;
  type?: "text" | "password" | "url" | "number" | "email" | "select";
  options?: string[];
  default?: string;
  help?: string;
}

interface SectionDef {
  id: Section;
  name: string;
  description: string;
  icon: typeof Cpu;
  accent: string;
  fields: FieldDef[];
}

const SECTIONS: SectionDef[] = [
  {
    id: "llm",
    name: "AI / LLM Providers",
    description: "Configure which LLMs ARIA uses for agents, lead scoring, and service building.",
    icon: Cpu,
    accent: "violet",
    fields: [
      { key: "ZAI_API_KEY", label: "Z-AI API Key", type: "password", placeholder: "zai-...", help: "Default provider. Free at https://z.ai" },
      { key: "ZAI_BASE_URL", label: "Z-AI Base URL", type: "url", default: "https://api.z.ai/api/paas/v4" },
      { key: "GROQ_API_KEY", label: "Groq API Key", type: "password", placeholder: "gsk_...", help: "Fast cloud provider. Free at https://console.groq.com" },
      { key: "NVIDIA_API_KEY", label: "NVIDIA NIM API Key", type: "password", placeholder: "nvapi-..." },
      { key: "OPENAI_API_KEY", label: "OpenAI API Key", type: "password", placeholder: "sk-..." },
      { key: "ANTHROPIC_API_KEY", label: "Anthropic API Key", type: "password", placeholder: "sk-ant-..." },
      { key: "GEMINI_API_KEY", label: "Google Gemini API Key", type: "password", placeholder: "AIza..." },
      { key: "OLLAMA_HOST", label: "Ollama Host", type: "url", default: "http://127.0.0.1:11434", help: "Install from https://ollama.com" },
      { key: "WORKFORCE_MODEL_STRONG", label: "Strong Model (Ollama)", default: "qwen2.5:14b" },
      { key: "WORKFORCE_MODEL_BALANCED", label: "Balanced Model (Ollama)", default: "qwen2.5:7b" },
      { key: "WORKFORCE_MODEL_FAST", label: "Fast Model (Ollama)", default: "qwen2.5:3b" },
      { key: "ARIA_PREFER_LOCAL_LLM", label: "Prefer Local LLM", type: "select", options: ["0", "1"], default: "0" },
      { key: "LLM_DAILY_BUDGET_USD", label: "Daily LLM Budget ($)", type: "number", default: "1.00" },
    ],
  },
  {
    id: "telephony",
    name: "Phone Calls (Telephony)",
    description: "Configure outbound phone calls. Multiple providers supported — use any one.",
    icon: Phone,
    accent: "cyan",
    fields: [
      { key: "AI_CALLER_ENABLED", label: "AI Caller Enabled", type: "select", options: ["", "true"], default: "", help: "SAFETY GATE — must be 'true' to enable any calls" },
      { key: "AI_CALLER_CONSENT_VERIFIED", label: "Consent Verified", type: "select", options: ["", "true"], default: "", help: "SAFETY GATE — must be 'true' for legal compliance" },
      { key: "FREESWITCH_ESL_HOST", label: "FreeSWITCH ESL Host", default: "127.0.0.1", help: "Provider 1: native SIP server" },
      { key: "FREESWITCH_ESL_PORT", label: "ESL Port", default: "8021" },
      { key: "FREESWITCH_ESL_PASSWORD", label: "ESL Password", type: "password", default: "ClueCon" },
      { key: "FREESWITCH_SIP_GATEWAY", label: "SIP Gateway Name", default: "local-pstn" },
      { key: "FREESWITCH_FROM_NUMBER", label: "From Number (E.164)", placeholder: "+1..." },
      { key: "DOGRAH_API_KEY", label: "Dograh API Key", type: "password", help: "Provider 2: cloud telephony (India)" },
      { key: "DOGRAH_BASE_URL", label: "Dograh Base URL", type: "url", default: "https://api.dograh.com" },
      { key: "TWILIO_ACCOUNT_SID", label: "Twilio Account SID", placeholder: "AC...", help: "Provider 3: Twilio (popular)" },
      { key: "TWILIO_AUTH_TOKEN", label: "Twilio Auth Token", type: "password" },
      { key: "TWILIO_FROM_NUMBER", label: "Twilio From Number", placeholder: "+1..." },
      { key: "OWNER_PHONE_NUMBER", label: "Owner Phone (for notifications)", placeholder: "+91..." },
    ],
  },
  {
    id: "leadgen",
    name: "Lead Generation",
    description: "Enrichment APIs for B2B lead discovery. Z-AI web_search is the built-in default (free).",
    icon: Search,
    accent: "blue",
    fields: [
      { key: "ARIA_SEARCH_PROVIDER", label: "Search Provider", type: "select", options: ["zai", "apollo", "hunter", "snov", "clearbit", "zoominfo"], default: "zai", help: "v61.4: Only 'zai' is wired (Z-AI web_search). Apollo/Hunter/Snov/Clearbit/ZoomInfo keys are collected but NOT YET READ by any code — STUB." },
      { key: "APOLLO_API_KEY", label: "Apollo API Key (STUB — not yet wired)", type: "password", help: "⚠️ STUB: collected but no code reads this. 10 free credits/mo — https://app.apollo.io" },
      { key: "HUNTER_API_KEY", label: "Hunter API Key (STUB — not yet wired)", type: "password", help: "⚠️ STUB: collected but no code reads this. 50 free searches/mo — https://hunter.io" },
      { key: "SNOV_API_KEY", label: "Snov API Key (STUB — not yet wired)", type: "password", help: "⚠️ STUB: collected but no code reads this. 50 free credits/mo — https://app.snov.io" },
      { key: "CLEARBIT_API_KEY", label: "Clearbit API Key (STUB — not yet wired)", type: "password", help: "⚠️ STUB: collected but no code reads this. Paid — https://clearbit.com" },
      { key: "ZOOMINFO_API_KEY", label: "ZoomInfo API Key (STUB — not yet wired)", type: "password", help: "⚠️ STUB: collected but no code reads this. Paid enterprise" },
      { key: "ARIA_OUTREACH_DAILY_LIMIT", label: "Daily Outreach Limit", type: "number", default: "10", help: "Warmup protection. Day 1-7: 10. Day 8-14: 20. Day 15+: 50." },
    ],
  },
  {
    id: "payments",
    name: "Payment Methods",
    description: "Accept payments via crypto, UPI, card, PayPal, Razorpay, or bank transfer.",
    icon: DollarSign,
    accent: "emerald",
    fields: [
      { key: "CRYPTO_WALLET_ADDRESS", label: "Crypto Wallet Address", placeholder: "bc1q... (BTC) or 0x... (ETH)", help: "METHOD 1: BTC/ETH/SOL/USDT/USDC — $0 fees, works out of the box" },
      { key: "CRYPTO_NETWORK", label: "Default Network", type: "select", options: ["BTC", "ETH", "SOL", "USDT", "USDC"], default: "BTC" },
      { key: "ETHERSCAN_API_KEY", label: "Etherscan API Key", type: "password", help: "FREE — https://etherscan.io/register (for ETH/USDT/USDC verification)" },
      { key: "ARIA_UPI_VPA", label: "UPI VPA", placeholder: "owner@bankname", help: "METHOD 2: India UPI — instant settlement, $0 fees" },
      { key: "ARIA_UPI_PAYEE_NAME", label: "UPI Payee Name", placeholder: "Your Name/Business" },
      { key: "STRIPE_SECRET_KEY", label: "Stripe Secret Key", type: "password", placeholder: "sk_...", help: "METHOD 3: Card payments — https://dashboard.stripe.com" },
      { key: "STRIPE_PUBLISHABLE_KEY", label: "Stripe Publishable Key", placeholder: "pk_..." },
      { key: "STRIPE_WEBHOOK_SECRET", label: "Stripe Webhook Secret", type: "password", placeholder: "whsec_..." },
      { key: "PAYPAL_CLIENT_ID", label: "PayPal Client ID", help: "METHOD 4: PayPal — https://developer.paypal.com" },
      { key: "PAYPAL_CLIENT_SECRET", label: "PayPal Client Secret", type: "password" },
      { key: "PAYPAL_WEBHOOK_ID", label: "PayPal Webhook ID" },
      { key: "PAYPAL_MODE", label: "PayPal Mode", type: "select", options: ["sandbox", "live"], default: "sandbox" },
      { key: "RAZORPAY_KEY_ID", label: "Razorpay Key ID", help: "METHOD 5: India cards/UPI — https://razorpay.com" },
      { key: "RAZORPAY_KEY_SECRET", label: "Razorpay Key Secret", type: "password" },
      { key: "RAZORPAY_WEBHOOK_SECRET", label: "Razorpay Webhook Secret", type: "password" },
      { key: "ARIA_BANK_NAME", label: "Bank Name", help: "METHOD 6: Manual bank transfer" },
      { key: "ARIA_BANK_ACCOUNT_NAME", label: "Account Holder Name" },
      { key: "ARIA_BANK_ACCOUNT_NUMBER", label: "Account Number" },
      { key: "ARIA_BANK_IFSC", label: "IFSC Code (India)" },
      { key: "ARIA_BANK_SWIFT", label: "SWIFT/BIC (international)" },
    ],
  },
  {
    id: "email",
    name: "Email (Resend)",
    description: "Outbound email for outreach + customer notifications. Free 3,000/mo at https://resend.com.",
    icon: Mail,
    accent: "amber",
    fields: [
      { key: "RESEND_API_KEY", label: "Resend API Key", type: "password", placeholder: "re_..." },
      { key: "RESEND_FROM_EMAIL", label: "From Email", type: "email", placeholder: "founder@yourdomain.com", help: "Must be a verified sender domain" },
      { key: "RESEND_WEBHOOK_SECRET", label: "Webhook Secret", type: "password", help: "For inbound reply signature verification" },
      { key: "ARIA_SENDER_ADDRESS", label: "Physical Address (CAN-SPAM)", placeholder: "123 Main St, City, State ZIP, Country", help: "REQUIRED by CAN-SPAM if outreach enabled" },
      { key: "BOOKING_URL", label: "Booking URL", type: "url", placeholder: "https://cal.com/..." },
    ],
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    description: "WhatsApp Business Cloud API for outbound messages + inbound customer support.",
    icon: MessageSquare,
    accent: "green",
    fields: [
      { key: "WHATSAPP_TOKEN", label: "Access Token", type: "password", help: "From https://developers.facebook.com/apps/" },
      { key: "WHATSAPP_PHONE_NUMBER_ID", label: "Phone Number ID" },
      { key: "WHATSAPP_APP_SECRET", label: "App Secret", type: "password", help: "For webhook signature verification" },
      { key: "WHATSAPP_VERIFY_TOKEN", label: "Verify Token", help: "Any random string you choose" },
    ],
  },
  {
    id: "telegram",
    name: "Telegram Bot",
    description: "Send alerts to a Telegram chat. Create a bot via @BotFather on Telegram.",
    icon: Send,
    accent: "sky",
    fields: [
      { key: "TELEGRAM_BOT_TOKEN", label: "Bot Token", type: "password", placeholder: "123456:ABC-DEF..." },
      { key: "TELEGRAM_CHAT_ID", label: "Chat ID", placeholder: "-100..." },
    ],
  },
  {
    id: "push",
    name: "Web Push (VAPID)",
    description: "Browser push notifications for customers. Generate keys with: npx web-push generate-vapid-keys",
    icon: Zap,
    accent: "indigo",
    fields: [
      { key: "VAPID_PUBLIC_KEY", label: "Public Key" },
      { key: "VAPID_PRIVATE_KEY", label: "Private Key", type: "password" },
      { key: "VAPID_SUBJECT", label: "Subject (mailto:)", type: "email", placeholder: "mailto:owner@yourdomain.com" },
    ],
  },
  {
    id: "safety",
    name: "Safety Kill-Switches",
    description: "Toggle dangerous capabilities. ALL should be 'false' in production unless needed.",
    icon: Shield,
    accent: "red",
    fields: [
      { key: "JARVIS_AUTH_MODE", label: "Auth Mode", type: "select", options: ["single-operator", "multi-tenant"], default: "single-operator" },
      { key: "JARVIS_DEV_BYPASS_AUTH", label: "Dev Bypass Auth", type: "select", options: ["0", "1"], default: "0", help: "MUST be 0 in production" },
      { key: "ALLOW_CODE_EXEC", label: "Allow Code Execution", type: "select", options: ["false", "true"], default: "false" },
      { key: "ALLOW_TERMINAL_EXEC", label: "Allow Terminal Exec", type: "select", options: ["false", "true"], default: "false" },
      { key: "UI_HEALER_AUTO_APPROVE", label: "UI Healer Auto-Approve", type: "select", options: ["false", "true"], default: "false" },
      { key: "RATE_LIMIT_DISABLED", label: "Disable Rate Limit", type: "select", options: ["false", "true"], default: "false" },
      // v61 Phase 1: FREE_ONLY_MODE — when ON, router skips Z-AI/Groq/NVIDIA; only Ollama + browser-scraper
      { key: "FREE_ONLY_MODE", label: "🆓 FREE-ONLY MODE (Ollama only, $0 spend)", type: "select", options: ["true", "false"], default: "true", help: "When ON, the LLM router completely skips paid/freemium providers (Z-AI, Groq, NVIDIA). Only local Ollama + browser-scraper remain. Requires `ollama serve` running locally." },
      // v61 Phase 1: ARIA_SIMULATION_MODE — when OFF (default), no fabricated revenue/deals/messages
      { key: "ARIA_SIMULATION_MODE", label: "🎭 Simulation Mode (fake revenue/deals)", type: "select", options: ["false", "true"], default: "false", help: "When ON, the engine tick loop fabricates RevenueEvents/Deals/Messages every 15s (demo theater). When OFF (default), only real work (crons, API routes) produces data." },
      // v61 Phase 2: Oracle Free Tier Mode — lightweight models + memory-conservative routing
      { key: "DEPLOYMENT_ENV", label: "☁️ Oracle Free Tier Mode (lightweight models, RAM-safe)", type: "select", options: ["oracle-free-tier", "default"], default: "oracle-free-tier", help: "When 'oracle-free-tier', the router forces lightweight Ollama models (llama3.2:3b / qwen2.5-coder:1.5b) to avoid OOM on 24GB RAM instances, prioritizes no-login browser-scraper, and pushes throttled APIs (Groq/NVIDIA) to the end of the failover chain." },
      // v61 Phase 2: Business Hours — owner timezone for the 9 AM - 6 PM guard
      { key: "OWNER_TIMEZONE", label: "🕐 Owner Timezone (business hours 9 AM - 6 PM)", type: "select", options: ["Asia/Kolkata", "America/New_York", "America/Los_Angeles", "Europe/London", "UTC"], default: "Asia/Kolkata", help: "Outreach + lead-finder crons defer to 9 AM - 6 PM in this timezone. Critical alerts bypass." },
      { key: "NODE_ENV", label: "Node Environment", type: "select", options: ["development", "production"], default: "development" },
      { key: "ARIA_LOG_LEVEL", label: "Log Level", type: "select", options: ["trace", "debug", "info", "warn", "error"], default: "info" },
      { key: "ENCRYPTION_MASTER_KEY", label: "Encryption Master Key", type: "password", placeholder: "openssl rand -hex 32", help: "AES-256-GCM for Credential Vault" },
    ],
  },
];

const ALL_KEYS = SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

// Add any other keys that the /api/settings/env route allows (server env, owner email etc.)
const EXTRA_KEYS = [
  "DATABASE_URL", "NEXTAUTH_SECRET", "NEXTAUTH_URL", "ARIA_OWNER_EMAIL",
  "ARIA_TAX_RATE", "ARIA_REALTIME_KEY", "ZAI_TTS_ENABLED", "JARVIS_MULTI_TENANT",
  "ARIA_LLM_RPM_ZAI", "ARIA_LLM_RPM_GROQ", "ARIA_LLM_RPM_NVIDIA", "ARIA_LLM_RPM_OLLAMA",
  "ARIA_LLM_RPM_OPENAI", "ARIA_LLM_RPM_ANTHROPIC", "ARIA_LLM_RPM_GEMINI",
  "ARIA_BROWSER_SCRAPER_ENABLED", "ARIA_BROWSER_SCRAPER_URL", "ARIA_VISION_MODEL",
];

const SENSITIVE_PATTERNS = /(SECRET|KEY|TOKEN|PASS|PASSWORD)/i;

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<Section>("llm");
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [flagsLoading, setFlagsLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/env");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        const initial: Record<string, string> = {};
        for (const sec of SECTIONS) {
          for (const f of sec.fields) {
            const s = data.keys?.[f.key];
            if (s?.configured && s.masked && !SENSITIVE_PATTERNS.test(f.key)) {
              initial[f.key] = s.masked;
            } else if (f.default) {
              initial[f.key] = f.default;
            }
          }
        }
        setValues(initial);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const fetchFlags = useCallback(async () => {
    setFlagsLoading(true);
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        setFlags(data.flags ?? {});
      }
    } catch {
      // ignore
    } finally {
      setFlagsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchFlags();
  }, [fetchStatus, fetchFlags]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const keys: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v.trim()) keys[k] = v.trim();
      }
      const res = await fetch("/api/settings/env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "save failed");
      } else {
        setSuccess(`Saved ${data.updated.length} key(s). Hot-reloaded into process.env.`);
        fetchStatus();
        fetchFlags();
        setValues({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function toggleVisible(key: string) {
    const next = new Set(visibleKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setVisibleKeys(next);
  }

  if (!status) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
      </div>
    );
  }

  const activeSecDef = SECTIONS.find((s) => s.id === activeSection)!;
  const AccentIcon = activeSecDef.icon;

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Settings & Configuration</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Edit API keys, payment methods, telephony, and more — changes are hot-reloaded (no restart needed).
            </p>
          </div>
          <button
            onClick={() => { fetchStatus(); fetchFlags(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-zinc-200 bg-muted rounded-md transition-colors"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> {success}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar */}
          <aside className="lg:col-span-1">
            <nav className="space-y-1">
              {SECTIONS.map((sec) => {
                const Icon = sec.icon;
                const active = activeSection === sec.id;
                const allConfigured = sec.fields.every((f) => status.keys?.[f.key]?.configured);
                const someConfigured = sec.fields.some((f) => status.keys?.[f.key]?.configured);
                return (
                  <button
                    key={sec.id}
                    onClick={() => setActiveSection(sec.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors ${
                      active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                    }`}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span className="flex-1 truncate">{sec.name}</span>
                    {allConfigured && sec.fields.length > 0 && (
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    )}
                    {!allConfigured && someConfigured && (
                      <div className="h-2 w-2 rounded-full bg-amber-400" />
                    )}
                    {!someConfigured && (
                      <div className="h-2 w-2 rounded-full bg-zinc-700" />
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="mt-6 p-3 rounded-md border border-zinc-800 bg-zinc-900/60">
              <h3 className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
                <Power className="h-3 w-3" /> Live Status
              </h3>
              <div className="space-y-1 text-[11px] text-zinc-500">
                <div>Telephony: {flags.AI_CALLER_ENABLED ? "✅ ON" : "⛔ OFF"}</div>
                <div>Consent: {flags.AI_CALLER_CONSENT_VERIFIED ? "✅ Verified" : "⛔ Not verified"}</div>
                <div>Code Exec: {flags.ALLOW_CODE_EXEC ? "⚠️ ON" : "✅ Off"}</div>
                <div>Rate Limit: {flags.RATE_LIMIT_DISABLED ? "⚠️ Off" : "✅ On"}</div>
              </div>
            </div>
          </aside>

          {/* Main content */}
          <form onSubmit={handleSave} className="lg:col-span-3 space-y-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <h2 className="text-base font-semibold flex items-center gap-2">
                    <AccentIcon className="h-4 w-4 text-violet-400" />
                    {activeSecDef.name}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1">{activeSecDef.description}</p>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                {activeSecDef.fields.map((f) => {
                  const s = status.keys?.[f.key];
                  const isSensitive = f.type === "password" || SENSITIVE_PATTERNS.test(f.key);
                  const visible = visibleKeys.has(f.key);
                  return (
                    <div key={f.key}>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                        {f.label ?? f.key}
                        {s?.configured && (
                          <CheckCircle2 className="inline h-3 w-3 ml-1.5 text-emerald-400" />
                        )}
                      </label>
                      <div className="flex gap-2">
                        {f.type === "select" ? (
                          <select
                            value={values[f.key] ?? ""}
                            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                            className="flex-1 rounded-md bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
                          >
                            {f.options?.map((o) => (
                              <option key={o} value={o}>{o || "(empty)"}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={isSensitive && !visible ? "password" : (f.type === "url" ? "url" : f.type === "number" ? "number" : f.type === "email" ? "email" : "text")}
                            value={values[f.key] ?? ""}
                            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                            placeholder={f.placeholder ?? f.default ?? ""}
                            className="flex-1 rounded-md bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm font-mono focus:border-violet-500 focus:outline-none"
                          />
                        )}
                        {isSensitive && (
                          <button
                            type="button"
                            onClick={() => toggleVisible(f.key)}
                            className="px-2 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
                          >
                            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                      {f.help && <p className="mt-1 text-[11px] text-zinc-600">{f.help}</p>}
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 flex items-center gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Changes
                </button>
                <span className="text-[11px] text-zinc-600">
                  Only filled-in fields are written. Hot-reloaded instantly — no restart needed.
                </span>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
