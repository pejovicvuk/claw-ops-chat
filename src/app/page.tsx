"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/auth";
import { fetchSessions } from "@/lib/api";
import type { ChatSession } from "@/lib/types";
import { ChatLayout } from "@/components/chat/chat-layout";

const STORAGE_KEY = "claw-chat-session:v1";

export default function ChatPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Auth check
  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push("/login");
      return;
    }
    setReady(true);

    // Restore last session
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setSelectedSessionId(saved);
    } catch {}
  }, [router]);

  // Persist session selection
  useEffect(() => {
    if (selectedSessionId) {
      try { localStorage.setItem(STORAGE_KEY, selectedSessionId); } catch {}
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
    if (ready) loadSessions();
  }, [ready, loadSessions]);

  const handleNewChat = useCallback(() => {
    setSelectedSessionId(null);
  }, []);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
  }, []);

  const handleSessionCreated = useCallback((claudeSessionId: string) => {
    setSelectedSessionId(claudeSessionId);
    loadSessions();
  }, [loadSessions]);

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center bg-canvas-bg">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-canvas-border border-t-canvas-muted" />
      </div>
    );
  }

  return (
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
  );
}
