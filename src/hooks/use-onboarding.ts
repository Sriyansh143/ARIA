"use client";

import { useState, useEffect, useCallback } from "react";

interface CompanyInfo {
  id: string;
  name: string;
  tagline: string | null;
  industry: string | null;
  website: string | null;
  email: string | null;
  currency: string;
  timezone: string;
  createdAt: string;
}

interface OnboardingStatus {
  onboarded: boolean;
  companyCount: number;
  companies: CompanyInfo[];
}

/**
 * useOnboarding — checks if the app has at least one company profile.
 *
 * Polls /api/onboarding on mount + when `refetch` is called.
 * Used by the dashboard to gate engine startup until onboarding
 * is complete.
 */
export function useOnboarding() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/onboarding", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as OnboardingStatus;
        setStatus(data);
        return data;
      }
    } catch {
      // ignore — will retry
    } finally {
      setLoading(false);
    }
    return null;
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return {
    status,
    loading,
    onboarded: status?.onboarded ?? false,
    refetch: check,
  };
}
