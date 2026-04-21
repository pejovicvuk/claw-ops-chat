"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAccessToken } from "@/lib/apiClient";
import type { ChatMessage, ClaudeStatus, ActiveToolInfo } from "@/lib/types";

/** Max reconnection delay in ms. */
const MAX_RECONNECT_DELAY = 30_000;
/** Base reconnection delay in ms. */
const BASE_RECONNECT_DELAY = 1_000;

export function useClaudeChat(sessionId: string | null, sessionCwd?: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ClaudeStatus>("disconnected");
  const [activeTool, setActiveTool] = useState<ActiveToolInfo | null>(null);
  const [claudeSessionId, setClaudeSessionId] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [authRequired, setAuthRequired] = useState<
    { message: string; hint: string } | null
  >(null);
  const [contextUsage, setContextUsage] = useState<{
    used: number;
    max: number;
    percentage: number;
  } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const currentAssistantRef = useRef<string | null>(null);
  const currentThinkingRef = useRef<string | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Track whether the hook is intentionally closing (unmount/session change). */
  const intentionalCloseRef = useRef(false);
  /** Ref to break circular dependency between connect ↔ scheduleReconnect. */
  const scheduleReconnectRef = useRef<() => void>(() => {});
  /**
   * Messages typed by the user before the WebSocket was open. Flushed
   * when the server's "ready" event arrives. Fixes the "first message
   * on a new chat disappears" bug — previously sendMessage returned
   * silently if ws.readyState wasn't OPEN.
   */
  const pendingSendsRef = useRef<string[]>([]);
  /**
   * Permission IDs the user has already approved/denied in this tab.
   * Survives refreshes via sessionStorage keyed by sessionId. Belt-and-
   * suspenders against stale permission_request replay when the server
   * has lost its history (e.g. container restarted).
   */
  const resolvedPermissionsRef = useRef<Set<string>>(new Set());

  /* ── Pre-populate messages (for loading history) ── */
  const setInitialMessages = useCallback((msgs: ChatMessage[]) => {
    setMessages(msgs);
  }, []);

  /* ── Seed context usage from loaded history ── */
  const setInitialContextUsage = useCallback(
    (usage: { used: number; max: number; percentage: number } | null) => {
      setContextUsage(usage);
    },
    [],
  );

  /* ── Append or update streaming assistant text ── */
  const upsertAssistantText = useCallback((delta: string) => {
    setMessages((prev) => {
      const existing = prev.find((m) => m.id === currentAssistantRef.current);
      if (existing) {
        return prev.map((m) =>
          m.id === currentAssistantRef.current ? { ...m, content: m.content + delta } : m,
        );
      }
      const id = crypto.randomUUID();
      currentAssistantRef.current = id;
      return [
        ...prev,
        {
          id,
          role: "assistant" as const,
          type: "text" as const,
          content: delta,
          timestamp: Date.now(),
        },
      ];
    });
  }, []);

  /* ── Process a bridge protocol event ── */
  const handleEvent = useCallback(
    (evt: Record<string, unknown>) => {
      const type = evt.type as string;

      if (type === "ready") {
        setStatus("idle");
        // Flush any messages the user typed before the WS finished
        // connecting. Fire-and-forget — the server queues them on its
        // side too if this session was already processing a turn.
        const queued = pendingSendsRef.current;
        if (queued.length > 0) {
          pendingSendsRef.current = [];
          for (const text of queued) {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: "message", text }));
              // Only the first message kicks us into "thinking"; the
              // server will serialise the rest via its messageQueue.
              setStatus("thinking");
            }
          }
        }
        return;
      }

      if (type === "session_init") {
        setClaudeSessionId(evt.sessionId as string);
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
            {
              id,
              role: "assistant" as const,
              type: "thinking" as const,
              content: evt.text as string,
              timestamp: Date.now(),
            },
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
          if (prev.some((m) => m.toolCallId === (evt.id as string) && m.type === "tool_result"))
            return prev;
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
        const reqId = evt.id as string;
        // If the user already answered this prompt in a previous tab /
        // page-load, the server's filter (piece 4 in plan) should have
        // stripped it from eventHistory — but cover the container-
        // restart edge case with a local set too.
        if (resolvedPermissionsRef.current.has(reqId)) {
          return;
        }
        currentAssistantRef.current = null;
        setStatus("awaiting_permission");
        setMessages((prev) => {
          if (prev.some((m) => m.permissionId === reqId)) return prev;
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "system" as const,
              type: "permission_request" as const,
              content: (evt.description as string) || "",
              toolName: evt.toolName as string,
              permissionId: reqId,
              permissionInput: evt.input as Record<string, unknown>,
              permissionResolved: false,
              timestamp: Date.now(),
            },
          ];
        });
        return;
      }

      if (type === "permission_resolved") {
        // Server-side purge signal — a permission / ask / plan prompt was
        // answered in another tab. Mark it resolved locally so we don't
        // surface a modal that no longer makes sense.
        const resolvedId = evt.id as string;
        if (resolvedId) {
          resolvedPermissionsRef.current.add(resolvedId);
          persistResolved();
          setMessages((prev) =>
            prev.map((m) => {
              if (m.permissionId === resolvedId) return { ...m, permissionResolved: true };
              if (m.askId === resolvedId) return { ...m, askResolved: true };
              if (m.planId === resolvedId) return { ...m, planResolved: true };
              return m;
            }),
          );
        }
        return;
      }

      if (type === "interrupted") {
        // Server was restarted while this session was mid-turn. Surface
        // a one-shot system message so the user knows their last query
        // was cut short. lastUserMessage may be empty for very fresh
        // sessions where nothing was persisted yet.
        const lastMsg = typeof evt.lastUserMessage === "string" ? evt.lastUserMessage : "";
        setMessages((prev) => {
          // Dedup — if the user already has an "interrupted" system
          // message as the most recent entry, don't add another.
          const last = prev[prev.length - 1];
          if (last && last.type === "error" && last.content.startsWith("[interrupted]")) {
            return prev;
          }
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "system" as const,
              type: "error" as const,
              content: lastMsg
                ? `[interrupted] The server restarted mid-turn. Your last message was: "${lastMsg.slice(0, 140)}${lastMsg.length > 140 ? "…" : ""}". Click Send again to resume, or start a new one.`
                : "[interrupted] The server restarted mid-turn — previous turn lost. Send your next message to continue.",
              timestamp: Date.now(),
            },
          ];
        });
        setStatus("idle");
        return;
      }

      if (type === "plan_proposal") {
        const planId = evt.id as string;
        if (resolvedPermissionsRef.current.has(planId)) {
          // Already resolved in a previous tab / page load — skip replay.
          return;
        }
        currentAssistantRef.current = null;
        setStatus("awaiting_permission");
        setMessages((prev) => {
          if (prev.some((m) => m.planId === planId)) return prev;
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "system" as const,
              type: "plan_proposal" as const,
              content: "",
              planId,
              planContent: (evt.plan as string) || "",
              planResolved: false,
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
        // If the response came through a non-streamed path (no text_delta events),
        // no assistant message was created during streaming. Create it now from evt.text.
        if (!evt.isError && evt.text && !currentAssistantRef.current) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              type: "text" as const,
              content: evt.text as string,
              timestamp: Date.now(),
            },
          ]);
        }
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

      if (type === "context_usage") {
        setContextUsage({
          used: (evt.used as number) || 0,
          max: (evt.max as number) || 0,
          percentage: (evt.percentage as number) || 0,
        });
        return;
      }

      if (type === "auth_required") {
        // Anthropic-side 401 — the SDK's OAuth token is stale. Surface
        // a dedicated banner instead of dumping the raw error blob so
        // the user knows to re-run `claude auth login` (or open the
        // Claude Code overlay and auth from the sidebar) rather than
        // chasing a non-existent bug.
        currentAssistantRef.current = null;
        currentThinkingRef.current = null;
        setActiveTool(null);
        setStatus("idle");
        setAuthRequired({
          message: (evt.message as string) || "Claude auth expired.",
          hint:
            (evt.hint as string) ||
            "Run `claude auth login` in the settings terminal.",
        });
        return;
      }

      if (type === "setup_required") {
        currentAssistantRef.current = null;
        currentThinkingRef.current = null;
        setActiveTool(null);
        setStatus("idle");
        setSetupRequired(true);
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

  /* ── Load/persist resolved-permission IDs per session ── */
  const resolvedStorageKey = sessionId ? `claw-chat-resolved:v1:${sessionId}` : null;

  const persistResolved = useCallback(() => {
    if (!resolvedStorageKey) return;
    try {
      sessionStorage.setItem(
        resolvedStorageKey,
        JSON.stringify(Array.from(resolvedPermissionsRef.current)),
      );
    } catch {
      /* storage full / private mode — degrade gracefully */
    }
  }, [resolvedStorageKey]);

  // Hydrate resolved set when sessionId changes (new chat / load chat).
  useEffect(() => {
    if (!resolvedStorageKey) {
      resolvedPermissionsRef.current = new Set();
      return;
    }
    try {
      const raw = sessionStorage.getItem(resolvedStorageKey);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        resolvedPermissionsRef.current = new Set(Array.isArray(arr) ? arr : []);
      } else {
        resolvedPermissionsRef.current = new Set();
      }
    } catch {
      resolvedPermissionsRef.current = new Set();
    }
  }, [resolvedStorageKey]);

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

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    // The httpOnly session cookie is sent automatically by the browser.
    // Also pass the access token as query param fallback.
    const accessToken = getAccessToken();
    const tokenParam = accessToken ? `&token=${encodeURIComponent(accessToken)}` : "";
    const cwdParam = sessionCwd ? `&cwd=${encodeURIComponent(sessionCwd)}` : "";
    const wsUrl = `${proto}//${window.location.host}/chat/ws/chat?session=${encodeURIComponent(sessionId)}${tokenParam}${cwdParam}`;
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
          scheduleReconnectRef.current();
        }
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror, so reconnection is handled there
    };
  }, [sessionId, sessionCwd, handleEvent]);

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

  // Keep ref in sync so connect's onclose handler uses the latest scheduleReconnect.
  useEffect(() => {
    scheduleReconnectRef.current = scheduleReconnect;
  }, [scheduleReconnect]);

  /* ── Send user message ── */
  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // Allow send while "connecting" — the most common case where
      // a user hits send on a brand-new chat before the WS has finished
      // its handshake. The "ready" handler flushes pendingSendsRef.
      // Disallow only when a turn is already streaming / a tool is
      // running / waiting for input.
      const blocking =
        status === "thinking" ||
        status === "tool_running" ||
        status === "awaiting_permission" ||
        status === "awaiting_input";
      if (blocking) return;

      // Optimistic UI — user sees their message immediately whether or
      // not the socket is up.
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

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        setStatus("thinking");
        sendToServer({ type: "message", text: trimmed });
      } else {
        // Buffer — the "ready" handler will drain this once the server
        // says hello.
        pendingSendsRef.current.push(trimmed);
      }
    },
    [status, sendToServer],
  );

  /* ── Plan-proposal response ── */
  const respondPlan = useCallback(
    (
      planId: string,
      approve: boolean,
      opts?: { newMode?: "default" | "acceptEdits"; message?: string },
    ) => {
      sendToServer({
        type: "plan_response",
        id: planId,
        approve,
        newMode: opts?.newMode,
        message: opts?.message,
      });
      resolvedPermissionsRef.current.add(planId);
      persistResolved();

      const outcome: NonNullable<ChatMessage["planOutcome"]> = approve
        ? opts?.newMode === "default"
          ? "approved_default"
          : "approved_accept_edits"
        : "rejected";

      setMessages((prev) =>
        prev.map((m) =>
          m.planId === planId
            ? {
                ...m,
                planResolved: true,
                planOutcome: outcome,
                planMessage: opts?.message,
              }
            : m,
        ),
      );
    },
    [sendToServer, persistResolved],
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

      // Remember locally so a subsequent refresh doesn't re-show this
      // prompt if the server's eventHistory replay still contains it
      // (e.g. during a server restart that wiped pendingRequests but
      // the client caught the request in-flight).
      resolvedPermissionsRef.current.add(permissionId);
      persistResolved();

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
    (askId: string, answers: Record<string, string | string[]>) => {
      sendToServer({ type: "ask_response", id: askId, answers });
      resolvedPermissionsRef.current.add(askId);
      persistResolved();
      setMessages((prev) => prev.map((m) => (m.askId === askId ? { ...m, askResolved: true } : m)));
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

  /* ── Stop generation ── */
  const stopGeneration = useCallback(() => {
    sendToServer({ type: "stop" });
    setStatus("idle");
    setActiveTool(null);
    currentAssistantRef.current = null;
    currentThinkingRef.current = null;
  }, [sendToServer]);

  const clearAuthRequired = useCallback(() => setAuthRequired(null), []);

  return {
    messages,
    status,
    activeTool,
    claudeSessionId,
    setupRequired,
    authRequired,
    clearAuthRequired,
    contextUsage,
    sendMessage,
    stopGeneration,
    respondPermission,
    respondQuestion,
    respondPlan,
    setPermissionMode,
    setEffort,
    reconnect,
    setInitialMessages,
    setInitialContextUsage,
  };
}
