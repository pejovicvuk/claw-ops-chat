"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listFiles, FileApiError } from "@/lib/api";
import { getCachedDir, invalidateDir, isCacheFresh, setCachedDir } from "@/lib/file-cache";
import type { FileEntry } from "@/lib/types";

/**
 * Shared hook for listing a single directory.
 *
 * Consumed by the file browser AND the `@`-mention popover so the two
 * sides read through the same localStorage cache (30 s TTL, 50-path
 * LRU — see `file-cache.ts`). Typing `@src/lib/` right after navigating
 * the browser there hits zero network traffic.
 *
 * Stale-while-revalidate: the first render returns whatever's cached
 * synchronously (even if expired); if expired or missing, a background
 * fetch fires and updates state on completion. `loading` is true only
 * for the first-ever load — subsequent revalidations don't blank the
 * UI.
 */

export interface FileListingsResult {
  entries: FileEntry[];
  loading: boolean;
  error: string | null;
  /** Force a re-fetch, bypassing cache. */
  reload: () => void;
}

function mapError(err: unknown): string {
  if (err instanceof FileApiError) {
    if (err.code === "safe_path") return "That folder is outside the allowed workspace.";
    if (err.status === 401) return "Still signing you back in — try again in a moment.";
    if (err.status === 403) return "Access denied for this path.";
    return err.message;
  }
  return "Network error — check your connection.";
}

/**
 * @param path Directory to list. Empty string disables the hook (returns
 *             empty entries, no fetch) — handy for conditionally-open UI.
 * @param opts `enabled` explicitly turns off the hook.
 */
export function useFileListings(
  path: string,
  opts: { enabled?: boolean } = {},
): FileListingsResult {
  const enabled = opts.enabled !== false && path !== "";

  const [entries, setEntries] = useState<FileEntry[]>(() =>
    enabled ? (getCachedDir(path) ?? []) : [],
  );
  const [loading, setLoading] = useState<boolean>(() => {
    if (!enabled) return false;
    // Only spin on first-ever load; if any cache (even stale) exists, render
    // instantly and revalidate silently.
    return getCachedDir(path) === null;
  });
  const [error, setError] = useState<string | null>(null);
  const reloadTokenRef = useRef(0);

  const fetchNow = useCallback(
    async (bypassCache: boolean) => {
      if (!enabled) return;
      const token = ++reloadTokenRef.current;
      try {
        if (bypassCache) invalidateDir(path);
        const files = await listFiles(path);
        if (token !== reloadTokenRef.current) return; // superseded
        setEntries(files);
        setCachedDir(path, files);
        setError(null);
      } catch (err) {
        if (token !== reloadTokenRef.current) return;
        setError(mapError(err));
      } finally {
        if (token === reloadTokenRef.current) setLoading(false);
      }
    },
    [enabled, path],
  );

  // Path change → refresh displayed entries from cache (sync) and decide
  // whether to revalidate.
  useEffect(() => {
    if (!enabled) {
      setEntries([]);
      setLoading(false);
      setError(null);
      return;
    }
    const cached = getCachedDir(path);
    if (cached) {
      setEntries(cached);
      setError(null);
      if (isCacheFresh(path)) {
        setLoading(false);
        return;
      }
      // Stale — revalidate silently, keep showing cached entries.
      setLoading(false);
      void fetchNow(false);
      return;
    }
    setEntries([]);
    setLoading(true);
    void fetchNow(false);
  }, [enabled, path, fetchNow]);

  const reload = useCallback(() => {
    if (!enabled) return;
    setLoading(true);
    void fetchNow(true);
  }, [enabled, fetchNow]);

  return { entries, loading, error, reload };
}
