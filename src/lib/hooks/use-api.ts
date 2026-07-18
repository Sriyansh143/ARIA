'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Polling fetch hook. Fetches `url` immediately and then every `intervalMs`
 * (default 8s). Returns a manual `refresh` callback. Safe to use for the
 * dashboard's many live panels.
 */
export function useApi<T>(url: string | null, intervalMs = 8000): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;

  const doFetch = useCallback(async () => {
    if (!urlRef.current) return;
    try {
      const res = await fetch(urlRef.current, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    doFetch();
    // intervalMs <= 0 means "fetch once" (no polling) — used by modals and
    // panels that refresh manually.
    if (intervalMs > 0) {
      const id = setInterval(doFetch, intervalMs);
      return () => clearInterval(id);
    }
  }, [url, intervalMs, doFetch]);

  return { data, loading, error, refresh: doFetch };
}

/** One-shot POST helper that returns parsed JSON. */
export async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
  return res.json() as Promise<T>;
}

/** One-shot PATCH helper. */
export async function patchJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** One-shot DELETE helper. */
export async function deleteJson<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}
