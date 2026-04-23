"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJobs, fetchRuns, type JobWithMeta, type RunsFeed } from "./reports-api";

/** Cadence when the Reports view isn't open — cheap background refresh. */
const SLOW_POLL_MS = 30_000;
/** Cadence while the user is actively in Reports view — surfaces new runs
 * almost immediately without burning a WebSocket channel on each endpoint. */
const FAST_POLL_MS = 3_000;

interface PollOptions {
  /** When true, polls every FAST_POLL_MS (≈3s) instead of the slow 30s. */
  fast?: boolean;
}

/**
 * Polls /api/reports/runs and /api/reports/jobs. Exposed as two hooks so
 * the sidebar (runs only) doesn't pay the cost of the job catalog. Both
 * accept a `fast` flag that callers flip on while the Reports view is
 * visible — 3s is snappy enough to feel "live" for the running-now
 * indicators without needing a WebSocket channel.
 */

export function useReportRuns(options: PollOptions = {}) {
  const { fast = false } = options;
  const [feed, setFeed] = useState<RunsFeed>({ runs: [], unreadCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchRuns();
      setFeed(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = fast ? FAST_POLL_MS : SLOW_POLL_MS;
    timerRef.current = setInterval(refresh, interval);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refresh, fast]);

  return { feed, loading, error, refresh };
}

export function useReportJobs(options: PollOptions = {}) {
  const { fast = false } = options;
  const [jobs, setJobs] = useState<JobWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { jobs: next } = await fetchJobs();
      setJobs(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = fast ? FAST_POLL_MS : SLOW_POLL_MS;
    timerRef.current = setInterval(refresh, interval);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refresh, fast]);

  return { jobs, loading, error, refresh };
}
