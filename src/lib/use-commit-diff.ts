"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileApiError } from "@/lib/api";
import { getGitCommitDiff } from "@/lib/git-api";
import type { GitCommitDiffResponse, GitCommitDiffStats } from "@/lib/git/types";

export interface UseCommitDiffResult {
  diff: string;
  stats: GitCommitDiffStats;
  isMerge: boolean;
  found: boolean;
  isRepo: boolean;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const EMPTY_STATS: GitCommitDiffStats = { files: 0, insertions: 0, deletions: 0 };

// Module-scoped cache so collapsing then re-expanding the same commit is
// instant. Cleared on full page reload — short-lived enough that we don't
// need an LRU here.
const cache = new Map<string, GitCommitDiffResponse>();

function cacheKey(repoRoot: string, sha: string): string {
  return `${repoRoot}::${sha}`;
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
 * Fetches the unified diff + stats for a single commit. Skipped when
 * `sha` is null (panel collapsed). Caches by `${repoRoot}::${sha}` so
 * toggling the same commit doesn't re-hit the server.
 */
export function useCommitDiff(repoRoot: string, sha: string | null): UseCommitDiffResult {
  const [state, setState] = useState<{
    diff: string;
    stats: GitCommitDiffStats;
    isMerge: boolean;
    found: boolean;
    isRepo: boolean;
    error: string | null;
  }>({ diff: "", stats: EMPTY_STATS, isMerge: false, found: false, isRepo: false, error: null });
  const [loading, setLoading] = useState(false);
  const tokenRef = useRef(0);

  const fetchNow = useCallback(async () => {
    if (!sha || !repoRoot) return;
    const key = cacheKey(repoRoot, sha);
    const hit = cache.get(key);
    if (hit) {
      setState({
        diff: hit.diff,
        stats: hit.stats,
        isMerge: hit.isMerge,
        found: hit.found,
        isRepo: hit.isRepo,
        error: hit.error ?? null,
      });
      setLoading(false);
      return;
    }
    const token = ++tokenRef.current;
    setLoading(true);
    try {
      const response = await getGitCommitDiff(repoRoot, sha);
      if (token !== tokenRef.current) return;
      cache.set(key, response);
      setState({
        diff: response.diff,
        stats: response.stats,
        isMerge: response.isMerge,
        found: response.found,
        isRepo: response.isRepo,
        error: response.error ?? null,
      });
    } catch (err) {
      if (token !== tokenRef.current) return;
      setState((prev) => ({ ...prev, error: mapError(err) }));
    } finally {
      if (token === tokenRef.current) setLoading(false);
    }
  }, [repoRoot, sha]);

  useEffect(() => {
    if (!sha) {
      setState({
        diff: "",
        stats: EMPTY_STATS,
        isMerge: false,
        found: false,
        isRepo: false,
        error: null,
      });
      setLoading(false);
      return;
    }
    void fetchNow();
  }, [sha, fetchNow]);

  return { ...state, loading, reload: fetchNow };
}
