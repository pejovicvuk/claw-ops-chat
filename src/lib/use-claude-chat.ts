"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "@/lib/auth";
import type { ChatMessage, ClaudeStatus, ActiveToolInfo } from "@/lib/types";

/** Max reconnection delay in ms. */
const MAX_RECONNECT_DELAY = 30_000;
/** Base reconnection delay in ms. */
const BASE_RECONNECT_DELAY = 1_000;

export function useClaudeChat(sessionId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ClaudeStatus>("disconnected");
  const [activeTool, setActiveTool] = useState<ActiveToolInfo | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const currentAssistantRef = useRef<string | null>(null);
  const currentThinkingRef = useRef<string | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Track whether the hook is intentionally closing (unmount/session change). */
  const intentionalCloseRef = useRef(false);

  /* ── Pre-populate messages (for loading history) ── */
  const setInitialMessages = useCallback((msgs: ChatMessage[]) => {
    setMessages(msgs);
  }, []);

  /* ── Append or update streaming assistant text ── */
  const upsertAssistantText = useCallback((delta: string) => {
    setMessages((prev) => {
      const existing = prev.find((m) => m.id === currentAssistantRef.current);
      if (existing) {
        return prev.map((m) =>
          m.id === currentAssistantRef.current
            ? { ...m, content: m.content + delta }
            : m,
        );
      }
      const id = crypto.randomUUID();
      currentAssistantRef.current = id;
      return [
        ...prev,
        { id, role: "assistant" as const, type: "text" as const, content: delta, timestamp: Date.now() },
      ];
    });
  }, []);

  /* ── Process a bridge protocol event ── */
  const handleEvent = useCallback(
    (evt: Record<string, unknown>) => {
      const type = evt.type as string;

      if (type === "ready") {
        setStatus("idle");
        return;
      }

      if (type === "session_init") {
        return;
      }

      if (type === "status") {
        const s = evt.status as string;
        if (s === "awaiting_permission") setStatus("awaiting_permission");
        else if (s === "awaiting_input") setStatus("awaiting_input");
        else if (s === "thinking") setStatus("thinking");
        else if (s === "tool_running") setStatus("tool_running");
        return;
      }

      if (type === "text_delta") {
        setStatus("thinking");
        upsertAssistantText(evt.text as string);
        return;
      }

      if (type === "thinking_delta") {
        setStatus("thinking");
        const thinkingId = currentThinkingRef.current;
        if (thinkingId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === thinkingId ? { ...m, content: m.content + (evt.text as string) } : m,
            ),
          );
        } else {
          const id = crypto.randomUUID();
          currentThinkingRef.current = id;
          setMessages((prev) => [
            ...prev,
            { id, role: "assistant" as const, type: "thinking" as const, content: evt.text as string, timestamp: Date.now() },
          ]);
        }
        return;
      }

      if (type === "tool_use_start") {
        currentAssistantRef.current = null;
        currentThinkingRef.current = null;
        setActiveTool({ name: evt.name as string, callId: evt.id as string });
        setStatus("tool_running");
        const inputStr = evt.input ? JSON.stringify(evt.input) : "";
        setMessages((prev) => {
          if (prev.some((m) => m.toolCallId === evt.id && m.type === "tool_use")) return prev;
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              type: "tool_use" as const,
              toolName: evt.name as string,
              toolCallId: evt.id as string,
              toolInput: inputStr,
              content: "",
              timestamp: Date.now(),
            },
          ];
        });
        return;
      }

      if (type === "tool_use_complete") {
        const input = JSON.stringify(evt.input);
        setMessages((prev) => {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].type === "tool_use" && prev[i].toolCallId === (evt.id as string)) {
              const updated = [...prev];
              updated[i] = { ...updated[i], toolInput: input };
              return updated;
            }
          }
          return prev;
        });
        return;
      }

      if (type === "content_block_stop") {
        setActiveTool(null);
        setStatus("thinking");
        return;
      }

      if (type === "tool_result") {
        setMessages((prev) => {
          if (prev.some((m) => m.toolCallId === (evt.id as string) && m.type === "tool_result")) return prev;
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "system" as const,
              type: "tool_result" as const,
              content: (evt.content as string) || "",
              toolCallId: evt.id as string,
              isError: (evt.isError as boolean) ?? false,
              timestamp: Date.now(),
            },
          ];
        });
        return;
      }

      if (type === "permission_request") {
        currentAssistantRef.current = null;
        setStatus("awaiting_permission");
        setMessages((prev) => {
          if (prev.some((m) => m.permissionId === (evt.id as string))) return prev;
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "system" as const,
              type: "permission_request" as const,
              content: (evt.description as string) || "",
              toolName: evt.toolName as string,
              permissionId: evt.id as string,
              permissionInput: evt.input as Record<string, unknown>,
              permissionResolved: false,
              timestamp: Date.now(),
            },
          ];
        });
        return;
      }

      if (type === "ask_question") {
        currentAssistantRef.current = null;
        setStatus("awaiting_input");
        setMessages((prev) => {
          if (prev.some((m) => m.askId === (evt.id as string))) return prev;
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "system" as const,
              type: "ask_question" as const,
              content: "",
              askId: evt.id as string,
              askQuestions: evt.questions as ChatMessage["askQuestions"],
              askResolved: false,
              timestamp: Date.now(),
            },
          ];
        });
        return;
      }

      if (type === "result") {
        currentAssistantRef.current = null;
        currentThinkingRef.current = null;
        setActiveTool(null);
        setStatus("idle");
        if (evt.isError) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "system" as const,
              type: "error" as const,
              content: (evt.text as string) || "An error occurred",
              timestamp: Date.now(),
            },
          ]);
        }
        return;
      }

      if (type === "error") {
        currentAssistantRef.current = null;
        currentThinkingRef.current = null;
        setActiveTool(null);
        setStatus("idle");
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "system" as const,
            type: "error" as const,
            content: (evt.message as string) || "Bridge error",
            timestamp: Date.now(),
          },
        ]);
        return;
      }
    },
    [upsertAssistantText],
  );

  /* ── Send JSON to server via WebSocket ── */
  const sendToServer = useCallback((obj: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(obj));
    }
  }, []);

  /* ── Connect WebSocket ── */
  const connect = useCallback(() => {
    if (!sessionId) return;

    // Clear any pending reconnect timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    wsRef.current?.close();
    wsRef.current = null;
    intentionalCloseRef.current = false;
    setStatus("connecting");

    const token = getToken();
    if (!token) {
      setStatus("disconnected");
      return;
    }

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    // Token is still passed as query param for backward compatibility;
    // the server also reads the httpOnly cookie.
    const wsUrl = `${proto}//${window.location.host}/chat/ws/chat?token=${encodeURIComponent(token)}&session=${encodeURIComponent(sessionId)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Reset reconnection counter on successful connect
      reconnectAttemptRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg && typeof msg.type === "string") {
          handleEvent(msg);
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
        setStatus("disconnected");

        // Auto-reconnect with exponential backoff (unless intentionally closed)
        if (!intentionalCloseRef.current) {
          scheduleReconnect();
        }
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror, so reconnection is handled there
    };
  }, [sessionId, handleEvent]);

  /* ── Exponential backoff reconnection ── */
  const scheduleReconnect = useCallback(() => {
    const attempt = reconnectAttemptRef.current;
    const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, attempt), MAX_RECONNECT_DELAY);
    // Add jitter (0-25% of delay)
    const jitter = Math.random() * delay * 0.25;

    reconnectTimerRef.current = setTimeout(() => {
      reconnectAttemptRef.current = attempt + 1;
      connect();
    }, delay + jitter);
  }, [connect]);

  /* ── Send user message ── */
  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status !== "idle") return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user",
          type: "text",
          content: trimmed,
          timestamp: Date.now(),
        },
      ]);

      currentAssistantRef.current = null;
      currentThinkingRef.current = null;
      setActiveTool(null);
      setStatus("thinking");

      sendToServer({ type: "message", text: trimmed });
    },
    [status, sendToServer],
  );

  /* ── Permission response ── */
  const respondPermission = useCallback(
    (permissionId: string, allow: boolean, allowSession?: boolean, message?: string) => {
      sendToServer({
        type: "permission_response",
        id: permissionId,
        allow,
        allowSession: allowSession || false,
        message: message || undefined,
      });

      setMessages((prev) =>
        prev.map((m) =>
          m.permissionId === permissionId
            ? { ...m, permissionResolved: true, permissionAllowed: allow }
            : m,
        ),
      );

      setStatus("tool_running");
    },
    [sendToServer],
  );

  /* ── Question response ── */
  const respondQuestion = useCallback(
    (askId: string, answers: Record<string, string>) => {
      sendToServer({ type: "ask_response", id: askId, answers });
      setMessages((prev) =>
        prev.map((m) => (m.askId === askId ? { ...m, askResolved: true } : m)),
      );
      setStatus("thinking");
    },
    [sendToServer],
  );

  /* ── Mode & effort ── */
  const setPermissionMode = useCallback(
    (mode: string) => sendToServer({ type: "set_mode", mode }),
    [sendToServer],
  );

  const setEffort = useCallback(
    (effort: string | null) => sendToServer({ type: "set_effort", effort }),
    [sendToServer],
  );

  /* ── Reconnect ── */
  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    connect();
  }, [connect]);

  /* ── Auto-connect on mount / session change ── */
  useEffect(() => {
    if (!sessionId) return;
    const id = requestAnimationFrame(() => connect());
    return () => {
      cancelAnimationFrame(id);
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [sessionId, connect]);

  /* ── Reconnect on page visibility change ── */
  useEffect(() => {
    function handleVisibilityChange() {
      if (
        document.visibilityState === "visible" &&
        !wsRef.current &&
        sessionId &&
        !intentionalCloseRef.current
      ) {
        reconnectAttemptRef.current = 0;
        connect();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [sessionId, connect]);

  return {
    messages,
    status,
    activeTool,
    sendMessage,
    respondPermission,
    respondQuestion,
    setPermissionMode,
    setEffort,
    reconnect,
    setInitialMessages,
  };
}
