"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileApiError } from "@/lib/api";
import { getGitLog } from "@/lib/git-api";
import type { GitLogEntry } from "@/lib/git/types";

export interface GitLogResult {
  branch: string | null;
  entries: GitLogEntry[];
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
 * Fetches commit history for a repo. `branch` is optional — when null,
 * the server returns commits reachable from HEAD. `limit` defaults to
 * the server's default (50) when undefined.
 */
export function useGitLog(
  repoRoot: string | null,
  branch: string | null,
  enabled: boolean,
  limit?: number,
): GitLogResult {
  const [branchOut, setBranchOut] = useState<string | null>(null);
  const [entries, setEntries] = useState<GitLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(0);

  const fetchNow = useCallback(async () => {
    if (!enabled || !repoRoot) return;
    const token = ++tokenRef.current;
    setLoading(true);
    try {
      const response = await getGitLog(repoRoot, {
        branch: branch ?? undefined,
        limit,
      });
      if (token !== tokenRef.current) return;
      setBranchOut(response.branch);
      setEntries(response.entries);
      setError(null);
    } catch (err) {
      if (token !== tokenRef.current) return;
      setError(mapError(err));
    } finally {
      if (token === tokenRef.current) setLoading(false);
    }
  }, [enabled, repoRoot, branch, limit]);

  useEffect(() => {
    if (!enabled || !repoRoot) {
      setEntries([]);
      setBranchOut(null);
      setLoading(false);
      setError(null);
      return;
    }
    void fetchNow();
  }, [enabled, repoRoot, fetchNow]);

  return { branch: branchOut, entries, loading, error, reload: fetchNow };
}
