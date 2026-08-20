"use client";

import { useState, useCallback } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Radio, Lock, Mail, User, ArrowRight, AlertCircle, Loader2, CheckCircle2 } from "lucide-react";

/**
 * SignupPage — production signup with real user creation.
 *
 * POSTs to /api/auth/signup to create a user (bcrypt-hashed password),
 * then immediately calls signIn("credentials") to log them in.
 * Redirects to / on success.
 */
export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.trim() || !password.trim()) return;
      if (password.length < 8) {
        setError("Password must be at least 8 characters");
        return;
      }
      setLoading(true);
      setError(null);

      try {
        // Step 1: Create the user.
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            password,
            name: name.trim() || undefined,
          }),
        });

        const data = (await res.json()) as { ok?: boolean; error?: string };

        if (!data.ok) {
          setError(data.error ?? "Signup failed");
          setLoading(false);
          return;
        }

        // Step 2: Auto-login.
        const result = await signIn("credentials", {
          email: email.trim().toLowerCase(),
          password,
          redirect: false,
        });

        if (result?.ok) {
          router.push("/");
          router.refresh();
        } else {
          // Account created but login failed — redirect to login.
          router.push("/login");
        }
      } catch {
        setError("Network error — please try again");
        setLoading(false);
      }
    },
    [name, email, password, router]
  );

  return (
    <div className="mc-grid-bg flex min-h-screen items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="mc-surface-elevated w-full max-w-sm overflow-hidden"
      >
        {/* Header */}
        <div className="relative border-b border-border/60 px-6 py-5">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px mc-sweep-line opacity-60" />
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center border border-emerald-500/40 bg-emerald-500/10" style={{ borderRadius: 0 }}>
              <Radio className="h-5 w-5 text-emerald-300" />
            </div>
            <div>
              <h1 className="font-mono text-base font-bold uppercase tracking-[0.15em] text-foreground">
                Create Account
              </h1>
              <div className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.32em] text-muted-foreground">
                <span className="text-muted-foreground/50">{"//"}</span>
                <span className="uppercase">Join the Fleet</span>
              </div>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="flex items-center gap-2 border border-rose-500/30 bg-rose-500/5 px-3 py-2"
              style={{ borderRadius: 0 }}
            >
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-300" />
              <span className="font-mono text-xs text-rose-300">{error}</span>
            </motion.div>
          )}

          {/* Name */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <User className="h-3 w-3" /> Name <span className="text-muted-foreground/50">(optional)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full border border-border/60 bg-background/60 px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              style={{ borderRadius: 0 }}
            />
          </div>

          {/* Email */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <Mail className="h-3 w-3" /> Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              required
              className="w-full border border-border/60 bg-background/60 px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              style={{ borderRadius: 0 }}
            />
          </div>

          {/* Password */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <Lock className="h-3 w-3" /> Password <span className="text-muted-foreground/50">(min 8 chars)</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              required
              minLength={8}
              className="w-full border border-border/60 bg-background/60 px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              style={{ borderRadius: 0 }}
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !email.trim() || !password.trim()}
            className="flex w-full items-center justify-center gap-2 border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-40"
            style={{ borderRadius: 0 }}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Creating account…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" /> Create Account
              </>
            )}
          </button>

          {/* Login link */}
          <div className="pt-2 text-center">
            <span className="font-mono text-[11px] text-muted-foreground">
              Already have an account?{" "}
              <a href="/login" className="text-primary transition-colors hover:text-primary/80">
                Sign in →
              </a>
            </span>
          </div>
        </form>

        {/* Footer */}
        <div className="border-t border-border/60 px-6 py-3">
          <div className="flex items-center justify-between font-mono text-[9px] text-muted-foreground/50">
            <span>v25.9.7-final</span>
            <span className="flex items-center gap-1">
              <span className="mc-led mc-led-blink" style={{ background: "oklch(0.75 0.16 150)" }} />
              system online
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
