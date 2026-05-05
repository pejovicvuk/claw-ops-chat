"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAccessToken } from "@/lib/apiClient";
import { authFetch } from "@/lib/auth";
import type { ChatMessage, ClaudeStatus, ActiveToolInfo } from "@/lib/types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

/** Max reconnection delay in ms. */
const MAX_RECONNECT_DELAY = 30_000;
/** Base reconnection delay in ms. */
const BASE_RECONNECT_DELAY = 1_000;

/** Per-session localStorage key for the toolbar's permission mode. */
function modeStorageKey(sessionId: string | null): string {
  return sessionId ? `claw-chat-mode:${sessionId}:v1` : "claw-chat-mode:new:v1";
}

/** Per-session localStorage key for the toolbar's effort level. Empty string means Auto. */
function effortStorageKey(sessionId: string | null): string {
  return sessionId ? `claw-chat-effort:${sessionId}:v1` : "claw-chat-effort:new:v1";
}

/** Per-session localStorage key for the chat's model override. Empty string means Auto (SDK default). */
function modelStorageKey(sessionId: string | null): string {
  return sessionId ? `claw-chat-model:${sessionId}:v1` : "claw-chat-model:new:v1";
}

export interface ContextUsage {
  used: number;
  max: number;
  percentage: number;
  /** Model ID from the SDK's modelUsage / assistant message (added on every event). */
  model?: string | null;
  /** Token breakdowns — added alongside totals so the HUD can compute cost. */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
}

export function useClaudeChat(sessionId: string | null, sessionCwd?: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ClaudeStatus>("disconnected");
  const [activeTool, setActiveTool] = useState<ActiveToolInfo | null>(null);
  const [claudeSessionId, setClaudeSessionId] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [authRequired, setAuthRequired] = useState<{
    message: string;
    hint: string;
    reason?: "token_expired" | "subscription_expired";
  } | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  // Per-session permission mode, persisted under modeStorageKey(sessionId).
  // `default` when the session is fresh / localStorage is empty.
  const [permissionMode, setPermissionModeState] = useState<string>(() => {
    if (typeof window === "undefined") return "default";
    try {
      return localStorage.getItem(modeStorageKey(sessionId)) || "default";
    } catch {
      return "default";
    }
  });
  // Per-session Claude effort level ("low" | "medium" | "high" | "xhigh" |
  // "max" | null). null means Auto (adaptive thinking). Persisted under
  // effortStorageKey(sessionId); empty string in storage round-trips to null.
  const [effort, setEffortState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(effortStorageKey(sessionId)) || null;
    } catch {
      return null;
    }
  });
  // Per-session model family override ("opus" | "sonnet" | "haiku" | null).
  // null means Auto = let the SDK pick the subscription default. Persisted
  // under modelStorageKey(sessionId); the empty string in storage round-trips
  // to null exactly like effort.
  const [model, setModelState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(modelStorageKey(sessionId)) || null;
    } catch {
      return null;
    }
  });
  // Monotonic timestamp for the HUD's "Elapsed" counter. Seeded when the
  // WS connects for this session; cleared on session switch.
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);

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
  const setInitialContextUsage = useCallback((usage: ContextUsage | null) => {
    setContextUsage(usage);
  }, []);

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
        // No pending-send buffer to flush — every send goes through
        // /api/chat/send (HTTP POST + keepalive) so the message is
        // delivered server-side before any WS handshake completes.
        // The WS only carries the streaming response back to the client.
        return;
      }

      if (type === "session_init") {
        setClaudeSessionId(evt.sessionId as string);
        // First activity for this tab — seed the HUD's elapsed clock. Already
        // running? Leave it alone so subsequent init events (e.g. a mid-turn
        // resume after a WS hiccup) don't reset the counter.
        setSessionStartedAt((prev) => prev ?? Date.now());
        return;
      }

      if (type === "mode_changed") {
        // Authoritative mode update from the server (e.g. after ExitPlanMode
        // approval flips plan → acceptEdits). Update local state + persist
        // without echoing `set_mode` back, or we'd loop.
        const mode = typeof evt.mode === "string" ? evt.mode : "default";
        setPermissionModeState(mode);
        try {
          localStorage.setItem(modeStorageKey(sessionId), mode);
        } catch {
          /* ignore storage errors */
        }
        return;
      }

      if (type === "effort_changed") {
        // Authoritative effort update from the server — echoed back from
        // our own `set_effort` or originated in another tab for this
        // session. Mirrors `mode_changed`: update local state + persist,
        // don't round-trip.
        const next = typeof evt.effort === "string" && evt.effort ? evt.effort : null;
        setEffortState(next);
        try {
          localStorage.setItem(effortStorageKey(sessionId), next ?? "");
        } catch {
          /* ignore storage errors */
        }
        return;
      }

      if (type === "model_changed") {
        // Authoritative model update from the server. Mirrors
        // `effort_changed` exactly: server echoes our own `set_model` and
        // also broadcasts when another tab on this session changes it,
        // so we just sync local state + persist.
        const next = typeof evt.model === "string" && evt.model ? evt.model : null;
        setModelState(next);
        try {
          localStorage.setItem(modelStorageKey(sessionId), next ?? "");
        } catch {
          /* ignore storage errors */
        }
        return;
      }

      if (type === "turn_start") {
        // Fresh turn — reset the streaming refs so the first text_delta /
        // thinking_delta creates new messages instead of appending to the
        // previous turn's tail.
        currentAssistantRef.current = null;
        currentThinkingRef.current = null;
        setActiveTool(null);
        return;
      }

      if (type === "turn_end") {
        // The `result` handler already finalises status/refs. This event
        // exists so the UI timeline can pin a closing marker; for the
        // current flat-message renderer there's nothing to do.
        return;
      }

      if (type === "compact_boundary") {
        // SDK just compacted the context window. Surface a subtle system
        // line so the user understands why the context counter jumped.
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "system" as const,
            type: "error" as const,
            content: "[context compacted]",
            timestamp: Date.now(),
          },
        ]);
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
        } else if (evt.text) {
          // Always show the result text (e.g. "Stopped by user") as a neutral
          // system notice rather than a plain assistant bubble — it signals a
          // session-end event, not Claude-authored content.
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "system" as const,
              type: "stopped" as const,
              content: evt.text as string,
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
          model: (evt.model as string | null | undefined) ?? null,
          inputTokens: (evt.inputTokens as number) || 0,
          outputTokens: (evt.outputTokens as number) || 0,
          cacheReadTokens: (evt.cacheReadTokens as number) || 0,
          cacheCreateTokens: (evt.cacheCreateTokens as number) || 0,
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
          hint: (evt.hint as string) || "Run `claude auth login` in the settings terminal.",
          reason:
            (evt.reason as "token_expired" | "subscription_expired" | undefined) ?? "token_expired",
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
        const msg = (evt.message as string) || "Bridge error";
        // If the raw error looks like an auth failure (the server's detection
        // may miss edge-case error formats), redirect to the amber banner flow
        // rather than dumping the raw JSON blob into the chat.
        const looksLikeAuth =
          msg.toLowerCase().includes("authentication_error") ||
          msg.toLowerCase().includes("invalid authentication") ||
          msg.toLowerCase().includes("failed to authenticate") ||
          /\b401\b/.test(msg);
        if (looksLikeAuth) {
          setAuthRequired({
            message: "Claude authentication failed. Your token may have expired.",
            hint: "Run `claude auth login` in the settings terminal, or click below.",
          });
          return;
        }
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "system" as const,
            type: "error" as const,
            content: msg,
            timestamp: Date.now(),
          },
        ]);
        return;
      }
    },
    [upsertAssistantText, sessionId],
  );

  /* ── Send JSON to server via WebSocket ── */
  const sendToServer = useCallback((obj: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(obj));
    }
  }, []);

  // Reset the in-memory resolved set when the active session changes —
  // the set is purely a transient guard against the same prompt arriving
  // twice within a single connection (e.g. live broadcast races the
  // history replay milliseconds apart). The server's `pending_approvals`
  // snapshot is the cross-tab / cross-device source of truth, so we
  // intentionally do not persist this set anywhere.
  useEffect(() => {
    resolvedPermissionsRef.current = new Set();
  }, [sessionId]);

  /* ── Per-session mode + elapsed-timer sync ── */
  // Remember the last sessionId we saw so we can detect the "null → real"
  // transition when the SDK assigns an id to a brand-new chat. In that case
  // we migrate the transient "new" mode slot onto the real id rather than
  // silently resetting to default.
  const prevSessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    const prev = prevSessionIdRef.current;
    prevSessionIdRef.current = sessionId;
    if (prev === sessionId) return;
    // Session swap → reset the HUD elapsed timer; session_init on the new
    // socket will reseed it.
    setSessionStartedAt(null);
    try {
      if (prev === null && sessionId !== null) {
        // New chat just got a real id — carry the user's current mode,
        // effort and model choices onto the real key and clear the
        // transient "new" slot.
        localStorage.setItem(modeStorageKey(sessionId), permissionMode);
        localStorage.removeItem(modeStorageKey(null));
        localStorage.setItem(effortStorageKey(sessionId), effort ?? "");
        localStorage.removeItem(effortStorageKey(null));
        localStorage.setItem(modelStorageKey(sessionId), model ?? "");
        localStorage.removeItem(modelStorageKey(null));
      } else {
        // Switched to a different session — load its persisted mode,
        // effort and model.
        const saved = localStorage.getItem(modeStorageKey(sessionId)) || "default";
        setPermissionModeState(saved);
        const savedEffort = localStorage.getItem(effortStorageKey(sessionId)) || null;
        setEffortState(savedEffort);
        const savedModel = localStorage.getItem(modelStorageKey(sessionId)) || null;
        setModelState(savedModel);
      }
    } catch {
      /* ignore storage failures */
    }
    // permissionMode / effort intentionally omitted — we only need their
    // values at the moment the session id transitions, and including them
    // would cause this effect to rerun on every toolbar change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  /* ── Reset transient per-turn state when switching sessions ── */
  // Previously the parent component remounted ChatView via `key={sessionId}`
  // which reset everything for free — but caused a visible blank-out flash
  // between unmount and the new history fetch. Now ChatView stays mounted
  // and we explicitly null out the bits that are scoped to a single turn:
  // the in-flight assistant message id, tool indicator, claudeSessionId,
  // context usage, and auth/setup banners. `messages` is intentionally
  // left alone — chat-view's history fetch calls `setInitialMessages` on
  // success which atomically swaps in the new chat's messages with no
  // intermediate empty state, so the user perceives a clean cross-fade
  // instead of a flash to blank.
  //
  // The reset runs DURING RENDER (React's "store info from previous
  // renders" pattern) rather than in an effect. Why: chat-view's
  // onSessionCreated notification effect inspects (claudeSessionId,
  // sessionId) — if the reset waits until after commit, that effect
  // fires once with the *previous* session's claudeSessionId paired
  // with the new sessionId, mistakes it for "the SDK just promoted a
  // fresh chat", and fires `onSessionCreated(<prev id>)` — which calls
  // `setParam("chat", <prev id>)` and snaps the URL back to the chat
  // the user just left. By resetting synchronously, the notify effect
  // commits with claudeSessionId === null on every session swap and
  // the spurious notification can't fire.
  const [prevSessionIdForReset, setPrevSessionIdForReset] = useState(sessionId);
  if (prevSessionIdForReset !== sessionId) {
    setPrevSessionIdForReset(sessionId);
    setActiveTool(null);
    setClaudeSessionId(null);
    setContextUsage(null);
    setAuthRequired(null);
    setSetupRequired(false);
    currentAssistantRef.current = null;
    currentThinkingRef.current = null;
  }

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
      // Block while re-authentication is required — sending with broken
      // credentials just queues more failures and duplicates messages.
      if (authRequired !== null) return;
      // Allow send while "connecting" — the most common case where
      // a user hits send on a brand-new chat before the WS has finished
      // its handshake. The HTTP POST below is what actually delivers it.
      // Disallow only when a turn is already streaming / a tool is
      // running / waiting for input.
      const blocking =
        status === "thinking" ||
        status === "tool_running" ||
        status === "awaiting_permission" ||
        status === "awaiting_input";
      if (blocking) return;
      if (!sessionId) return;

      // Optimistic UI — user sees their message immediately even if the
      // tab is about to close. Capture the id so we can remove the bubble
      // if the HTTP delivery itself fails (e.g. Spring session expired).
      const optimisticId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        {
          id: optimisticId,
          role: "user" as const,
          type: "text" as const,
          content: trimmed,
          timestamp: Date.now(),
        },
      ]);

      currentAssistantRef.current = null;
      currentThinkingRef.current = null;
      setActiveTool(null);
      setStatus("thinking");

      // Deliver via HTTP POST with `keepalive: true` so the request
      // survives tab-close / navigation. The browser keeps the request
      // alive in the background until it completes (up to 64 KB body,
      // which our messages are well under). This replaces the previous
      // ws.send() path which was vulnerable to two race conditions:
      //   (a) message buffered in pendingSendsRef while the WS handshake
      //       was still in flight — lost on unmount.
      //   (b) ws.send() called but the bytes hadn't been flushed by the
      //       browser when the user navigated away.
      // The streaming response still arrives over the WebSocket — when
      // the user reopens the chat (or switches tabs), the server replays
      // eventHistory so they pick up wherever the SDK got to.
      const clientMessageId = crypto.randomUUID();
      authFetch(`${BASE}/api/chat/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          text: trimmed,
          clientMessageId,
          sessionCwd: sessionCwd ?? null,
        }),
        keepalive: true,
      })
        .then((resp) => {
          if (resp.status === 401) {
            // The app session (Spring JWT) has expired — the message never
            // reached the Claude server. Remove the optimistic bubble and
            // prompt the user to log in again.
            setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "system" as const,
                type: "error" as const,
                content: "Your app session has expired. Please log in again.",
                timestamp: Date.now(),
              },
            ]);
            setStatus("idle");
          }
        })
        .catch(() => {
          // keepalive guarantees the browser tries; surface failures to the
          // user only if we're still mounted (otherwise nothing to show).
          // The optimistic message stays in the list — server-side rate
          // limit / idempotency rejection is rare and will manifest as the
          // assistant simply never replying. A retry button on a stuck
          // message could be added later if this proves common.
        });
    },
    [status, sessionId, sessionCwd, authRequired],
  );

  /* ── Plan-proposal response ── */
  const respondPlan = useCallback(
    (
      planId: string,
      approve: boolean,
      opts?: { newMode?: "default" | "acceptEdits" | "auto"; message?: string },
    ) => {
      sendToServer({
        type: "plan_response",
        id: planId,
        approve,
        newMode: opts?.newMode,
        message: opts?.message,
      });
      resolvedPermissionsRef.current.add(planId);

      const outcome: NonNullable<ChatMessage["planOutcome"]> = approve
        ? opts?.newMode === "default"
          ? "approved_default"
          : opts?.newMode === "auto"
            ? "approved_auto"
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
    [sendToServer],
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

      // In-memory dedup so a milliseconds-apart live broadcast and
      // history replay during a flaky reconnect can't re-surface the
      // prompt we just answered. Cross-tab / cross-device truth comes
      // from the server's `permission_resolved` broadcast and the
      // `pending_approvals` snapshot on connect — no need to persist.
      resolvedPermissionsRef.current.add(permissionId);

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
      setMessages((prev) => prev.map((m) => (m.askId === askId ? { ...m, askResolved: true } : m)));
      setStatus("thinking");
    },
    [sendToServer],
  );

  /* ── Mode & effort ── */
  const setPermissionMode = useCallback(
    (mode: string) => {
      // Optimistic local update so the toolbar responds instantly, then
      // ship the change to the server and persist under the per-session
      // localStorage key. Server will echo back a `mode_changed` event —
      // the handler above is idempotent so the round-trip is a no-op.
      setPermissionModeState(mode);
      try {
        localStorage.setItem(modeStorageKey(sessionId), mode);
      } catch {
        /* ignore */
      }
      sendToServer({ type: "set_mode", mode });
    },
    [sendToServer, sessionId],
  );

  const setEffort = useCallback(
    (next: string | null) => {
      // Mirror setPermissionMode: optimistic local update + persist, then
      // ship to the server. The `effort_changed` echo handler above is
      // idempotent so the round-trip doesn't loop.
      setEffortState(next);
      try {
        localStorage.setItem(effortStorageKey(sessionId), next ?? "");
      } catch {
        /* ignore */
      }
      sendToServer({ type: "set_effort", effort: next });
    },
    [sendToServer, sessionId],
  );

  const setModel = useCallback(
    (next: string | null) => {
      // Identical pattern to setEffort: optimistic local + persist + ship,
      // server echoes `model_changed` which our handler treats as a no-op.
      setModelState(next);
      try {
        localStorage.setItem(modelStorageKey(sessionId), next ?? "");
      } catch {
        /* ignore */
      }
      sendToServer({ type: "set_model", model: next });
    },
    [sendToServer, sessionId],
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
    permissionMode,
    effort,
    model,
    sessionStartedAt,
    sendMessage,
    stopGeneration,
    respondPermission,
    respondQuestion,
    respondPlan,
    setPermissionMode,
    setEffort,
    setModel,
    reconnect,
    setInitialMessages,
    setInitialContextUsage,
  };
}
