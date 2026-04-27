"use client";

import { useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

export interface SeriesResponse {
  from: number;
  to: number;
  series: Record<string, Array<{ t: number; v: number }>>;
}

interface UseMonSeriesOptions {
  metrics: string[];
  /** Range in ms; default 1h. */
  rangeMs?: number;
  /** Refresh cadence in ms; null pauses. Default 5s. */
  intervalMs?: number | null;
  paused?: boolean;
}

/**
 * Hook for the long-history monitoring chart endpoint. Polls
 * `/api/monitoring/health/series?metrics=…` at the configured cadence,
 * pauses on `document.hidden`, and returns the latest snapshot plus a
 * `from`/`to` window to feed straight into `<MultiSeriesChart>`.
 */
export function useMonSeries(opts: UseMonSeriesOptions) {
  const { metrics, rangeMs = 60 * 60 * 1000, intervalMs = 5000, paused = false } = opts;
  const [data, setData] = useState<SeriesResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const metricsKey = metrics.join(",");

  useEffect(() => {
    if (paused || intervalMs === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function fetchOnce() {
      const now = Date.now();
      const from = now - rangeMs;
      const url = `${BASE}/api/monitoring/health/series?metrics=${encodeURIComponent(metricsKey)}&from=${from}&to=${now}`;
      try {
        const res = await authFetch(url);
        if (!res.ok) throw new Error(`${res.status}`);
        const json = (await res.json()) as SeriesResponse;
        if (!cancelled && aliveRef.current) {
          setData(json);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled && aliveRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      }
    }

    async function tick() {
      if (cancelled) return;
      if (document.visibilityState !== "hidden") {
        await fetchOnce();
      }
      if (!cancelled && intervalMs !== null) {
        timer = setTimeout(tick, Math.max(1000, intervalMs));
      }
    }

    void tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchOnce();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [metricsKey, rangeMs, intervalMs, paused]);

  return { data, error, loading };
}
