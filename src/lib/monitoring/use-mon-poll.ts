"use client";

import { useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface FetchState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
}

const DEFAULT_INTERVAL_MS = 5000;

/**
 * Poll an authenticated GET endpoint at a given interval. Pauses when the
 * tab is hidden (matching the existing `useSessionStatuses` pattern). The
 * interval can be `null` to pause polling entirely (e.g. user picked
 * "Off" in the refresh dropdown).
 *
 * Returns `{data, error, loading, refresh}` — the latest snapshot, the
 * last error if any, an in-flight flag, and a manual refresh function.
 */
export function useMonPoll<T>(
  path: string,
  options: { intervalMs?: number | null; paused?: boolean } = {},
): FetchState<T> & { refresh: () => Promise<void> } {
  const { intervalMs = DEFAULT_INTERVAL_MS, paused = false } = options;
  const [state, setState] = useState<FetchState<T>>({ data: null, error: null, loading: true });
  const aliveRef = useRef(true);
  const lastFetchAt = useRef(0);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const fetchOnce = useRef(async (): Promise<void> => {
    lastFetchAt.current = Date.now();
    setState((prev) => ({ ...prev, loading: prev.data === null }));
    try {
      const res = await authFetch(`${BASE}${path}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = (await res.json()) as T;
      if (!aliveRef.current) return;
      setState({ data: json, error: null, loading: false });
    } catch (err) {
      if (!aliveRef.current) return;
      setState((prev) => ({
        data: prev.data,
        error: err instanceof Error ? err : new Error(String(err)),
        loading: false,
      }));
    }
  });

  // Re-bind the fetch on path/auth changes.
  useEffect(() => {
    fetchOnce.current = async () => {
      lastFetchAt.current = Date.now();
      setState((prev) => ({ ...prev, loading: prev.data === null }));
      try {
        const res = await authFetch(`${BASE}${path}`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const json = (await res.json()) as T;
        if (!aliveRef.current) return;
        setState({ data: json, error: null, loading: false });
      } catch (err) {
        if (!aliveRef.current) return;
        setState((prev) => ({
          data: prev.data,
          error: err instanceof Error ? err : new Error(String(err)),
          loading: false,
        }));
      }
    };
  }, [path]);

  useEffect(() => {
    if (paused || intervalMs === null) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState !== "hidden") {
        await fetchOnce.current();
      }
      if (!cancelled) {
        timer = setTimeout(tick, Math.max(500, intervalMs));
      }
    };

    void tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchOnce.current();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [paused, intervalMs]);

  return {
    ...state,
    refresh: () => fetchOnce.current(),
  };
}
