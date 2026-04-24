"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FiArrowLeft,
  FiShield,
  FiChevronDown,
  FiFolder,
  FiMessageCircle,
  FiAlertTriangle,
} from "react-icons/fi";
import { useClaudeChat } from "@/lib/use-claude-chat";
import { useIsMobile } from "@/lib/use-is-mobile";
import { useVisualViewport } from "@/lib/use-visual-viewport";
import { useUrlState } from "@/lib/use-url-state";
import { useComposerAttachments } from "@/lib/use-composer-attachments";
import { fetchSessionMessages } from "@/lib/api";
import type { UploadEntry } from "@/lib/batch-upload";
import { StatusIndicator } from "./status-indicator";
import { ContextIndicator } from "./context-indicator";
import { HudIndicator } from "./hud-indicator";
import { HudPopup } from "./hud-popup";
import { MessageBubble } from "./message-bubble";
import { ChatInput } from "./chat-input";
import { SetupGuard } from "./setup-guard";
import { EmptyState } from "./empty-state";
import { FileDropzone } from "./file-browser/file-dropzone";

const MODE_LABELS: Record<string, string> = {
  default: "Default",
  acceptEdits: "Accept Edits",
  plan: "Plan Mode",
  auto: "Auto",
};

const MODE_OPTIONS = [
  { value: "default", label: "Default", description: "Ask before edits and commands" },
  { value: "acceptEdits", label: "Accept Edits", description: "Auto-approve file edits" },
  { value: "plan", label: "Plan Mode", description: "Plan only, no changes" },
  { value: "auto", label: "Auto", description: "Model classifier decides (SDK)" },
];

const EFFORT_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Med" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

const STATUS_LABELS: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting...",
  idle: "Ready",
  thinking: "Thinking...",
  tool_running: "Running tool...",
  awaiting_permission: "Needs approval",
  awaiting_input: "Needs your input",
};

/** Playful gerunds used in place of plain "Thinking..." in the live
    activity indicator. One is picked at random each time Claude enters the
    thinking state, so successive turns surface different ones. */
const THINKING_VERBS: string[] = [
  "Coombobuling",
  "Discombobulating",
  "Bamboozling",
  "Flimflamming",
  "Jiggery-pokering",
  "Finagling",
  "Hoodwinking",
  "Noodling",
  "Kerfuffling",
  "Gallivanting",
  "Conjuring nonsense",
  "Unraveling codswallop",
  "Wrangling shenanigans",
  "Dabbling",
  "Befuddling",
  "Hornswoggling",
];

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface ChatViewProps {
  sessionId: string;
  resumeSessionId?: string | null;
  onBack?: () => void;
  headerless?: boolean;
  onSessionCreated?: (claudeSessionId: string) => void;
  /** Mobile-only: when provided, the Mode/Effort bar shows a chat-list
      icon at the start that invokes this. Merges two stacked toolbars
      into one on narrow viewports. */
  onOpenSessions?: () => void;
  /** Mobile-only: opens the Files panel. Mirrors `onOpenSessions` but at
      the opposite end of the Mode/Effort bar. */
  onOpenFiles?: () => void;
}

export function ChatView({
  sessionId,
  resumeSessionId,
  onBack,
  headerless,
  onSessionCreated,
  onOpenSessions,
  onOpenFiles,
}: ChatViewProps) {
  const isMobile = useIsMobile();
  const [sessionCwd, setSessionCwd] = useState<string | null>(null);
  const {
    messages,
    status,
    activeTool,
    claudeSessionId,
    sendMessage,
    stopGeneration,
    setupRequired,
    authRequired,
    clearAuthRequired,
    contextUsage,
    permissionMode,
    effort,
    respondPermission,
    respondQuestion,
    respondPlan,
    setPermissionMode,
    setEffort,
    reconnect,
    setInitialMessages,
    setInitialContextUsage,
  } = useClaudeChat(sessionId, sessionCwd);
  const notifiedSessionRef = useRef<string | null>(null);
  const { setParam } = useUrlState();
  const { viewportHeight } = useVisualViewport();

  // Attachments live here (not in ChatInput) so drops on the whole chat
  // pane feed the same list as the paperclip button.
  const composerAttachments = useComposerAttachments();
  const handlePanelDrop = useCallback(
    (entries: UploadEntry[]) => {
      // Flatten folders to a flat file list — the composer only shows a
      // flat attachment row; preserving folder structure isn't useful for
      // referencing (each file is independently `@-mentioned`).
      return composerAttachments.addFiles(entries.map((e) => e.file));
    },
    [composerAttachments],
  );

  // Auto-open the Claude Code sign-in panel on the rising edge of
  // `authRequired`. The server emits that event when Anthropic's API
  // returns 401 inside a turn — the user almost always wants to
  // re-auth right now, so pushing them straight to the right settings
  // page beats the old copy that told them to manually navigate to
  // "Settings → Terminal". The ref gates the effect to the transition
  // from null → non-null so re-renders during an active expired state
  // don't keep re-opening the panel.
  const prevAuthRequiredRef = useRef<boolean>(false);
  useEffect(() => {
    const isActive = !!authRequired;
    if (isActive && !prevAuthRequiredRef.current) {
      setParam("settings", "connections/claude");
    }
    prevAuthRequiredRef.current = isActive;
  }, [authRequired, setParam]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  // Stagger first-load history messages only; new streaming messages animate
  // without delay. Set captured once when loadingHistory flips false.
  const historyIdsRef = useRef<string[]>([]);
  const capturedHistoryRef = useRef(false);
  const [loadingHistory, setLoadingHistory] = useState(!!resumeSessionId);
  const [showModeMenu, setShowModeMenu] = useState(false);
  // Pre-fills the composer from empty-state suggestion chips. The seq
  // version bumps on every click so ChatInput's effect re-runs even when
  // the user clicks the same chip twice.
  const [draft, setDraft] = useState<{ text: string; seq: number }>({ text: "", seq: 0 });
  const handleSuggestionClick = useCallback((text: string) => {
    setDraft((prev) => ({ text, seq: prev.seq + 1 }));
  }, []);
  const [openPopup, setOpenPopup] = useState<"status" | "context" | "hud" | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  // Funny "thinking" verb — rerolled each time status enters `thinking`
  // from another state so every turn shows a fresh gerund. Lazy init picks
  // the first one at mount so there's no blank flash on the very first turn.
  const [thinkingVerb, setThinkingVerb] = useState<string>(
    () => THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)],
  );
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (status === "thinking" && prevStatusRef.current !== "thinking") {
      setThinkingVerb(THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)]);
    }
    prevStatusRef.current = status;
  }, [status]);
  const [infoMessages, setInfoMessages] = useState<
    Array<{ id: string; content: string; timestamp: number }>
  >([]);
  const bridgeSyncedRef = useRef(false);

  // Outside-click dismissal for indicator popups.
  useEffect(() => {
    if (!openPopup) return;
    function handleClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setOpenPopup(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openPopup]);

  /* Notify parent when SDK creates a new session (so page can update selected session) */
  useEffect(() => {
    if (claudeSessionId && claudeSessionId !== notifiedSessionRef.current) {
      notifiedSessionRef.current = claudeSessionId;
      onSessionCreated?.(claudeSessionId);
    }
  }, [claudeSessionId, onSessionCreated]);

  // On the first `idle` after reconnect, push our remembered per-session
  // mode to the server so a container restart doesn't land the session in
  // "default" when the toolbar still shows Plan or Auto.
  useEffect(() => {
    if (status === "idle" && !bridgeSyncedRef.current) {
      bridgeSyncedRef.current = true;
      if (permissionMode !== "default") {
        setPermissionMode(permissionMode);
      }
    }
  }, [status, permissionMode, setPermissionMode]);

  // Keyboard parity with the Claude Code CLI: Shift+Tab cycles modes,
  // Esc interrupts while Claude is working. Ignored while a text input
  // / textarea is focused so message composition isn't disrupted.
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      // Shift+Tab → cycle default → plan → acceptEdits → auto → default
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        const order = ["default", "plan", "acceptEdits", "auto"] as const;
        const idx = order.indexOf(permissionMode as (typeof order)[number]);
        const next = order[(idx + 1) % order.length] ?? "default";
        setPermissionMode(next);
        setInfoMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            content: `Mode: ${MODE_LABELS[next] ?? next}`,
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      // Esc → stop Claude mid-turn
      if (e.key === "Escape" && (status === "thinking" || status === "tool_running")) {
        e.preventDefault();
        stopGeneration();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [permissionMode, setPermissionMode, status, stopGeneration]);

  useEffect(() => {
    if (!resumeSessionId) return;
    let cancelled = false;
    fetchSessionMessages(resumeSessionId)
      .then((data) => {
        if (!cancelled) {
          setInitialMessages(data.messages);
          setInitialContextUsage(data.contextUsage);
          setSessionCwd(data.sessionCwd);
          setLoadingHistory(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resumeSessionId, setInitialMessages, setInitialContextUsage]);

  useEffect(() => {
    if (userScrolledUpRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, infoMessages]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    userScrolledUpRef.current = !atBottom;
  };

  /** Memoized sorted merge of chat messages and info messages. */
  const sortedMessages = useMemo(() => {
    const infoAsMsgs = infoMessages.map((m) => ({
      ...m,
      role: "system" as const,
      type: "text" as const,
      _isInfo: true,
    }));
    return [...messages.map((m) => ({ ...m, _isInfo: false })), ...infoAsMsgs].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
  }, [messages, infoMessages]);

  /** Find the ID of the latest tool_use message (for live activity indicator). */
  const latestToolUseId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === "tool_use") return messages[i].id;
    }
    return null;
  }, [messages]);

  /**
   * Map toolCallId → matching tool_use message so ToolResultBlock can
   * render per-tool previews (e.g. inline image for Read, unfurl card
   * for WebFetch) without re-scanning the message list.
   */
  const toolUseByCallId = useMemo(() => {
    const map = new Map<string, (typeof messages)[number]>();
    for (const m of messages) {
      if (m.type === "tool_use" && m.toolCallId) map.set(m.toolCallId, m);
    }
    return map;
  }, [messages]);

  // Capture the first-load snapshot once — these IDs get staggered animation
  // delays on mount. Post-capture arrivals (streaming) animate without delay.
  useEffect(() => {
    if (!loadingHistory && !capturedHistoryRef.current && sortedMessages.length) {
      historyIdsRef.current = sortedMessages.map((m) => m.id);
      capturedHistoryRef.current = true;
    }
  }, [loadingHistory, sortedMessages]);

  return (
    <FileDropzone onUpload={handlePanelDrop} size="panel" className="relative flex flex-1 flex-col">
      <div
        className="relative flex flex-1 flex-col"
        style={{ height: headerless ? "100%" : viewportHeight, overflow: "hidden" }}
      >
        {!headerless && (
          <div
            className="flex shrink-0 items-center gap-2 border-b border-canvas-border px-3 py-2.5"
            style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 10px)" }}
          >
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-canvas-muted hover:bg-canvas-surface-hover"
              >
                <FiArrowLeft size={18} />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-canvas-fg">Claude</p>
            </div>
            <div className="relative flex items-center gap-0.5" ref={popupRef}>
              <StatusIndicator
                status={status}
                isOpen={openPopup === "status"}
                onClick={() => setOpenPopup((p) => (p === "status" ? null : "status"))}
              />
              <ContextIndicator
                percentage={contextUsage?.percentage ?? null}
                isOpen={openPopup === "context"}
                onClick={() => setOpenPopup((p) => (p === "context" ? null : "context"))}
              />
              <HudIndicator
                isOpen={openPopup === "hud"}
                onClick={() => setOpenPopup((p) => (p === "hud" ? null : "hud"))}
              />

              {openPopup === "status" && (
                <div className="animate-modal-in absolute right-0 top-full z-50 mt-1.5 min-w-[140px] rounded-xl border border-canvas-border bg-canvas-bg p-2 shadow-xl">
                  <p className="px-1 py-0.5 text-[12px] font-medium text-canvas-fg">
                    {status === "tool_running" && activeTool
                      ? `Running ${activeTool.name}...`
                      : STATUS_LABELS[status]}
                  </p>
                  {status === "disconnected" && (
                    <button
                      type="button"
                      onClick={() => {
                        reconnect();
                        setOpenPopup(null);
                      }}
                      className="mt-1 w-full rounded-md bg-canvas-surface-hover px-2 py-1 text-[11px] font-medium text-canvas-fg hover:bg-canvas-border"
                    >
                      Reconnect
                    </button>
                  )}
                </div>
              )}

              {openPopup === "context" && (
                <div className="animate-modal-in absolute right-0 top-full z-50 mt-1.5 min-w-[180px] rounded-xl border border-canvas-border bg-canvas-bg p-3 shadow-xl">
                  {contextUsage ? (
                    <>
                      <p className="text-[18px] font-semibold text-canvas-fg">
                        {contextUsage.percentage}%
                      </p>
                      <p className="mt-0.5 text-[11px] text-canvas-muted">
                        {formatTokens(contextUsage.used)} of {formatTokens(contextUsage.max)} tokens
                      </p>
                      <p className="mt-1 text-[10px] text-canvas-muted">Context window usage</p>
                    </>
                  ) : (
                    <>
                      <p className="text-[12px] font-medium text-canvas-fg">No usage yet</p>
                      <p className="mt-0.5 text-[11px] text-canvas-muted">
                        Send a message to see context usage.
                      </p>
                    </>
                  )}
                </div>
              )}

              {openPopup === "hud" && <HudPopup />}
            </div>
          </div>
        )}

        {/* Mode & Effort bar — compact single row. On mobile this IS the
          top toolbar (headerless also true on mobile); on desktop it
          sits below the main header. The sessions-list icon is
          prepended only when onOpenSessions is provided (mobile path). */}
        <div
          className="relative flex shrink-0 items-center gap-2 px-3 pr-3 py-1.5"
          style={{
            borderBottom: "1px solid var(--canvas-border)",
            // Desktop with full header keeps the original 12px left inset.
            // Headerless desktop used to reserve 52px for the legacy top-left
            // button that now lives in this bar — collapse to 12px instead.
            paddingLeft: "12px",
          }}
        >
          {isMobile && onOpenSessions && (
            <button
              type="button"
              onClick={onOpenSessions}
              aria-label="Open conversations"
              className="flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg active:scale-95"
            >
              <FiMessageCircle size={15} />
            </button>
          )}
          {isMobile && onOpenFiles && (
            <button
              type="button"
              onClick={onOpenFiles}
              aria-label="Open files"
              className="flex h-7 w-7 items-center justify-center rounded-md text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg active:scale-95"
            >
              <FiFolder size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowModeMenu((v) => !v)}
            aria-label={`Permission mode: ${MODE_LABELS[permissionMode] ?? "Default"}`}
            className={
              isMobile
                ? "flex h-7 w-7 items-center justify-center rounded-full text-canvas-muted hover:bg-canvas-surface-hover transition-colors duration-150"
                : "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-canvas-muted hover:bg-canvas-surface-hover transition-colors duration-150"
            }
          >
            <FiShield size={isMobile ? 13 : 10} />
            {!isMobile && <span>{MODE_LABELS[permissionMode] ?? "Default"}</span>}
            {!isMobile && <FiChevronDown size={8} />}
          </button>

          <div className="h-3 w-px bg-canvas-border" />

          <div className="flex items-center gap-0.5 rounded-full bg-canvas-surface-hover p-0.5">
            {EFFORT_OPTIONS.map((opt) => {
              const isActive = (opt.value === "" && !effort) || opt.value === effort;
              // On mobile only show the active effort as a tight pill with
              // the letter (A/L/M/H/X) — tapping the row still lets the user
              // cycle through by clicking on different letters in the
              // compressed strip. Keeps the full picker visible on desktop.
              const mobileLabel = opt.value === "" ? "A" : opt.label.charAt(0);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setEffort(opt.value || null)}
                  aria-label={`Effort: ${opt.label}`}
                  className={`rounded-full ${isMobile ? "min-w-[18px] px-1 py-0.5 text-[10px]" : "px-2 py-0.5 text-[9px]"} font-medium transition-all duration-200 ${
                    isActive
                      ? "bg-canvas-bg text-canvas-fg shadow-sm"
                      : "text-canvas-muted hover:text-canvas-fg"
                  }`}
                >
                  {isMobile ? mobileLabel : opt.label}
                </button>
              );
            })}
          </div>

          {headerless && (
            <div className="ml-auto">
              <div className="relative flex items-center gap-0.5" ref={popupRef}>
                <StatusIndicator
                  status={status}
                  isOpen={openPopup === "status"}
                  onClick={() => setOpenPopup((p) => (p === "status" ? null : "status"))}
                />
                <ContextIndicator
                  percentage={contextUsage?.percentage ?? null}
                  isOpen={openPopup === "context"}
                  onClick={() => setOpenPopup((p) => (p === "context" ? null : "context"))}
                />
                <HudIndicator
                  isOpen={openPopup === "hud"}
                  onClick={() => setOpenPopup((p) => (p === "hud" ? null : "hud"))}
                />

                {openPopup === "status" && (
                  <div className="animate-modal-in absolute right-0 top-full z-50 mt-1.5 min-w-[140px] rounded-xl border border-canvas-border bg-canvas-bg p-2 shadow-xl">
                    <p className="px-1 py-0.5 text-[12px] font-medium text-canvas-fg">
                      {status === "tool_running" && activeTool
                        ? `Running ${activeTool.name}...`
                        : STATUS_LABELS[status]}
                    </p>
                    {status === "disconnected" && (
                      <button
                        type="button"
                        onClick={() => {
                          reconnect();
                          setOpenPopup(null);
                        }}
                        className="mt-1 w-full rounded-md bg-canvas-surface-hover px-2 py-1 text-[11px] font-medium text-canvas-fg hover:bg-canvas-border"
                      >
                        Reconnect
                      </button>
                    )}
                  </div>
                )}

                {openPopup === "context" && (
                  <div className="animate-modal-in absolute right-0 top-full z-50 mt-1.5 min-w-[180px] rounded-xl border border-canvas-border bg-canvas-bg p-3 shadow-xl">
                    {contextUsage ? (
                      <>
                        <p className="text-[18px] font-semibold text-canvas-fg">
                          {contextUsage.percentage}%
                        </p>
                        <p className="mt-0.5 text-[11px] text-canvas-muted">
                          {formatTokens(contextUsage.used)} of {formatTokens(contextUsage.max)}{" "}
                          tokens
                        </p>
                        <p className="mt-1 text-[10px] text-canvas-muted">Context window usage</p>
                      </>
                    ) : (
                      <>
                        <p className="text-[12px] font-medium text-canvas-fg">No usage yet</p>
                        <p className="mt-0.5 text-[11px] text-canvas-muted">
                          Send a message to see context usage.
                        </p>
                      </>
                    )}
                  </div>
                )}

                {openPopup === "hud" && <HudPopup />}
              </div>
            </div>
          )}

          {showModeMenu && (
            <div className="absolute left-3 top-full z-50 mt-1 rounded-xl border border-canvas-border bg-canvas-bg py-1 shadow-xl animate-modal-in">
              {MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    if (opt.value !== permissionMode) {
                      setInfoMessages((prev) => [
                        ...prev,
                        {
                          id: crypto.randomUUID(),
                          content: `Switched to ${opt.label} mode`,
                          timestamp: Date.now(),
                        },
                      ]);
                    }
                    setPermissionMode(opt.value);
                    setShowModeMenu(false);
                  }}
                  className={`flex w-full items-start gap-2 px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-canvas-surface-hover ${
                    permissionMode === opt.value ? "bg-canvas-surface-hover" : ""
                  }`}
                >
                  <div>
                    <p className="text-[12px] font-medium text-canvas-fg">{opt.label}</p>
                    <p className="text-[10px] text-canvas-muted">{opt.description}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {authRequired && (
          <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
            <div className="flex items-start gap-2.5">
              <FiAlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1 text-[12px] leading-relaxed">
                <p className="font-medium text-amber-300">Claude sign-in expired</p>
                <p className="mt-0.5 text-canvas-muted">{authRequired.message}</p>
                <p className="mt-1 text-canvas-muted">
                  The sign-in panel has opened — finish the flow there, then retry the message.
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => setParam("settings", "connections/claude")}
                  className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white hover:opacity-90"
                >
                  Go to sign-in
                </button>
                <button
                  type="button"
                  onClick={clearAuthRequired}
                  aria-label="Dismiss"
                  className="rounded-md bg-canvas-bg px-2 py-1 text-[11px] font-medium text-canvas-fg hover:bg-canvas-surface-hover"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="relative flex-1">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="absolute inset-0 overflow-y-auto overflow-x-hidden"
          >
            {loadingHistory && (
              <div className="flex items-center justify-center py-8">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-canvas-border border-t-canvas-muted" />
                <span className="ml-2 text-[12px] text-canvas-muted">Loading conversation...</span>
              </div>
            )}
            {!loadingHistory && messages.length === 0 && status === "idle" ? (
              <EmptyState onSuggestionClick={handleSuggestionClick} />
            ) : (
              <div className={isMobile ? "py-3" : "py-3 pb-24"}>
                {/* eslint-disable-next-line react-hooks/refs -- historyIdsRef is captured once via effect then stable; safe to read during render for first-load stagger delays */}
                {sortedMessages.map((msg, idx) => {
                  // Staggered enter animation for first-load history only —
                  // streaming messages (idx not in historyIdsRef) animate
                  // instantly. Capped at 12 * 25ms so a huge backlog doesn't
                  // visibly cascade for half a second.
                  const histIdx = historyIdsRef.current.indexOf(msg.id);
                  const staggerStyle =
                    histIdx >= 0
                      ? { animationDelay: `${Math.min(histIdx, 12) * 25}ms` }
                      : undefined;

                  if (msg._isInfo) {
                    return (
                      <div
                        key={msg.id}
                        className="animate-msg-in flex justify-center px-4 py-1.5"
                        style={staggerStyle}
                      >
                        <span className="rounded-full bg-canvas-surface-hover px-3 py-1 text-[11px] text-canvas-muted">
                          {msg.content}
                        </span>
                      </div>
                    );
                  }
                  // Timeline nodes (thinking / tool_use / tool_result) are the
                  // ambient "Claude is working" stream. Wrap each one in a
                  // container that paints a subtle left rail so contiguous nodes
                  // read as a single vertical timeline. User bubbles, assistant
                  // replies, and interactive cards break the rail cleanly.
                  const isTimelineNode =
                    msg.type === "thinking" ||
                    msg.type === "tool_use" ||
                    msg.type === "tool_result";
                  const prev = idx > 0 ? sortedMessages[idx - 1] : null;
                  const next = idx < sortedMessages.length - 1 ? sortedMessages[idx + 1] : null;
                  const prevIsTimeline =
                    !!prev &&
                    !prev._isInfo &&
                    (prev.type === "thinking" ||
                      prev.type === "tool_use" ||
                      prev.type === "tool_result");
                  const nextIsTimeline =
                    !!next &&
                    !next._isInfo &&
                    (next.type === "thinking" ||
                      next.type === "tool_use" ||
                      next.type === "tool_result");
                  return (
                    <div
                      key={msg.id}
                      className={`animate-msg-in ${
                        isTimelineNode ? "ml-4 border-l border-accent/15 pl-1" : ""
                      } ${isTimelineNode && !prevIsTimeline ? "mt-2 pt-1" : ""} ${
                        isTimelineNode && !nextIsTimeline ? "mb-2 pb-1" : ""
                      }`}
                      style={staggerStyle}
                    >
                      <MessageBubble
                        message={msg}
                        isLatestToolUse={msg.type === "tool_use" && msg.id === latestToolUseId}
                        siblingToolUse={
                          msg.type === "tool_result" && msg.toolCallId
                            ? toolUseByCallId.get(msg.toolCallId)
                            : undefined
                        }
                        onPermissionRespond={respondPermission}
                        onQuestionRespond={respondQuestion}
                        onPlanRespond={respondPlan}
                      />
                    </div>
                  );
                })}
                {(status === "thinking" || status === "tool_running") && (
                  <div className="animate-msg-in flex items-center gap-2.5 px-5 py-2">
                    <span className="thinking-loader" aria-hidden="true" />
                    <span className="text-accent text-[11px]">
                      {status === "tool_running" && activeTool
                        ? `Running ${activeTool.name}...`
                        : `${thinkingVerb}...`}
                    </span>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Floating pill that scrolls the user to the inline approval
            card when it's off-screen. Replaces the old blocking modal —
            the inline PermissionRequestBlock now renders full Allow /
            Deny / Always-allow / Deny-with-reason controls directly in
            the stream, so the modal was redundant. This pill is a
            no-JS-deps fallback: it always shows while a permission is
            pending, and a tap scrolls to the bottom (where the latest
            inline card lives). */}
          {(() => {
            const pending = messages.find(
              (m) => m.type === "permission_request" && !m.permissionResolved,
            );
            if (!pending) return null;
            const toolName = pending.toolName ?? "Tool";
            return (
              <button
                type="button"
                onClick={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })}
                className="animate-msg-in absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-accent/40 bg-canvas-bg/95 px-3 py-1.5 text-[11px] font-medium shadow-lg backdrop-blur"
                style={{ color: "var(--accent)" }}
              >
                <FiShield size={11} />
                <span>Approval needed · {toolName} — tap to review</span>
              </button>
            );
          })()}
        </div>

        <SetupGuard forceShow={setupRequired}>
          <div
            className={
              isMobile
                ? ""
                : "pointer-events-none absolute inset-x-0 bottom-0 z-10 [&_*]:pointer-events-auto"
            }
          >
            <ChatInput
              status={status}
              onSend={sendMessage}
              onStop={stopGeneration}
              initialText={draft}
              attachments={composerAttachments.attachments}
              onAddFiles={composerAttachments.addFiles}
              onRemoveAttachment={composerAttachments.remove}
              onClearAttachments={composerAttachments.clear}
            />
          </div>
        </SetupGuard>
      </div>
    </FileDropzone>
  );
}
