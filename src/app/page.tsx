"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deleteSession, fetchSessions } from "@/lib/api";
import {
  getCachedSessions,
  isSessionCacheFresh,
  setCachedSessions,
  invalidateSessions,
} from "@/lib/session-cache";
import type { ChatSession } from "@/lib/types";
import { ChatLayout } from "@/components/chat/chat-layout";
import { AuthGuard } from "@/components/auth/auth-guard";
import { SettingsOverlay } from "@/components/settings/settings-overlay";
import { useUrlState } from "@/lib/use-url-state";

const STORAGE_KEY = "claw-chat-session:v1";
const POLL_INTERVAL = 30_000; // 30 seconds background refresh

export default function ChatPage() {
  const { params, setParam } = useUrlState();

  // Initialize sessions from cache immediately (no spinner on revisit)
  const [sessions, setSessions] = useState<ChatSession[]>(() => getCachedSessions() ?? []);
  const [sessionsLoading, setSessionsLoading] = useState(() => getCachedSessions() === null);
  // URL is the source of truth for selected chat; localStorage as fallback only.
  const selectedSessionId = params.get("chat");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // On first mount, if URL has no `chat` param, restore from localStorage into URL.
  useEffect(() => {
    if (params.get("chat")) return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setParam("chat", saved);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist selected session to localStorage (fallback if URL gets cleared)
  useEffect(() => {
    if (selectedSessionId) {
      try {
        localStorage.setItem(STORAGE_KEY, selectedSessionId);
      } catch {}
    }
  }, [selectedSessionId]);

  // Load sessions with stale-while-revalidate
  const loadSessions = useCallback(async () => {
    const cached = getCachedSessions();

    // If cache is fresh, skip the network call
    if (cached && isSessionCacheFresh()) {
      setSessions(cached);
      setSessionsLoading(false);
      return;
    }

    // Show spinner only on first-ever load (no cached data)
    if (!cached) setSessionsLoading(true);

    try {
      const data = await fetchSessions();
      // Only re-render if data actually changed
      setSessions((prev) => {
        if (prev.length === data.length && JSON.stringify(prev) === JSON.stringify(data)) {
          return prev;
        }
        return data;
      });
      setCachedSessions(data);
    } catch {
      if (!cached) setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  // Initial load + background polling
  useEffect(() => {
    loadSessions();
    pollRef.current = setInterval(loadSessions, POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadSessions]);

  const handleNewChat = useCallback(() => {
    // Generate a UUID up front so the new session's ID matches the
    // server's UUID_RE (server.ts:226-229). Previously we set null,
    // which made ChatLayout fall back to `"new-" + Date.now()` — an
    // ID the server couldn't recognise as resumable and that triggered
    // a WS reconnect on the first "real" response, making the first
    // message feel like it was dropped.
    setParam("chat", crypto.randomUUID());
  }, [setParam]);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setParam("chat", sessionId);
    },
    [setParam],
  );

  const handleSessionCreated = useCallback(
    (claudeSessionId: string) => {
      try {
        localStorage.setItem(STORAGE_KEY, claudeSessionId);
      } catch {}
      setParam("chat", claudeSessionId);
      invalidateSessions();
      loadSessions();
    },
    [loadSessions, setParam],
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      await deleteSession(sessionId);
      // Optimistic UI: drop the row immediately so the sidebar feels
      // responsive. The background poll will reconcile against the
      // server state on the next tick either way.
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
      invalidateSessions();
      // If the deleted chat was the currently selected one, bounce to
      // a fresh chat so the user isn't staring at a view pointing at a
      // now-dead session id. Same pattern as handleNewChat.
      if (selectedSessionId === sessionId) {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {}
        setParam("chat", crypto.randomUUID());
      }
      // Full refresh after the local mutation so timestamps / counts
      // from other sessions stay accurate.
      void loadSessions();
    },
    [loadSessions, selectedSessionId, setParam],
  );

  return (
    <AuthGuard>
      <div className="flex h-dvh flex-col overflow-hidden bg-canvas-bg text-canvas-fg">
        <ChatLayout
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          onSelectSession={handleSelectSession}
          onNewChat={handleNewChat}
          onRefreshSessions={loadSessions}
          sessionsLoading={sessionsLoading}
          onSessionCreated={handleSessionCreated}
          onDeleteSession={handleDeleteSession}
        />
        <SettingsOverlay />
      </div>
    </AuthGuard>
  );
}
