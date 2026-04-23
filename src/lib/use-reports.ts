"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJobs, fetchRuns, type JobWithMeta, type RunsFeed } from "./reports-api";

const POLL_INTERVAL_MS = 30_000;

/**
 * Polls /api/reports/runs and /api/reports/jobs on a 30s cadence. Exposed
 * as two separate hooks so the sidebar (which only needs runs) doesn't
 * pay the cost of re-fetching the job catalog.
 */

export function useReportRuns() {
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
    timerRef.current = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refresh]);

  return { feed, loading, error, refresh };
}

export function useReportJobs() {
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
    timerRef.current = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refresh]);

  return { jobs, loading, error, refresh };
}
