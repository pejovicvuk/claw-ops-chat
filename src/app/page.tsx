"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchSessions } from "@/lib/api";
import type { ChatSession } from "@/lib/types";
import { ChatLayout } from "@/components/chat/chat-layout";
import { AuthGuard } from "@/components/auth/auth-guard";

const STORAGE_KEY = "claw-chat-session:v1";

export default function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // Restore last session
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setSelectedSessionId(saved);
    } catch {}
  }, []);

  // Persist session selection
  useEffect(() => {
    if (selectedSessionId) {
      try {
        localStorage.setItem(STORAGE_KEY, selectedSessionId);
      } catch {}
    }
  }, [selectedSessionId]);

  // Load sessions
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const data = await fetchSessions();
      setSessions(data);
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleNewChat = useCallback(() => {
    setSelectedSessionId(null);
  }, []);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
  }, []);

  const handleSessionCreated = useCallback(
    (claudeSessionId: string) => {
      try {
        localStorage.setItem(STORAGE_KEY, claudeSessionId);
      } catch {}
      loadSessions();
    },
    [loadSessions],
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
      </div>
    </AuthGuard>
  );
}
