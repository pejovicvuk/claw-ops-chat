"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchReposForKind, type RepoSummary } from "./repos-api";
import type { RepoKind } from "./projects/validation";

/**
 * Fetch the connected user's GitHub or Bitbucket repos once on mount.
 * No polling — repos rarely change while the picker is open, and a
 * manual refresh button covers stale lists.
 *
 * `kind === null` parks the hook in an idle state without firing a
 * request, useful when the form mounts in folder mode.
 */
export function useRepos(kind: RepoKind | null) {
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const refresh = useCallback(async () => {
    if (!kind) {
      setRepos([]);
      setTruncated(false);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchReposForKind(kind);
      setRepos(result.repos);
      setTruncated(result.truncated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load repos");
      setRepos([]);
      setTruncated(false);
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { repos, loading, error, truncated, refresh };
}
