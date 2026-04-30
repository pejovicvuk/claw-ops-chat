"use client";

import { useEffect, useRef, useState } from "react";
import type { ActiveToolInfo, ClaudeStatus } from "@/lib/types";
import type { ContextUsage } from "@/lib/use-claude-chat";
import { ContextIndicator } from "./context-indicator";
import { HudIndicator } from "./hud-indicator";
import { HudPopup } from "./hud-popup";
import { StatusIndicator } from "./status-indicator";

const STATUS_LABELS: Record<ClaudeStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting...",
  idle: "Ready",
  thinking: "Thinking...",
  tool_running: "Running tool...",
  awaiting_permission: "Needs approval",
  awaiting_input: "Needs your input",
};

type PopupKind = "status" | "context" | "hud";

interface HeaderIndicatorsProps {
  status: ClaudeStatus;
  activeTool: ActiveToolInfo | null;
  contextUsage: ContextUsage | null;
  sessionStartedAt: number | null;
  turnCount: number;
  /** Per-session model override; null = Auto (SDK default). */
  model: string | null;
  setModel: (next: string | null) => void;
  reconnect: () => void;
}

/**
 * The three top-right chat indicators (connection status, context-window
 * ring, session HUD) plus their click-to-open popups, packaged as one
 * component.
 *
 * Previously inlined twice in `chat-view.tsx` (once in the desktop
 * `!headerless` header and once in the headerless mode/effort bar) with
 * 60+ identical JSX lines per copy — every change had to be made in two
 * places. Encapsulating the trio here also moves the popup state and the
 * outside-click handler off `chat-view`, which keeps that file focused
 * on chat layout/lifecycle.
 *
 * The popup state is internal: only one popup can be open at a time, and
 * clicking outside the wrapper closes it. Multiple instances (e.g. one
 * desktop + one mobile) won't collide because only one ever renders at
 * a time — chat-view picks via the `headerless` flag.
 */
export function HeaderIndicators({
  status,
  activeTool,
  contextUsage,
  sessionStartedAt,
  turnCount,
  model,
  setModel,
  reconnect,
}: HeaderIndicatorsProps) {
  const [openPopup, setOpenPopup] = useState<PopupKind | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Outside-click dismissal. Mounted only while a popup is open so
  // background sessions don't keep a global mousedown listener installed.
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

  const toggle = (kind: PopupKind) => setOpenPopup((p) => (p === kind ? null : kind));

  return (
    <div className="relative flex items-center gap-0.5" ref={popupRef}>
      <StatusIndicator
        status={status}
        isOpen={openPopup === "status"}
        onClick={() => toggle("status")}
      />
      <ContextIndicator
        percentage={contextUsage?.percentage ?? null}
        isOpen={openPopup === "context"}
        onClick={() => toggle("context")}
      />
      <HudIndicator isOpen={openPopup === "hud"} onClick={() => toggle("hud")} />

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
              <p className="text-[18px] font-semibold text-canvas-fg">{contextUsage.percentage}%</p>
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

      {openPopup === "hud" && (
        <HudPopup
          contextUsage={contextUsage}
          sessionStartedAt={sessionStartedAt}
          activeTool={activeTool}
          status={status}
          turnCount={turnCount}
          model={model}
          setModel={setModel}
        />
      )}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
