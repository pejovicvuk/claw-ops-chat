"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
 * shouldn't pollute each other's disambiguation. The provider is keyed
 * by `sessionId` in `chat-view.tsx`, so switching chats remounts the
 * provider and resets the set automatically.
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

export function ChatFilesProvider({ children }: { children: ReactNode }) {
  // Set lives in a ref to avoid one re-render per `add` — we only emit
  // to subscribers when the membership actually changes. State holds the
  // sorted snapshot that consumers read; we reuse the previous reference
  // when nothing was added so `useMemo([paths])` downstream stays cold.
  const setRef = useRef<Set<string>>(new Set<string>());
  const [paths, setPaths] = useState<readonly string[]>([]);

  const reportPath = useCallback((path: string) => {
    if (!path) return;
    if (setRef.current.has(path)) return;
    setRef.current.add(path);
    setPaths(Array.from(setRef.current).sort());
  }, []);

  const value = useMemo<ChatFilesContextValue>(() => ({ paths, reportPath }), [paths, reportPath]);

  return <ChatFilesContext.Provider value={value}>{children}</ChatFilesContext.Provider>;
}

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
