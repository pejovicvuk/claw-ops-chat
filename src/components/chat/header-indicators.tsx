"use client";

import { useEffect, useRef, useState } from "react";
import type { ActiveToolInfo, ClaudeStatus } from "@/lib/types";
import type { ContextUsage } from "@/lib/use-claude-chat";
import { useRateLimits } from "@/lib/use-rate-limits";
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

type PopupKind = "status" | "hud";

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
 * Top-right cluster: the connection-status dot and the session HUD
 * (activity icon → popover with model picker, tokens, elapsed, turns,
 * and the rate-limit windows). The dedicated 5-hour and Weekly rings
 * were retired — their data still lives inside the HUD popup, so
 * power users keep one click of access while the cluster stays
 * visually quiet.
 *
 * Rate-limit data is fetched once via `useRateLimits` and forwarded
 * straight into HudPopup — a single 30-second poller for the whole
 * subtree, regardless of which popup (if any) is open.
 *
 * Only one popup can be open at a time, and clicking outside the
 * wrapper closes it.
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
  const rateLimits = useRateLimits();

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

      {openPopup === "hud" && (
        <HudPopup
          contextUsage={contextUsage}
          sessionStartedAt={sessionStartedAt}
          activeTool={activeTool}
          status={status}
          turnCount={turnCount}
          model={model}
          setModel={setModel}
          rateLimits={rateLimits}
        />
      )}
    </div>
  );
}
