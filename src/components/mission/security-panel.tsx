"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Shield,
  ShieldCheck,
  QrCode,
  Copy,
  Check,
  Loader2,
  AlertTriangle,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ─── Types ───────────────────────────────────────────────────────────
interface TwoFactorStatus {
  authenticated?: boolean;
  hasSecret?: boolean;
  enabled?: boolean;
  userExists?: boolean;
  requiresTwoFactor?: boolean;
}

interface TwoFactorSetupResponse {
  secret: string;
  qrUri: string;
  backupCodes: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────
async function jsonOrThrow(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `request failed (${res.status})`);
  }
  return data;
}

// ─── SecurityPanel ───────────────────────────────────────────────────
export function SecurityPanel() {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const [showSetup, setShowSetup] = useState(false);
  const [setupData, setSetupData] = useState<TwoFactorSetupResponse | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [verifyToken, setVerifyToken] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);

  const [disableOpen, setDisableOpen] = useState(false);
  const [disableToken, setDisableToken] = useState("");
  const [disabling, setDisabling] = useState(false);

  // ─── Fetch status ───
  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const data = await jsonOrThrow(await fetch("/api/2fa/status"));
      setStatus(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "failed to load 2FA status");
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // ─── Enable (start setup) ───
  const handleEnable = useCallback(async () => {
    setSetupLoading(true);
    setVerifyToken("");
    try {
      const data = await jsonOrThrow(
        await fetch("/api/2fa/setup", { method: "POST" }),
      );
      setSetupData(data);
      setShowSetup(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "failed to start 2FA setup");
    } finally {
      setSetupLoading(false);
    }
  }, []);

  // ─── Verify & enable ───
  const handleVerify = useCallback(async () => {
    const token = verifyToken.trim();
    if (token.length !== 6 || !/^\d+$/.test(token)) {
      toast.error("Enter the 6-digit code from your authenticator");
      return;
    }
    setVerifying(true);
    try {
      await jsonOrThrow(
        await fetch("/api/2fa/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        }),
      );
      toast.success("2FA enabled — your account is now protected");
      setShowSetup(false);
      setSetupData(null);
      setVerifyToken("");
      await refreshStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "verification failed");
    } finally {
      setVerifying(false);
    }
  }, [verifyToken, refreshStatus]);

  // ─── Disable ───
  const handleDisable = useCallback(async () => {
    const token = disableToken.trim();
    if (!token) {
      toast.error("Enter your current TOTP code or a backup code");
      return;
    }
    setDisabling(true);
    try {
      await jsonOrThrow(
        await fetch("/api/2fa/disable", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        }),
      );
      toast.success("2FA disabled");
      setDisableOpen(false);
      setDisableToken("");
      await refreshStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "failed to disable 2FA");
    } finally {
      setDisabling(false);
    }
  }, [disableToken, refreshStatus]);

  // ─── Copy secret ───
  const copySecret = useCallback(async () => {
    if (!setupData?.secret) return;
    try {
      await navigator.clipboard.writeText(setupData.secret);
      setSecretCopied(true);
      toast.success("Secret copied to clipboard");
      setTimeout(() => setSecretCopied(false), 1800);
    } catch {
      toast.error("Clipboard not available — copy manually");
    }
  }, [setupData]);

  const enabled = Boolean(status?.enabled);

  // ─── Render ───
  return (
    <div className="space-y-4">
      {/* ─── Section A — 2FA Status ─── */}
      <Card className="aria-feature-card">
        <CardHeader className="flex flex-row items-start gap-3 space-y-0">
          <div className="mt-0.5 flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300">
            {enabled ? <ShieldCheck className="size-5" /> : <Shield className="size-5" />}
          </div>
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2 text-base">
              Two-Factor Authentication
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              Add a second layer of protection using an authenticator app (TOTP).
            </CardDescription>
          </div>
          {enabled ? (
            <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
              <span className="aria-live-dot mr-1.5 inline-block size-1.5 rounded-full bg-emerald-400" />
              2FA Enabled
            </Badge>
          ) : statusLoading ? null : (
            <Badge variant="outline" className="border-amber-500/30 text-amber-300">
              Not enabled
            </Badge>
          )}
        </CardHeader>

        <CardContent>
          {statusLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading status…
            </div>
          ) : enabled ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Your account requires a TOTP code at sign-in. Keep your backup codes safe.
              </p>
              <Button
                variant="outline"
                onClick={() => setDisableOpen(true)}
                className="border-rose-500/40 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
              >
                Disable 2FA
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Two-factor authentication is not enabled. We strongly recommend turning it on.
              </p>
              <Button
                onClick={handleEnable}
                disabled={setupLoading}
                className="aria-btn-gradient"
              >
                {setupLoading ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Shield className="mr-2 size-4" />
                )}
                Enable 2FA
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Section B — 2FA Setup ─── */}
      <AnimatePresence initial={false}>
        {showSetup && setupData && (
          <motion.div
            key="setup"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <Card className="aria-feature-card aria-glow-emerald">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <QrCode className="size-4 text-emerald-300" />
                  Set up authenticator
                </CardTitle>
                <CardDescription className="text-xs">
                  Scan the QR with Google Authenticator, Authy, or 1Password.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-5">
                {/* QR + secret */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <div className="rounded-lg border border-emerald-500/20 bg-white p-2">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                        setupData.qrUri,
                      )}`}
                      alt="2FA QR code"
                      width={200}
                      height={200}
                      className="size-[200px] rounded"
                    />
                  </div>

                  <div className="flex-1 space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Manual key
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate rounded-md border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-emerald-200">
                        {setupData.secret}
                      </code>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={copySecret}
                        aria-label="Copy secret"
                        className="size-9 shrink-0"
                      >
                        {secretCopied ? (
                          <Check className="size-4 text-emerald-300" />
                        ) : (
                          <Copy className="size-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Use this if you can&apos;t scan the QR code.
                    </p>
                  </div>
                </div>

                {/* Backup codes */}
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
                  <div className="mb-2 flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />
                    <p className="text-xs font-medium text-amber-200">
                      Save these backup codes — they can be used once each if you lose your
                      authenticator.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {setupData.backupCodes.map((code) => (
                      <code
                        key={code}
                        className="rounded border border-amber-500/20 bg-black/40 px-2 py-1.5 text-center font-mono text-xs text-amber-100"
                      >
                        {code}
                      </code>
                    ))}
                  </div>
                </div>

                {/* Verify input */}
                <div className="space-y-2">
                  <label htmlFor="2fa-verify" className="text-xs font-medium text-muted-foreground">
                    Enter the 6-digit code from your authenticator
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="2fa-verify"
                      value={verifyToken}
                      onChange={(e) =>
                        setVerifyToken(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      maxLength={6}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      className="font-mono text-lg tracking-[0.4em]"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleVerify();
                      }}
                    />
                    <Button
                      onClick={handleVerify}
                      disabled={verifying || verifyToken.length !== 6}
                      className="aria-btn-gradient sm:w-auto"
                    >
                      {verifying ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="mr-2 size-4" />
                      )}
                      Verify &amp; Enable
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Section C — Active Sessions placeholder ─── */}
      <Card className="aria-feature-card">
        <CardHeader>
          <CardTitle className="text-base">Active Sessions</CardTitle>
          <CardDescription className="text-xs">
            Manage devices currently signed into your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-4 text-sm text-muted-foreground">
            <Shield className="size-4 shrink-0 text-emerald-300/70" />
            Session management coming in v42.
          </div>
        </CardContent>
      </Card>

      {/* ─── Disable 2FA confirmation ─── */}
      <AlertDialog open={disableOpen} onOpenChange={setDisableOpen}>
        <AlertDialogContent className="aria-glass">
          <AlertDialogHeader>
            <AlertDialogTitle>Disable 2FA?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove two-factor protection from your account. Enter your current TOTP
              code or a backup code to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={disableToken}
            onChange={(e) => setDisableToken(e.target.value)}
            placeholder="123456 or backup code"
            className="font-mono"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={disabling}
              onClick={() => setDisableToken("")}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={disabling || !disableToken.trim()}
              onClick={(e) => {
                e.preventDefault();
                void handleDisable();
              }}
              className="bg-rose-600 text-white hover:bg-rose-500"
            >
              {disabling ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <AlertTriangle className="mr-2 size-4" />
              )}
              Disable 2FA
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default SecurityPanel;
