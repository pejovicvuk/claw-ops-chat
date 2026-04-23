"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { searchWorkspace, FileApiError } from "@/lib/api";

/**
 * Workspace-wide flat file index for the chat composer's `@` autocomplete.
 *
 * One global snapshot lives in a module-level store so every hook
 * subscriber sees the same list — typing `@` in two different composer
 * instances (mobile sheet + desktop) doesn't duplicate the fetch.
 *
 * Freshness:
 * - Loaded from localStorage on first access (synchronous).
 * - If last-updated is older than TTL, a background refresh is kicked.
 * - Mutations that can add/remove files (upload, delete, create folder,
 *   create file) call `invalidateWorkspaceIndex()` so the next read
 *   fetches fresh.
 */

export interface WorkspaceIndexEntry {
  name: string;
  path: string;
  directory: boolean;
}

interface Snapshot {
  entries: WorkspaceIndexEntry[];
  lastUpdated: number | null; // unix ms
  loading: boolean;
  error: string | null;
  truncated: boolean;
}

const STORAGE_KEY = "claw-workspace-index:v1";
const TTL_MS = 10 * 60 * 1000; // 10 minutes

interface StoredShape {
  entries: WorkspaceIndexEntry[];
  lastUpdated: number;
  truncated: boolean;
}

function readStorage(): StoredShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredShape;
    if (!Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStorage(snap: StoredShape): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch {
    /* quota — give up silently, the in-memory snapshot still works for this tab */
  }
}

// ── Module-level store ───────────────────────────────────────────────

let current: Snapshot = {
  entries: [],
  lastUpdated: null,
  loading: false,
  error: null,
  truncated: false,
};
const listeners = new Set<() => void>();
let initialized = false;
let inFlight: Promise<void> | null = null;

function emit(): void {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Lazy-initialize from storage on first subscribe.
  if (!initialized) {
    initialized = true;
    const stored = readStorage();
    if (stored) {
      current = {
        entries: stored.entries,
        lastUpdated: stored.lastUpdated,
        loading: false,
        error: null,
        truncated: stored.truncated,
      };
    }
  }
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Snapshot {
  return current;
}

function getServerSnapshot(): Snapshot {
  return {
    entries: [],
    lastUpdated: null,
    loading: false,
    error: null,
    truncated: false,
  };
}

function mapError(err: unknown): string {
  if (err instanceof FileApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Index refresh failed";
}

async function refresh(force = false): Promise<void> {
  if (inFlight) return inFlight;
  const fresh =
    !force &&
    current.lastUpdated !== null &&
    Date.now() - current.lastUpdated < TTL_MS &&
    current.entries.length > 0;
  if (fresh) return;

  current = { ...current, loading: true, error: null };
  emit();

  inFlight = (async () => {
    try {
      const res = await searchWorkspace("~");
      const now = Date.now();
      current = {
        entries: res.entries,
        lastUpdated: now,
        loading: false,
        error: null,
        truncated: res.truncated,
      };
      writeStorage({ entries: res.entries, lastUpdated: now, truncated: res.truncated });
    } catch (err) {
      current = { ...current, loading: false, error: mapError(err) };
    } finally {
      emit();
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Nuke the cached index so the next hook read fetches fresh. */
export function invalidateWorkspaceIndex(): void {
  current = { ...current, lastUpdated: null };
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
  }
  emit();
}

// ── Hook ──────────────────────────────────────────────────────────────

export interface UseWorkspaceIndexOptions {
  /** When false, skip the initial auto-fetch. Useful for the popover —
   *  we only want to pay the index cost once the user types `@`. */
  enabled?: boolean;
}

export interface WorkspaceIndexResult {
  entries: WorkspaceIndexEntry[];
  loading: boolean;
  error: string | null;
  truncated: boolean;
  lastUpdated: number | null;
  reload: () => void;
}

export function useWorkspaceIndex(opts: UseWorkspaceIndexOptions = {}): WorkspaceIndexResult {
  const enabled = opts.enabled !== false;
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Kick a fetch if we don't have fresh data yet. The refresh itself is
  // deduped via `inFlight`, and `emit()` on completion re-renders every
  // subscriber — no explicit tick needed here.
  useEffect(() => {
    if (!enabled) return;
    const stale = snap.lastUpdated === null || Date.now() - snap.lastUpdated >= TTL_MS;
    if (stale && !snap.loading) {
      void refresh(false);
    }
  }, [enabled, snap.lastUpdated, snap.loading]);

  const reload = useCallback(() => {
    void refresh(true);
  }, []);

  return {
    entries: snap.entries,
    loading: snap.loading,
    error: snap.error,
    truncated: snap.truncated,
    lastUpdated: snap.lastUpdated,
    reload,
  };
}
