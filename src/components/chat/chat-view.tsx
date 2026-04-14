"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { FiArrowLeft, FiShield, FiChevronDown, FiTerminal, FiFile, FiEdit } from "react-icons/fi";
import { useClaudeChat } from "@/lib/use-claude-chat";
import { useVisualViewport } from "@/lib/use-visual-viewport";
import { fetchSessionMessages } from "@/lib/api";
import { StatusIndicator } from "./status-indicator";
import { MessageBubble } from "./message-bubble";
import { ChatInput } from "./chat-input";

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
  Bash: FiTerminal, Read: FiFile, Write: FiEdit, Edit: FiEdit, Glob: FiFile, Grep: FiFile,
};
const TOOL_LABELS: Record<string, string> = {
  Bash: "Run command", Read: "Read file", Write: "Write file", Edit: "Edit file",
  Glob: "Search files", Grep: "Search content",
};
function getToolDisplayForPermission(name: string) {
  return { icon: TOOL_ICONS[name] ?? FiTerminal, label: TOOL_LABELS[name] ?? `Use ${name}` };
}
function getPermDescForModal(toolName: string, input?: Record<string, unknown>): string {
  if (!input) return "";
  if (toolName === "Bash" && input.command) return String(input.command).slice(0, 200);
  if (["Read", "Write", "Edit"].includes(toolName) && input.file_path) return String(input.file_path);
  return JSON.stringify(input).slice(0, 200);
}

interface ChatViewProps {
  sessionId: string;
  resumeSessionId?: string | null;
  onBack?: () => void;
  headerless?: boolean;
  fileButton?: ReactNode;
}

export function ChatView({ sessionId, resumeSessionId, onBack, headerless, fileButton }: ChatViewProps) {
  const { messages, status, activeTool, sendMessage, respondPermission, respondQuestion, setPermissionMode, setEffort, reconnect, setInitialMessages } = useClaudeChat(sessionId);
  const { viewportHeight } = useVisualViewport();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const [loadingHistory, setLoadingHistory] = useState(!!resumeSessionId);
  const [permissionMode, setMode] = useState<string>(() => {
    if (typeof window === "undefined") return "default";
    return localStorage.getItem("claw-chat-mode:v1") || "default";
  });
  const [effortLevel, setEffortLevel] = useState<string | null>(null);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [infoMessages, setInfoMessages] = useState<Array<{ id: string; content: string; timestamp: number }>>([]);
  const bridgeSyncedRef = useRef(false);

  useEffect(() => {
    try { localStorage.setItem("claw-chat-mode:v1", permissionMode); } catch {}
  }, [permissionMode]);

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
      .then((msgs) => {
        if (!cancelled) {
          setInitialMessages(msgs);
          setLoadingHistory(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => { cancelled = true; };
  }, [resumeSessionId, setInitialMessages]);

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
          <StatusIndicator status={status} activeTool={activeTool} onReconnect={reconnect} />
        </div>
      )}

      {/* Mode & Effort bar */}
      <div className="relative flex shrink-0 items-center gap-3 border-b border-canvas-border px-3 py-1.5">
        <button
          type="button"
          onClick={() => setShowModeMenu((v) => !v)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-canvas-muted hover:bg-canvas-surface-hover"
        >
          <FiShield size={11} />
          <span>{MODE_LABELS[permissionMode] ?? "Default"}</span>
          <FiChevronDown size={10} />
        </button>

        <div className="flex items-center gap-0.5 rounded-md bg-canvas-surface-hover p-0.5">
          {EFFORT_OPTIONS.map((opt) => {
            const isActive = (opt.value === "" && !effortLevel) || opt.value === effortLevel;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  const val = opt.value || null;
                  setEffortLevel(val);
                  setEffort(val);
                }}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  isActive
                    ? "bg-canvas-bg text-canvas-fg"
                    : "text-canvas-muted hover:text-canvas-fg"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {headerless && (
          <div className="ml-auto">
            <StatusIndicator status={status} activeTool={activeTool} onReconnect={reconnect} />
          </div>
        )}

        {showModeMenu && (
          <div className="absolute left-3 top-full z-50 mt-1 rounded-lg border border-canvas-border bg-canvas-bg py-1 shadow-lg">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  if (opt.value !== permissionMode) {
                    setInfoMessages((prev) => [...prev, {
                      id: crypto.randomUUID(),
                      content: `Switched to ${opt.label} mode`,
                      timestamp: Date.now(),
                    }]);
                  }
                  setMode(opt.value);
                  setPermissionMode(opt.value);
                  setShowModeMenu(false);
                }}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-canvas-surface-hover ${
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
          {(() => {
            const infoAsMsgs = infoMessages.map((m) => ({
              ...m, role: "system" as const, type: "text" as const, _isInfo: true,
            }));
            const all = [...messages.map((m) => ({ ...m, _isInfo: false })), ...infoAsMsgs]
              .sort((a, b) => a.timestamp - b.timestamp);
            return all.map((msg) =>
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
                    onPermissionRespond={respondPermission}
                    onQuestionRespond={respondQuestion}
                  />
                </div>
              ),
            );
          })()}
          {(status === "thinking" || status === "tool_running") && (
            <div className="animate-msg-in flex items-center gap-2 px-5 py-2">
              <span className="thinking-dots flex items-center gap-0.5">
                <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-purple-400" />
                <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-purple-400" />
                <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-purple-400" />
              </span>
              <span className="text-[11px] text-canvas-muted">
                {status === "tool_running" ? "Working..." : "Thinking..."}
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Permission modal */}
        {(() => {
          const pending = messages.find((m) => m.type === "permission_request" && !m.permissionResolved);
          if (!pending) return null;
          const toolName = pending.toolName ?? "Tool";
          const { icon: PermIcon, label: permLabel } = getToolDisplayForPermission(toolName);
          const permDesc = pending.content || getPermDescForModal(toolName, pending.permissionInput);
          return (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
              <div className="mx-4 w-full max-w-sm rounded-xl border border-orange-500/30 bg-canvas-bg p-4 shadow-2xl">
                <div className="mb-3 flex items-center gap-2">
                  <PermIcon size={16} className="shrink-0 text-orange-400" />
                  <span className="text-[13px] font-semibold text-canvas-fg">Permission required</span>
                </div>
                <p className="mb-1 text-[13px] text-canvas-fg">{permLabel}</p>
                {permDesc && (
                  <p className="mb-4 break-all font-mono text-[11px] text-canvas-muted">{permDesc}</p>
                )}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => respondPermission(pending.permissionId!, true)}
                      className="flex-1 rounded-lg bg-green-600 px-3 py-2.5 text-[13px] font-medium text-white active:bg-green-700"
                    >
                      Allow
                    </button>
                    <button
                      type="button"
                      onClick={() => respondPermission(pending.permissionId!, false)}
                      className="flex-1 rounded-lg border border-canvas-border bg-canvas-surface-hover px-3 py-2.5 text-[13px] font-medium text-canvas-fg active:bg-canvas-border"
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
                      setInfoMessages((prev) => [...prev, {
                        id: crypto.randomUUID(),
                        content: "Switched to Accept Edits mode",
                        timestamp: Date.now(),
                      }]);
                    }}
                    className="w-full rounded-lg border border-green-600/30 bg-green-600/10 px-3 py-2 text-[12px] font-medium text-green-400 active:bg-green-600/20"
                  >
                    Allow all {toolName} this session
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      <ChatInput status={status} onSend={sendMessage} fileButton={fileButton} />
    </div>
  );
}
