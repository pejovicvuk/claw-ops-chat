"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileApiError } from "@/lib/api";
import { getGitBranches } from "@/lib/git-api";
import type { GitBranch } from "@/lib/git/types";

export interface GitBranchesResult {
  branches: GitBranch[];
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

/** Fetches the branch list for a given repo path. Skipped when `enabled` is false. */
export function useGitBranches(repoRoot: string | null, enabled: boolean): GitBranchesResult {
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(0);

  const fetchNow = useCallback(async () => {
    if (!enabled || !repoRoot) return;
    const token = ++tokenRef.current;
    setLoading(true);
    try {
      const response = await getGitBranches(repoRoot);
      if (token !== tokenRef.current) return;
      setBranches(response.branches);
      setError(null);
    } catch (err) {
      if (token !== tokenRef.current) return;
      setError(mapError(err));
    } finally {
      if (token === tokenRef.current) setLoading(false);
    }
  }, [enabled, repoRoot]);

  useEffect(() => {
    if (!enabled || !repoRoot) {
      setBranches([]);
      setLoading(false);
      setError(null);
      return;
    }
    void fetchNow();
  }, [enabled, repoRoot, fetchNow]);

  return { branches, loading, error, reload: fetchNow };
}
