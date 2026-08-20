"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  Radio,
  ArrowRight,
  Cpu,
  DollarSign,
  Brain,
  Shield,
  Zap,
  Activity,
  CheckCircle2,
  Terminal,
  Network,
  Sparkles,
  Users,
  TrendingUp,
  GitBranch,
  Lock,
  Layers,
  Github,
} from "lucide-react";

/**
 * LandingPage — public-facing marketing page for ARIA Mission Control.
 *
 * v39 redesign: synced with the Skills Studio aesthetic — Geist fonts,
 * emerald/teal/violet/amber palette, animated background glow orbs,
 * glassmorphism header, gradient hero text, rounded feature cards,
 * and a sticky footer. Same dark-first design language.
 *
 * Authenticated users see an "Enter Dashboard" CTA instead of "Get Started".
 */
export default function LandingPage() {
  const { data: session } = useSession();

  const features = [
    {
      icon: Cpu,
      title: "Autonomous Agent Fleet",
      description:
        "66 AI agents across 15 departments with Lead/Senior/Junior hierarchy — powered by real LLM completions with complexity-aware model selection and tier-based routing.",
      tone: "#34d399", // emerald
    },
    {
      icon: Brain,
      title: "Multi-Provider LLM Routing",
      description:
        "Z-AI → Groq → NVIDIA → Ollama failover with tier circuit breakers, automatic cooldowns (60s rate / 5min auth), and silent degradation. No mock mode — real completions or typed errors.",
      tone: "#a78bfa", // violet
    },
    {
      icon: DollarSign,
      title: "Revenue Engine + Cash-Claw",
      description:
        "6-stage revenue pipeline (FIND→QUALIFY→PLAN→EXECUTE→TRACK→OPTIMIZE) with Monte Carlo feasibility scoring. Cash-Claw classifies agents as thriving/surviving/dying/dead every 6h.",
      tone: "#34d399", // emerald
    },
    {
      icon: Network,
      title: "Live Agent Communication",
      description:
        "Real-time animated network graph where particles flow only along active agent-to-agent message edges. Click any agent to inspect messages sent, received, and connections.",
      tone: "#fbbf24", // amber
    },
    {
      icon: Shield,
      title: "Credential Vault + System Access",
      description:
        "AES-256-GCM encrypted credential storage, thermal-guarded system access with approval gates, and full audit trails on every autonomous action.",
      tone: "#f87171", // rose
    },
    {
      icon: Layers,
      title: "9-Tab Mission Dashboard",
      description:
        "Overview, Operations, Agents, Comms, Intelligence, Finance, System, Training, and Advanced tabs with 100+ panels — each with fullscreen expand and horizontal space-saving layouts.",
      tone: "#22d3ee", // cyan
    },
    {
      icon: GitBranch,
      title: "Multi-Model Debate + Failure Alchemy",
      description:
        "3-5 LLM models debate in parallel with confidence-weighted voting. Failure Alchemy synthesizes antibody/vaccine/catalyst artifacts from error logs every 30min.",
      tone: "#a78bfa", // violet
    },
    {
      icon: TrendingUp,
      title: "KPI Engine + Predictive Analytics",
      description:
        "6-hour KPI snapshots (revenue, tasks, agents, payments, leads, customers) with 7-day series and 24h delta tracking. 17 continuous cron jobs keep everything fresh.",
      tone: "#2dd4bf", // teal
    },
    {
      icon: Lock,
      title: "Enterprise Security + Multi-Tenant",
      description:
        "NextAuth v4 with bcrypt(12), JWT sessions, TOTP 2FA enforcement, rate limiting, multi-company support, and granular kill-switches for terminal exec, code exec, and AI calling.",
      tone: "#e879f9", // fuchsia
    },
  ];

  const stats = [
    { label: "AI Agents", value: "66", icon: Cpu },
    { label: "Departments", value: "15", icon: Activity },
    { label: "Dashboard Panels", value: "100+", icon: Zap },
    { label: "API Routes", value: "104", icon: Network },
    { label: "Cron Jobs", value: "17", icon: Users },
    { label: "LLM Providers", value: "5-tier", icon: DollarSign },
  ];

  return (
    <div className="relative min-h-screen flex flex-col bg-background">
      {/* ─── Animated background grid + glow orbs ─── */}
      <div className="pointer-events-none fixed inset-0 aria-grid-bg opacity-60" />
      <div
        className="aria-glow-orb aria-glow-orb-emerald aria-animate-pulse-glow"
        style={{ top: "-10%", left: "20%", width: "24rem", height: "24rem" }}
      />
      <div
        className="aria-glow-orb aria-glow-orb-violet aria-animate-pulse-glow"
        style={{ top: "30%", right: "20%", width: "20rem", height: "20rem", animationDelay: "1.5s" }}
      />
      <div
        className="aria-glow-orb aria-glow-orb-amber aria-animate-pulse-glow"
        style={{ bottom: "-10%", left: "35%", width: "18rem", height: "18rem", animationDelay: "3s" }}
      />

      {/* ─── Header (glass) ─── */}
      <header className="sticky top-0 z-50 border-b border-border/40 aria-glass">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 aria-glow-emerald">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight sm:text-xl">
                ARIA Mission Control
              </h1>
              <p className="hidden text-sm text-muted-foreground sm:block">
                Autonomous AI Operations · 66 agents · 5-tier LLM routing
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-1.5 aria-live-badge sm:flex">
              <div className="aria-live-dot" />
              <span className="text-sm font-medium text-emerald-300">Live</span>
            </div>
            <Link
              href="/playground"
              className="hidden rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              Playground
            </Link>
            <Link
              href="/services"
              className="hidden rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              Services
            </Link>
            {session ? (
              <Link
                href="/dashboard"
                className="aria-btn-gradient flex items-center gap-2 text-base"
              >
                <Terminal className="h-4 w-4" /> Dashboard
              </Link>
            ) : (
              <Link href="/signup" className="aria-btn-gradient flex items-center gap-2 text-base">
                Get Started <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ─── Hero ─── */}
      <section className="relative z-10 px-4 pt-16 pb-8 sm:px-6 sm:pt-24">
        <div className="mx-auto max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center"
          >
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/50 px-4 py-1.5 backdrop-blur">
              <Zap className="h-4 w-4 text-amber-400" />
              <span className="text-sm font-medium text-muted-foreground">
                Autonomous AI Company OS · v61 hardened
              </span>
            </div>
            <h2 className="mx-auto max-w-5xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl sm:leading-tight">
              Your AI Company{" "}
              <span className="aria-gradient-text">Runs Itself</span>
            </h2>
            <p className="mx-auto mt-6 max-w-3xl text-base text-muted-foreground sm:text-lg">
              66 AI agents across 15 departments reason, decide, and execute — generating
              revenue, managing pipelines, and operating your business 24/7. Powered by
              real multi-provider LLM completions with circuit-breaker failover, monitored
              by self-healing oversight agents.
            </p>
            <div className="mt-8 flex items-center justify-center gap-3">
              {session ? (
                <Link
                  href="/dashboard"
                  className="aria-btn-gradient flex items-center gap-2 text-base"
                >
                  <Terminal className="h-5 w-5" /> Enter Dashboard
                </Link>
              ) : (
                <Link
                  href="/signup"
                  className="aria-btn-gradient flex items-center gap-2 text-base"
                >
                  <Sparkles className="h-5 w-5" /> Start Free{" "}
                  <ArrowRight className="h-5 w-5" />
                </Link>
              )}
              <Link
                href="/login"
                className="rounded-lg border border-border/60 px-5 py-3 text-base font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Sign in
              </Link>
            </div>
          </motion.div>

          {/* Stats strip */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-12 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
          >
            {stats.map((stat, i) => {
              const Icon = stat.icon;
              return (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.05 }}
                  className="aria-stat-card group"
                >
                  <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-110">
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="text-2xl font-bold tabular-nums text-foreground">
                    {stat.value}
                  </div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    {stat.label}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section className="relative z-10 px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-8 text-center"
          >
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/50 px-4 py-1.5 backdrop-blur">
              <span className="text-sm font-medium text-muted-foreground">
                Capabilities
              </span>
            </div>
            <h3 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Everything You Need to Run Autonomously
            </h3>
          </motion.div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, i) => {
              const Icon = feature.icon;
              return (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.06 }}
                  className="aria-feature-card p-6"
                >
                  <div
                    className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg"
                    style={{
                      backgroundColor: `${feature.tone}15`,
                      color: feature.tone,
                    }}
                  >
                    <Icon className="h-6 w-6" />
                  </div>
                  <h4 className="mb-3 text-lg font-bold tracking-tight">
                    {feature.title}
                  </h4>
                  <p className="text-base leading-relaxed text-muted-foreground">
                    {feature.description}
                  </p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="relative z-10 px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
          >
            <div className="relative aria-feature-card mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 aria-glow-emerald">
              <motion.div
                className="pointer-events-none absolute inset-0 rounded-2xl"
                animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ duration: 2, repeat: Infinity }}
                style={{ boxShadow: "0 0 24px -4px rgba(52, 211, 153, 0.6)" }}
              />
              <Radio className="relative h-8 w-8 text-white" />
            </div>
            <h3 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Deploy Your AI Workforce
            </h3>
            <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
              Sign up in seconds. Your autonomous AI company starts operating immediately —
              reasoning, executing, and earning with real multi-provider LLM intelligence.
            </p>
            <div className="mt-8 flex items-center justify-center gap-3">
              <Link
                href="/signup"
                className="aria-btn-gradient flex items-center gap-2 text-base"
              >
                <CheckCircle2 className="h-5 w-5" /> Create Free Account
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Footer (sticky to bottom) ─── */}
      <footer className="relative z-10 mt-auto border-t border-border/40 aria-glass">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-4 text-center sm:flex-row sm:px-6 sm:text-left">
          <p className="text-sm text-muted-foreground">
            ARIA Mission Control · v61 · Next.js 16 · TypeScript · Tailwind CSS 4
          </p>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Shield className="h-3 w-3 text-emerald-400" />
              zero-patch policy
            </span>
            <span className="hidden sm:inline">·</span>
            <span className="flex items-center gap-1">
              <div className="aria-live-dot" />
              system online
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
