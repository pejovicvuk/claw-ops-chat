"use client";

import { useMemo } from "react";
import { useWorkspaceIndex, getResolverMaps } from "@/lib/use-workspace-index";
import { resolveCandidate } from "@/lib/resolve-path";
import { useSessionCwd } from "@/lib/session-cwd-context";
import { useChatFiles } from "@/lib/chat-files-context";

export interface UseResolvePathResult {
  /** Absolute path of the resolved file, or null only when the basename
   *  has zero matches in the workspace index. Ambiguous matches now
   *  always pick a winner via directory-affinity + tiebreaker rules. */
  resolved: string | null;
  /** True while the workspace index is loading for the first time —
   *  components can choose to delay rendering until resolution is
   *  attempted, but a stale `null` during loading is also acceptable
   *  (the candidate falls back to plain text). */
  loading: boolean;
}

/**
 * React-side wrapper around `resolveCandidate`. Subscribes to the global
 * workspace index (loaded on demand) and threads two disambiguation
 * signals into the resolver:
 *
 *   - sessionCwd from `<SessionCwdContext>` — exact-cwd match wins
 *     outright.
 *   - referenced paths from `<ChatFilesContext>` — paths already
 *     resolved earlier in this chat. The resolver picks the candidate
 *     whose directory shares the most prefix segments with any of them.
 *
 * Note: this hook is consumed by every `<ResolvedPathPill>` /
 * `<ResolvedFileCard>` in a chat, which means a long assistant message
 * may instantiate it 20+ times. Resolution itself is O(1) for bare
 * basenames (Map lookup) plus O(referencedPaths × dir-segments) for
 * the affinity scoring — both negligible at expected sizes. The maps
 * are cached at module level keyed on `lastUpdated`
 * (`getResolverMaps()` in use-workspace-index.ts) so the only per-call
 * work is the score computation and one `useMemo` lookup.
 */
export function useResolvePath(candidate: string): UseResolvePathResult {
  const { lastUpdated, loading } = useWorkspaceIndex({ enabled: true });
  const sessionCwd = useSessionCwd();
  const { paths: referencedPaths } = useChatFiles();

  const resolved = useMemo(() => {
    if (!candidate) return null;
    if (lastUpdated === null) return null; // index not loaded yet
    const maps = getResolverMaps();
    return resolveCandidate(candidate, maps, { sessionCwd, referencedPaths });
  }, [candidate, lastUpdated, sessionCwd, referencedPaths]);

  return { resolved, loading };
}
