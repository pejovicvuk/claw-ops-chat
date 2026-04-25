"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Carries the active chat session's working directory down the
 * MessageBubble tree so the file-path resolver can prefer
 * `<sessionCwd>/<candidate>` matches over arbitrary global-unique ones.
 *
 * Why a context (not a prop): `markdown-renderer.tsx` builds its
 * `markdownComponents` map at module scope so react-markdown can keep
 * its per-component cache stable across re-renders. Threading
 * `sessionCwd` through that static map would either bust the cache or
 * require re-creating it on every render. Context lets the leaf
 * `<ResolvedPathPill>` / `<ResolvedFileCard>` read it directly.
 */
const SessionCwdContext = createContext<string | null>(null);

export function SessionCwdProvider({
  value,
  children,
}: {
  value: string | null;
  children: ReactNode;
}) {
  return <SessionCwdContext.Provider value={value}>{children}</SessionCwdContext.Provider>;
}

export function useSessionCwd(): string | null {
  return useContext(SessionCwdContext);
}
