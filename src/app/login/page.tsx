"use client";

import { useState, useCallback, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Radio, Lock, Mail, ArrowRight, AlertCircle, Loader2 } from "lucide-react";

/**
 * LoginPage — production login with NextAuth credentials provider.
 *
 * Email + password form that calls signIn("credentials"). On success,
 * redirects to the callback URL (or /). On failure, shows an error.
 * Monolith aesthetic: sharp corners, mono font, square LED, grid texture.
 *
 * NOTE: `useSearchParams()` is wrapped in a <Suspense> boundary because
 * Next.js 16 requires it for any page that opts out of static rendering
 * (searchParams is only available at request time). Without the boundary,
 * `next build` fails with "useSearchParams() should be wrapped in a
 * suspense boundary".
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <div className="mc-grid-bg flex min-h-screen items-center justify-center p-4">
      <div className="mc-surface-elevated flex w-full max-w-sm items-center justify-center px-6 py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.trim() || !password.trim()) return;
      setLoading(true);
      setError(null);

      try {
        const result = await signIn("credentials", {
          email: email.trim().toLowerCase(),
          password,
          redirect: false,
        });

        if (result?.error) {
          setError("Invalid email or password");
          setLoading(false);
        } else if (result?.ok) {
          router.push(callbackUrl);
          router.refresh();
        } else {
          setError("Login failed — please try again");
          setLoading(false);
        }
      } catch {
        setError("Network error — please try again");
        setLoading(false);
      }
    },
    [email, password, router, callbackUrl]
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
            <div className="relative flex h-10 w-10 items-center justify-center border border-primary/40 bg-primary/10" style={{ borderRadius: 0 }}>
              <Radio className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="font-mono text-base font-bold uppercase tracking-[0.15em] text-foreground">
                ARIA<span className="text-primary">·</span>MISSION CONTROL
              </h1>
              <div className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.32em] text-muted-foreground">
                <span className="text-muted-foreground/50">{"//"}</span>
                <span className="uppercase">Secure Access</span>
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
              <Lock className="h-3 w-3" /> Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              className="w-full border border-border/60 bg-background/60 px-3 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              style={{ borderRadius: 0 }}
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !email.trim() || !password.trim()}
            className="flex w-full items-center justify-center gap-2 border border-primary/40 bg-primary/10 px-4 py-2.5 font-mono text-sm font-semibold uppercase tracking-wider text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
            style={{ borderRadius: 0 }}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Authenticating…
              </>
            ) : (
              <>
                <ArrowRight className="h-4 w-4" /> Enter Mission Control
              </>
            )}
          </button>

          {/* Signup link */}
          <div className="pt-2 text-center">
            <span className="font-mono text-[11px] text-muted-foreground">
              No account?{" "}
              <a href="/signup" className="text-primary transition-colors hover:text-primary/80">
                Create one →
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
