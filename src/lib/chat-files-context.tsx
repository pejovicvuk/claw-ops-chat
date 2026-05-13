"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Per-chat collection of file paths that have already been resolved /
 * referenced in this conversation. Consumed by `useResolvePath` to break
 * ties when an ambiguous bare candidate (`helper.tsx`) could match
 * multiple workspace files — the one whose directory is closest to the
 * paths the chat has already touched wins.
 *
 * Why per-chat (not global): two open chats in different sessions
 * shouldn't pollute each other's disambiguation. The provider takes
 * the current `sessionId` as a prop and resets its set when it
 * changes — earlier we leaned on `key={sessionId}` for this in
 * `chat-view.tsx`, but the resulting unmount-remount of every message
 * caused a visible flash on session switch. The internal-effect reset
 * is invisible because surrounding DOM stays mounted.
 *
 * Anchored paths (`/root/foo.md`) and resolved candidates both register
 * here on mount — see `useReportChatFile`. Deduplication is handled by
 * the underlying Set; the exposed `paths` array is sorted for stable
 * identity so memoized resolvers don't churn on every report.
 */

interface ChatFilesContextValue {
  /** Stable-sorted unique list of paths reported in this chat. */
  paths: readonly string[];
  /** Add a path to the set. No-op if already present. */
  reportPath: (path: string) => void;
}

const ChatFilesContext = createContext<ChatFilesContextValue | null>(null);

export function ChatFilesProvider({
  children,
  sessionId,
}: {
  children: ReactNode;
  /** Reset trigger — clears the set when this changes (chat switch). */
  sessionId?: string | null;
}) {
  // The ref+state pair: the ref backs the live Set so reportPath can
  // dedupe synchronously without queuing a re-render per add; the state
  // holds the sorted snapshot consumers read.
  // Hold the live Set in state too so the React-recommended "reset state
  // when prop changes" pattern works without an effect (which would trip
  // the react-hooks/set-state-in-effect rule). On sessionId change we
  // detect it during render and re-init both pieces synchronously.
  const [setHolder, setSetHolder] = useState<{ set: Set<string>; sessionId: string | null }>(
    () => ({ set: new Set<string>(), sessionId: sessionId ?? null }),
  );
  const [paths, setPaths] = useState<readonly string[]>([]);
  const currentId = sessionId ?? null;
  if (setHolder.sessionId !== currentId) {
    setSetHolder({ set: new Set<string>(), sessionId: currentId });
    setPaths(EMPTY_PATHS_INTERNAL);
  }

  const reportPath = useCallback(
    (path: string) => {
      if (!path) return;
      if (setHolder.set.has(path)) return;
      setHolder.set.add(path);
      setPaths(Array.from(setHolder.set).sort());
    },
    [setHolder],
  );

  const value = useMemo<ChatFilesContextValue>(() => ({ paths, reportPath }), [paths, reportPath]);

  return <ChatFilesContext.Provider value={value}>{children}</ChatFilesContext.Provider>;
}

const EMPTY_PATHS_INTERNAL: readonly string[] = [];

const EMPTY_PATHS: readonly string[] = [];

/**
 * Read the current list of paths and the report function. Outside a
 * provider this returns an empty list and a no-op reporter, so call
 * sites don't need null-checks.
 */
export function useChatFiles(): ChatFilesContextValue {
  const ctx = useContext(ChatFilesContext);
  if (ctx) return ctx;
  return { paths: EMPTY_PATHS, reportPath: noopReport };
}

function noopReport(): void {
  /* outside a provider — drop the report */
}

/**
 * Mount-time registration: any pill / card that lands on screen with a
 * resolved absolute path advertises it so future ambiguous candidates
 * have richer disambiguation context. Pass `null` while the path is
 * still loading; the effect skips until a real path arrives.
 */
export function useReportChatFile(path: string | null | undefined): void {
  const { reportPath } = useChatFiles();
  useEffect(() => {
    if (path) reportPath(path);
  }, [path, reportPath]);
}
