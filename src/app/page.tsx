"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSessions } from "@/lib/api";
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
    setParam("chat", null);
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
        />
        <SettingsOverlay />
      </div>
    </AuthGuard>
  );
}
