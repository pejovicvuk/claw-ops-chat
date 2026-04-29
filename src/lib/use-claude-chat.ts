"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAccessToken } from "@/lib/apiClient";
import type { ChatMessage, ClaudeStatus, ActiveToolInfo } from "@/lib/types";

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
  const [authRequired, setAuthRequired] = useState<{ message: string; hint: string } | null>(null);
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
        // Transient in-memory guard — the server normally purges resolved
        // prompts from eventHistory before replay, but a millisecond-level
        // race during a flaky reconnect can still surface a prompt we
        // already answered. The set is per-connection and per-session,
        // not persisted; cross-device truth lives in `pending_approvals`.
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

      if (type === "pending_approvals") {
        // Authoritative snapshot of currently-pending approval / plan / ask
        // prompts from the server. Sent on every connect. Treated as a
        // setter, not an appender:
        //   • Anything we have locally that the server says is no longer
        //     pending → mark resolved. Covers "another device answered
        //     while we were disconnected."
        //   • Anything the server says is pending that we don't have →
        //     add it. Covers fresh-connect / second-device-mid-flow / the
        //     race window where a live broadcast was missed.
        const approvals = Array.isArray(evt.approvals)
          ? (evt.approvals as Array<Record<string, unknown>>)
          : [];
        const incomingIds = new Set<string>();
        for (const a of approvals) {
          const aid = a.id;
          if (typeof aid === "string") incomingIds.add(aid);
        }

        setMessages((prev) => {
          let next = prev.map((m) => {
            if (
              m.type === "permission_request" &&
              !m.permissionResolved &&
              m.permissionId &&
              !incomingIds.has(m.permissionId)
            ) {
              return { ...m, permissionResolved: true };
            }
            if (
              m.type === "plan_proposal" &&
              !m.planResolved &&
              m.planId &&
              !incomingIds.has(m.planId)
            ) {
              return { ...m, planResolved: true };
            }
            if (
              m.type === "ask_question" &&
              !m.askResolved &&
              m.askId &&
              !incomingIds.has(m.askId)
            ) {
              return { ...m, askResolved: true };
            }
            return m;
          });

          for (const a of approvals) {
            const aid = a.id as string;
            if (next.some((m) => m.permissionId === aid || m.planId === aid || m.askId === aid)) {
              continue;
            }
            const aType = a.type as string;
            if (aType === "permission_request") {
              next = [
                ...next,
                {
                  id: crypto.randomUUID(),
                  role: "system" as const,
                  type: "permission_request" as const,
                  content: (a.description as string) || "",
                  toolName: a.toolName as string,
                  permissionId: aid,
                  permissionInput: a.input as Record<string, unknown>,
                  permissionResolved: false,
                  timestamp: Date.now(),
                },
              ];
            } else if (aType === "plan_proposal") {
              next = [
                ...next,
                {
                  id: crypto.randomUUID(),
                  role: "system" as const,
                  type: "plan_proposal" as const,
                  content: "",
                  planId: aid,
                  planContent: (a.plan as string) || "",
                  planResolved: false,
                  timestamp: Date.now(),
                },
              ];
            } else if (aType === "ask_question") {
              next = [
                ...next,
                {
                  id: crypto.randomUUID(),
                  role: "system" as const,
                  type: "ask_question" as const,
                  content: "",
                  askId: aid,
                  askQuestions: a.questions as ChatMessage["askQuestions"],
                  askResolved: false,
                  timestamp: Date.now(),
                },
              ];
            }
          }
          return next;
        });

        if (approvals.length > 0) {
          const last = approvals[approvals.length - 1];
          setStatus(last.type === "ask_question" ? "awaiting_input" : "awaiting_permission");
        }
        return;
      }

      if (type === "plan_proposal") {
        const planId = evt.id as string;
        if (resolvedPermissionsRef.current.has(planId)) {
          // Transient in-connection dedup against live + replay race.
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
        // New chat just got a real id — carry the user's current mode
        // and effort choices onto the real key and clear the transient slot.
        localStorage.setItem(modeStorageKey(sessionId), permissionMode);
        localStorage.removeItem(modeStorageKey(null));
        localStorage.setItem(effortStorageKey(sessionId), effort ?? "");
        localStorage.removeItem(effortStorageKey(null));
      } else {
        // Switched to a different session — load its persisted mode + effort.
        const saved = localStorage.getItem(modeStorageKey(sessionId)) || "default";
        setPermissionModeState(saved);
        const savedEffort = localStorage.getItem(effortStorageKey(sessionId)) || null;
        setEffortState(savedEffort);
      }
    } catch {
      /* ignore storage failures */
    }
    // permissionMode / effort intentionally omitted — we only need their
    // values at the moment the session id transitions, and including them
    // would cause this effect to rerun on every toolbar change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

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
    sessionStartedAt,
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
