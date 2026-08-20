"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMissionStore } from "@/stores/mission-store";
import {
  Building2,
  Tag,
  Globe,
  Mail,
  DollarSign,
  Clock,
  ArrowRight,
  ArrowLeft,
  Check,
  Loader2,
  Sparkles,
} from "lucide-react";

const INDUSTRIES = [
  "Technology / SaaS",
  "E-commerce / Retail",
  "Finance / FinTech",
  "Healthcare / Biotech",
  "Education / EdTech",
  "Media / Entertainment",
  "Manufacturing",
  "Real Estate",
  "Consulting",
  "Marketing / Agency",
  "Logistics / Supply Chain",
  "Other",
];

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "JPY", "CNY", "AUD", "CAD"];
const TIMEZONES = ["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"];

/**
 * OnboardingGate — multi-step company onboarding wizard.
 *
 * Blocks the dashboard until at least one company is created.
 * On completion, the app starts the simulation engine + cron scheduler.
 *
 * Steps:
 *   1. Company name + tagline
 *   2. Industry + website + email
 *   3. Currency + timezone
 *   4. Review + launch
 */
export function OnboardingGate({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [industry, setIndustry] = useState(INDUSTRIES[0]);
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [timezone, setTimezone] = useState("UTC");

  const totalSteps = 4;

  const canProceed = useCallback(() => {
    if (step === 0) return name.trim().length >= 2;
    if (step === 1) return industry.length > 0;
    if (step === 2) return currency.length > 0 && timezone.length > 0;
    return true;
  }, [step, name, industry, currency, timezone]);

  const handleBack = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          tagline: tagline.trim() || null,
          industry: industry || null,
          website: website.trim() || null,
          email: email.trim() || null,
          currency,
          timezone,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Switch to this company + signal completion
      const data = await res.json();
      if (data.company?.id) {
        await fetch(`/api/companies/${data.company.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ switch: true }),
        }).catch(() => {});
      }
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create company");
    } finally {
      setSubmitting(false);
    }
  }, [name, tagline, industry, website, email, currency, timezone, onComplete]);

  const handleNext = useCallback(() => {
    if (step < totalSteps - 1) {
      setStep((s) => s + 1);
    } else {
      // Final step — submit
      void handleSubmit();
    }
  }, [step, handleSubmit]);

  return (
    <div className="mc-grid-bg flex min-h-screen items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-lg overflow-hidden rounded-lg border border-violet-500/30 bg-[#0a0a0f]/95 shadow-2xl shadow-violet-500/10"
      >
        {/* Header with gradient */}
        <div className="relative overflow-hidden border-b border-violet-500/20 px-6 py-5">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-400 to-transparent" />
          <div className="flex items-center gap-3">
            <motion.div
              animate={{ boxShadow: ["0 0 20px rgba(139,92,246,0.4)", "0 0 40px rgba(139,92,246,0.7)", "0 0 20px rgba(139,92,246,0.4)"] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="flex h-11 w-11 items-center justify-center rounded-lg border border-violet-500/40 bg-violet-500/10"
            >
              <Sparkles className="h-5 w-5 text-violet-300" />
            </motion.div>
            <div>
              <h1 className="font-mono text-sm font-bold uppercase tracking-[0.15em] text-foreground">
                Welcome to ARIA
              </h1>
              <p className="font-mono text-[10px] tracking-[0.2em] text-violet-300/70">
                {"//"} COMPANY ONBOARDING · STEP {step + 1} OF {totalSteps}
              </p>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-4 flex gap-1.5">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`h-0.5 flex-1 rounded-full transition-colors duration-300 ${
                  i <= step ? "bg-violet-400" : "bg-zinc-700/50"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="min-h-[320px] px-6 py-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
              className="space-y-4"
            >
              {step === 0 && (
                <>
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                      <Building2 className="h-3 w-3 text-violet-400" /> Company Name *
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Acme Corporation"
                      autoFocus
                      className="w-full rounded-md border border-zinc-700/50 bg-zinc-900/60 px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                    />
                  </div>
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                      <Tag className="h-3 w-3 text-violet-400" /> Tagline <span className="text-zinc-600">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={tagline}
                      onChange={(e) => setTagline(e.target.value)}
                      placeholder="e.g. Building the future of automation"
                      className="w-full rounded-md border border-zinc-700/50 bg-zinc-900/60 px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                    />
                  </div>
                  <p className="rounded-md border border-violet-500/20 bg-violet-500/5 px-3 py-2 font-mono text-[10px] text-violet-300/70">
                    ARIA will use this identity to personalize agent behavior, memories, and skills for your company.
                  </p>
                </>
              )}

              {step === 1 && (
                <>
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                      <Building2 className="h-3 w-3 text-violet-400" /> Industry
                    </label>
                    <select
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                      className="w-full rounded-md border border-zinc-700/50 bg-zinc-900/60 px-3 py-2.5 font-mono text-sm text-foreground focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                    >
                      {INDUSTRIES.map((ind) => (
                        <option key={ind} value={ind}>{ind}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                      <Globe className="h-3 w-3 text-violet-400" /> Website <span className="text-zinc-600">(optional)</span>
                    </label>
                    <input
                      type="url"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="https://acme.com"
                      className="w-full rounded-md border border-zinc-700/50 bg-zinc-900/60 px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                    />
                  </div>
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                      <Mail className="h-3 w-3 text-violet-400" /> Contact Email <span className="text-zinc-600">(optional)</span>
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="ops@acme.com"
                      className="w-full rounded-md border border-zinc-700/50 bg-zinc-900/60 px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                    />
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                      <DollarSign className="h-3 w-3 text-violet-400" /> Currency
                    </label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full rounded-md border border-zinc-700/50 bg-zinc-900/60 px-3 py-2.5 font-mono text-sm text-foreground focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                      <Clock className="h-3 w-3 text-violet-400" /> Timezone
                    </label>
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full rounded-md border border-zinc-700/50 bg-zinc-900/60 px-3 py-2.5 font-mono text-sm text-foreground focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                    >
                      {TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </select>
                  </div>
                  <p className="rounded-md border border-violet-500/20 bg-violet-500/5 px-3 py-2 font-mono text-[10px] text-violet-300/70">
                    Cron jobs (learning, earning research, nightly reflection) will fire in this timezone.
                  </p>
                </>
              )}

              {step === 3 && (
                <div className="space-y-3">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-violet-300/70">{"//"} REVIEW &amp; LAUNCH</p>
                  <div className="rounded-md border border-zinc-700/50 bg-zinc-900/40 divide-y divide-zinc-800/50">
                    <ReviewRow label="Company" value={name} icon={Building2} />
                    {tagline && <ReviewRow label="Tagline" value={tagline} icon={Tag} />}
                    <ReviewRow label="Industry" value={industry} icon={Building2} />
                    {website && <ReviewRow label="Website" value={website} icon={Globe} />}
                    {email && <ReviewRow label="Email" value={email} icon={Mail} />}
                    <ReviewRow label="Currency" value={currency} icon={DollarSign} />
                    <ReviewRow label="Timezone" value={timezone} icon={Clock} />
                  </div>
                  <p className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 font-mono text-[10px] text-emerald-300/70">
                    ✓ On completion, ARIA will activate 37 agents, 10 cron jobs, and the full mission control dashboard.
                  </p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {error && (
            <div className="mt-4 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 font-mono text-[10px] text-rose-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer with navigation */}
        <div className="flex items-center justify-between border-t border-violet-500/20 px-6 py-4">
          <button
            onClick={handleBack}
            disabled={step === 0 || submitting}
            className="flex items-center gap-1.5 rounded-md border border-zinc-700/50 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400 transition-colors hover:border-zinc-600 hover:text-foreground disabled:opacity-30"
          >
            <ArrowLeft className="h-3 w-3" /> Back
          </button>
          <button
            onClick={handleNext}
            disabled={!canProceed() || submitting}
            className="flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-4 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-violet-300 transition-colors hover:bg-violet-500/20 disabled:opacity-30"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Launching...
              </>
            ) : step === totalSteps - 1 ? (
              <>
                <Check className="h-3 w-3" /> Launch ARIA
              </>
            ) : (
              <>
                Next <ArrowRight className="h-3 w-3" />
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function ReviewRow({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Building2 }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        <Icon className="h-3 w-3 text-violet-400/60" /> {label}
      </span>
      <span className="font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}
