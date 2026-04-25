"use client";

import { useMemo } from "react";
import { useWorkspaceIndex, getResolverMaps } from "@/lib/use-workspace-index";
import { resolveCandidate } from "@/lib/resolve-path";
import { useSessionCwd } from "@/lib/session-cwd-context";

export interface UseResolvePathResult {
  /** Absolute path of the resolved file, or null when the candidate
   *  doesn't uniquely match a real file in the workspace. */
  resolved: string | null;
  /** True while the workspace index is loading for the first time —
   *  components can choose to delay rendering until resolution is
   *  attempted, but a stale `null` during loading is also acceptable
   *  (the candidate falls back to plain text). */
  loading: boolean;
}

/**
 * React-side wrapper around `resolveCandidate`. Subscribes to the global
 * workspace index (loaded on demand) and prefers a sessionCwd-relative
 * match over a global-unique one.
 *
 * Note: this hook is consumed by every `<ResolvedPathPill>` /
 * `<ResolvedFileCard>` in a chat, which means a long assistant message
 * may instantiate it 20+ times. Resolution itself is O(1) for bare
 * basenames (Map lookup), and the maps are cached at module level keyed
 * on `lastUpdated` (`getResolverMaps()` in use-workspace-index.ts) — so
 * the only per-call work is one `useMemo`-ed string lookup.
 */
export function useResolvePath(candidate: string): UseResolvePathResult {
  const { lastUpdated, loading } = useWorkspaceIndex({ enabled: true });
  const sessionCwd = useSessionCwd();

  const resolved = useMemo(() => {
    if (!candidate) return null;
    if (lastUpdated === null) return null; // index not loaded yet
    const maps = getResolverMaps();
    return resolveCandidate(candidate, maps, { sessionCwd });
  }, [candidate, lastUpdated, sessionCwd]);

  return { resolved, loading };
}
