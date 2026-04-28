"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileApiError } from "@/lib/api";
import { getGitDiff } from "@/lib/git-api";
import type { DiffAgainst } from "@/lib/git/types";

export interface GitDiffResult {
  diff: string;
  tracked: boolean;
  isRepo: boolean;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function mapError(err: unknown): string {
  if (err instanceof FileApiError) {
    if (err.status === 401) return "Still signing you back in — try again in a moment.";
    if (err.status === 403) return "Access denied for this path.";
    return err.message;
  }
  return "Network error — check your connection.";
}

/**
 * Fetches the unified diff for a single file against working / HEAD /
 * staged. Skipped when `path` is empty. Concurrent fetches are
 * cancellation-tokened so a stale response can't overwrite a newer one
 * after the user toggled `against` or switched files.
 */
export function useGitDiff(path: string, against: DiffAgainst): GitDiffResult {
  const [diff, setDiff] = useState<string>("");
  const [tracked, setTracked] = useState<boolean>(false);
  const [isRepo, setIsRepo] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(0);

  const fetchNow = useCallback(async () => {
    if (!path) return;
    const token = ++tokenRef.current;
    setLoading(true);
    try {
      const response = await getGitDiff(path, against);
      if (token !== tokenRef.current) return;
      setDiff(response.diff);
      setTracked(response.tracked);
      setIsRepo(response.isRepo);
      setError(response.error ?? null);
    } catch (err) {
      if (token !== tokenRef.current) return;
      setError(mapError(err));
    } finally {
      if (token === tokenRef.current) setLoading(false);
    }
  }, [path, against]);

  useEffect(() => {
    if (!path) {
      setDiff("");
      setTracked(false);
      setIsRepo(false);
      setLoading(false);
      setError(null);
      return;
    }
    void fetchNow();
  }, [path, against, fetchNow]);

  return { diff, tracked, isRepo, loading, error, reload: fetchNow };
}
