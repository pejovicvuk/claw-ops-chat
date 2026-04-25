"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileApiError } from "@/lib/api";
import { getGitStatus } from "@/lib/git-api";
import { buildStatusByPath, computeDirtyAncestors } from "@/lib/git/derive-status";
import type { GitFileStatus, GitStatusResponse } from "@/lib/git/types";

const FRESH_MS = 10_000;

export interface GitStatusResult {
  isRepo: boolean;
  repoRoot: string | null;
  branch: string | null;
  detachedHead: string | null;
  ahead: number | null;
  behind: number | null;
  /** Lookup by absolute file path (matches FileEntry.path). */
  statusByPath: Map<string, GitFileStatus>;
  /** Directory paths that contain at least one changed descendant. */
  dirtyAncestors: Set<string>;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

interface CacheEntry {
  result: GitStatusResponse;
  fetchedAt: number;
}

/**
 * Module-level cache keyed by the resolved query path. Same path → same
 * fetch result, regardless of how the user arrived there. Cache is
 * intentionally in-memory only: git state is process-bound and changes
 * fast enough that persisting across reloads adds confusion, not value.
 */
const cache = new Map<string, CacheEntry>();

const EMPTY_STATUS_BY_PATH: Map<string, GitFileStatus> = new Map();
const EMPTY_DIRTY_ANCESTORS: Set<string> = new Set();

function emptyResult(loading: boolean, error: string | null): GitStatusResult {
  return {
    isRepo: false,
    repoRoot: null,
    branch: null,
    detachedHead: null,
    ahead: null,
    behind: null,
    statusByPath: EMPTY_STATUS_BY_PATH,
    dirtyAncestors: EMPTY_DIRTY_ANCESTORS,
    loading,
    error,
    reload: () => {},
  };
}

function mapError(err: unknown): string {
  if (err instanceof FileApiError) {
    if (err.status === 401) return "Still signing you back in — try again in a moment.";
    if (err.status === 403) return "Access denied for this path.";
    return err.message;
  }
  return "Network error — check your connection.";
}

function toResult(
  response: GitStatusResponse,
): Omit<GitStatusResult, "loading" | "error" | "reload"> {
  if (!response.isRepo || !response.repoRoot) {
    return {
      isRepo: false,
      repoRoot: null,
      branch: null,
      detachedHead: null,
      ahead: null,
      behind: null,
      statusByPath: EMPTY_STATUS_BY_PATH,
      dirtyAncestors: EMPTY_DIRTY_ANCESTORS,
    };
  }
  return {
    isRepo: true,
    repoRoot: response.repoRoot,
    branch: response.branch,
    detachedHead: response.detachedHead,
    ahead: response.ahead,
    behind: response.behind,
    statusByPath: buildStatusByPath(response.files),
    dirtyAncestors: computeDirtyAncestors(response.files, response.repoRoot),
  };
}

/**
 * Stale-while-revalidate hook for `git status` of the repo containing
 * `currentPath`. Cache is keyed by `currentPath` so navigating around
 * within the same repo reuses the cached value (the server returns the
 * full repo's file list, sliced client-side via `statusByPath` lookups).
 *
 * Refetches on:
 *   1. `currentPath` change (initial fetch + cache miss).
 *   2. `document.visibilitychange` returning to visible — picks up
 *      external pushes/commits without polling.
 *   3. Manual `reload()` — wired to the toolbar Refresh button and the
 *      existing post-mutation `invalidateDir` call sites.
 */
export function useGitStatus(currentPath: string): GitStatusResult {
  const enabled = currentPath !== "";
  const [data, setData] = useState<Omit<GitStatusResult, "loading" | "error" | "reload">>(() => {
    if (!enabled) return emptyResult(false, null);
    const cached = cache.get(currentPath);
    return cached ? toResult(cached.result) : emptyResult(false, null);
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (!enabled) return false;
    return !cache.has(currentPath);
  });
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(0);

  const fetchNow = useCallback(
    async (path: string, bypassCache: boolean) => {
      if (!enabled) return;
      const token = ++tokenRef.current;
      try {
        if (bypassCache) cache.delete(path);
        const response = await getGitStatus(path);
        if (token !== tokenRef.current) return;
        cache.set(path, { result: response, fetchedAt: Date.now() });
        setData(toResult(response));
        setError(null);
      } catch (err) {
        if (token !== tokenRef.current) return;
        setError(mapError(err));
      } finally {
        if (token === tokenRef.current) setLoading(false);
      }
    },
    [enabled],
  );

  // Initial / path-change fetch with stale-while-revalidate.
  useEffect(() => {
    if (!enabled) {
      setData(emptyResult(false, null));
      setLoading(false);
      setError(null);
      return;
    }
    const cached = cache.get(currentPath);
    if (cached) {
      setData(toResult(cached.result));
      setError(null);
      const fresh = Date.now() - cached.fetchedAt < FRESH_MS;
      if (fresh) {
        setLoading(false);
        return;
      }
      setLoading(false);
      void fetchNow(currentPath, false);
      return;
    }
    setLoading(true);
    void fetchNow(currentPath, false);
  }, [enabled, currentPath, fetchNow]);

  // Re-check on tab focus — picks up external pushes/commits.
  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (!document.hidden) void fetchNow(currentPath, true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [enabled, currentPath, fetchNow]);

  const reload = useCallback(() => {
    if (!enabled) return;
    void fetchNow(currentPath, true);
  }, [enabled, currentPath, fetchNow]);

  return { ...data, loading, error, reload };
}
