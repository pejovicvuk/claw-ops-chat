"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FiArrowLeft,
  FiShield,
  FiChevronDown,
  FiTerminal,
  FiFile,
  FiEdit,
  FiMessageCircle,
} from "react-icons/fi";
import { useClaudeChat } from "@/lib/use-claude-chat";
import { useIsMobile } from "@/lib/use-is-mobile";
import { useVisualViewport } from "@/lib/use-visual-viewport";
import { fetchSessionMessages } from "@/lib/api";
import { StatusIndicator } from "./status-indicator";
import { ContextIndicator } from "./context-indicator";
import { MessageBubble } from "./message-bubble";
import { ChatInput } from "./chat-input";
import { SetupGuard } from "./setup-guard";

const MODE_STORAGE_KEY = "claw-chat-mode:v1";

const MODE_LABELS: Record<string, string> = {
  default: "Default",
  acceptEdits: "Accept Edits",
  plan: "Plan Mode",
};

const MODE_OPTIONS = [
  { value: "default", label: "Default", description: "Ask before edits and commands" },
  { value: "acceptEdits", label: "Accept Edits", description: "Auto-approve file edits" },
  { value: "plan", label: "Plan Mode", description: "Plan only, no changes" },
];

const EFFORT_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Med" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

const TOOL_ICONS: Record<string, typeof FiTerminal> = {
  Bash: FiTerminal,
  Read: FiFile,
  Write: FiEdit,
  Edit: FiEdit,
  Glob: FiFile,
  Grep: FiFile,
};
const TOOL_LABELS: Record<string, string> = {
  Bash: "Run command",
  Read: "Read file",
  Write: "Write file",
  Edit: "Edit file",
  Glob: "Search files",
  Grep: "Search content",
};
function getToolDisplayForPermission(name: string) {
  return { icon: TOOL_ICONS[name] ?? FiTerminal, label: TOOL_LABELS[name] ?? `Use ${name}` };
}
function getPermDescForModal(toolName: string, input?: Record<string, unknown>): string {
  if (!input) return "";
  if (toolName === "Bash" && input.command) return String(input.command).slice(0, 200);
  if (["Read", "Write", "Edit"].includes(toolName) && input.file_path)
    return String(input.file_path);
  return JSON.stringify(input).slice(0, 200);
}

const STATUS_LABELS: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting...",
  idle: "Ready",
  thinking: "Thinking...",
  tool_running: "Running tool...",
  awaiting_permission: "Needs approval",
  awaiting_input: "Needs your input",
};

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
  fileButton?: ReactNode;
  onSessionCreated?: (claudeSessionId: string) => void;
  /** Mobile-only: when provided, the Mode/Effort bar shows a chat-list
      icon at the start that invokes this. Merges two stacked toolbars
      into one on narrow viewports. */
  onOpenSessions?: () => void;
}

export function ChatView({
  sessionId,
  resumeSessionId,
  onBack,
  headerless,
  fileButton,
  onSessionCreated,
  onOpenSessions,
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
    contextUsage,
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
  const { viewportHeight } = useVisualViewport();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const [loadingHistory, setLoadingHistory] = useState(!!resumeSessionId);
  const [permissionMode, setMode] = useState<string>(() => {
    if (typeof window === "undefined") return "default";
    return localStorage.getItem(MODE_STORAGE_KEY) || "default";
  });
  const [effortLevel, setEffortLevel] = useState<string | null>(null);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [openPopup, setOpenPopup] = useState<"status" | "context" | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    try {
      localStorage.setItem(MODE_STORAGE_KEY, permissionMode);
    } catch {}
  }, [permissionMode]);

  /* Notify parent when SDK creates a new session (so page can update selected session) */
  useEffect(() => {
    if (claudeSessionId && claudeSessionId !== notifiedSessionRef.current) {
      notifiedSessionRef.current = claudeSessionId;
      onSessionCreated?.(claudeSessionId);
    }
  }, [claudeSessionId, onSessionCreated]);

  useEffect(() => {
    if (status === "idle" && !bridgeSyncedRef.current) {
      bridgeSyncedRef.current = true;
      if (permissionMode !== "default") {
        setPermissionMode(permissionMode);
      }
    }
  }, [status, permissionMode, setPermissionMode]);

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

  return (
    <div
      className="flex flex-1 flex-col"
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
            const isActive = (opt.value === "" && !effortLevel) || opt.value === effortLevel;
            // On mobile only show the active effort as a tight pill with
            // the letter (A/L/M/H/X) — tapping the row still lets the user
            // cycle through by clicking on different letters in the
            // compressed strip. Keeps the full picker visible on desktop.
            const mobileLabel = opt.value === "" ? "A" : opt.label.charAt(0);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  const val = opt.value || null;
                  setEffortLevel(val);
                  setEffort(val);
                }}
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
                  setMode(opt.value);
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

      {/* Messages */}
      <div className="relative flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="absolute inset-0 overflow-y-auto overflow-x-hidden py-3"
        >
          {loadingHistory && (
            <div className="flex items-center justify-center py-8">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-canvas-border border-t-canvas-muted" />
              <span className="ml-2 text-[12px] text-canvas-muted">Loading conversation...</span>
            </div>
          )}
          {!loadingHistory && messages.length === 0 && status === "idle" && (
            <div className="flex h-full items-center justify-center px-8">
              <p className="text-center text-[13px] text-canvas-muted">
                Send a message to start a conversation with Claude.
              </p>
            </div>
          )}
          {sortedMessages.map((msg) =>
            msg._isInfo ? (
              <div key={msg.id} className="animate-msg-in flex justify-center px-4 py-1.5">
                <span className="rounded-full bg-canvas-surface-hover px-3 py-1 text-[11px] text-canvas-muted">
                  {msg.content}
                </span>
              </div>
            ) : (
              <div key={msg.id} className="animate-msg-in">
                <MessageBubble
                  message={msg}
                  isLatestToolUse={msg.type === "tool_use" && msg.id === latestToolUseId}
                  onPermissionRespond={respondPermission}
                  onQuestionRespond={respondQuestion}
                  onPlanRespond={respondPlan}
                />
              </div>
            ),
          )}
          {(status === "thinking" || status === "tool_running") && (
            <div className="animate-msg-in flex items-center gap-2.5 px-5 py-2">
              <span className="thinking-dots flex items-center gap-1">
                <span
                  className="thinking-dot h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: "var(--accent)" }}
                />
                <span
                  className="thinking-dot h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: "var(--accent)" }}
                />
                <span
                  className="thinking-dot h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: "var(--accent)" }}
                />
              </span>
              <span className="text-[11px] text-canvas-muted">
                {status === "tool_running" && activeTool
                  ? `Running ${activeTool.name}...`
                  : "Thinking..."}
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Permission modal — slides up from bottom on mobile */}
        {(() => {
          const pending = messages.find(
            (m) => m.type === "permission_request" && !m.permissionResolved,
          );
          if (!pending) return null;
          const toolName = pending.toolName ?? "Tool";
          const { icon: PermIcon, label: permLabel } = getToolDisplayForPermission(toolName);
          const permDesc =
            pending.content || getPermDescForModal(toolName, pending.permissionInput);
          return (
            <div className="absolute inset-0 z-10 flex items-end sm:items-center justify-center bg-black/25 backdrop-blur-[3px]">
              <div
                className="animate-sheet-up sm:animate-modal-in mx-0 sm:mx-4 w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-canvas-bg p-5 shadow-2xl"
                style={{ borderTop: "1px solid var(--canvas-border)" }}
              >
                <div className="mb-4 flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-xl"
                    style={{
                      backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)",
                    }}
                  >
                    <PermIcon size={18} style={{ color: "var(--accent)" }} />
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold text-canvas-fg">{permLabel}</p>
                    <p className="text-[11px] text-canvas-muted">Claude wants to use this tool</p>
                  </div>
                </div>
                {permDesc && (
                  <div className="mb-4 rounded-xl bg-canvas-surface-hover p-3">
                    <p className="break-all font-mono text-[11px] leading-relaxed text-canvas-muted">
                      {permDesc}
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => respondPermission(pending.permissionId!, true)}
                      className="flex-1 rounded-xl py-3 text-[14px] font-semibold text-white active:opacity-80 transition-opacity duration-150"
                      style={{ backgroundColor: "var(--accent)" }}
                    >
                      Allow
                    </button>
                    <button
                      type="button"
                      onClick={() => respondPermission(pending.permissionId!, false)}
                      className="flex-1 rounded-xl border border-canvas-border bg-canvas-surface-hover py-3 text-[14px] font-semibold text-canvas-fg active:bg-canvas-border transition-colors duration-150"
                    >
                      Deny
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      respondPermission(pending.permissionId!, true, true);
                      setMode("acceptEdits");
                      setPermissionMode("acceptEdits");
                      setInfoMessages((prev) => [
                        ...prev,
                        {
                          id: crypto.randomUUID(),
                          content: "Switched to Accept Edits mode",
                          timestamp: Date.now(),
                        },
                      ]);
                    }}
                    className="w-full rounded-xl py-2.5 text-[12px] font-medium transition-colors duration-150 active:opacity-70"
                    style={{
                      backgroundColor: "color-mix(in srgb, var(--accent) 10%, transparent)",
                      color: "var(--accent)",
                      border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)",
                    }}
                  >
                    Always allow {toolName} this session
                  </button>
                </div>
                {/* Safe area padding for bottom */}
                <div style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
              </div>
            </div>
          );
        })()}
      </div>

      <SetupGuard forceShow={setupRequired}>
        <ChatInput
          status={status}
          onSend={sendMessage}
          onStop={stopGeneration}
          fileButton={fileButton}
        />
      </SetupGuard>
    </div>
  );
}
