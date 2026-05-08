"use client";

import { useEffect, useRef, useState } from "react";
import type { ActiveToolInfo, ClaudeStatus } from "@/lib/types";
import type { ContextUsage } from "@/lib/use-claude-chat";
import { useRateLimits } from "@/lib/use-rate-limits";
import {
  pickFiveHourWindow,
  pickWeeklyWindow,
  utilizationToPercent,
} from "@/lib/rate-limits-window";
import { formatResetsIn, toMillis } from "@/lib/format-relative-time";
import type { RateLimitWindow } from "@/lib/account-rate-limits";
import { HudIndicator } from "./hud-indicator";
import { HudPopup } from "./hud-popup";
import { RateLimitIndicator } from "./rate-limit-indicator";
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

/** Pretty label for a `seven_day_*` cache key (used in the Weekly popup). */
function weeklyKeyLabel(key: string | null): string {
  if (key === "seven_day_opus") return "Opus";
  if (key === "seven_day_sonnet") return "Sonnet";
  return "Combined";
}

type PopupKind = "status" | "five_hour" | "weekly" | "hud";

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
 * The five top-right chat indicators (connection status, chat context
 * ring, 5-hour rate-limit ring, weekly rate-limit ring, session HUD)
 * plus their click-to-open popups, packaged as one component.
 *
 * Rate-limit data is fetched once via `useRateLimits` and shared across
 * the two new rings AND the HUD popup — a single 30-second poller for
 * the whole subtree, regardless of which popups are open.
 *
 * The popup state is internal: only one popup can be open at a time, and
 * clicking outside the wrapper closes it.
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

  // Re-render once a second while a rate-limit popup is open so the
  // "resets in …" countdown stays current.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (openPopup !== "five_hour" && openPopup !== "weekly") return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [openPopup]);

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

  const fiveHour = pickFiveHourWindow(rateLimits);
  const weekly = pickWeeklyWindow(rateLimits);

  return (
    <div className="relative flex items-center gap-0.5" ref={popupRef}>
      <StatusIndicator
        status={status}
        isOpen={openPopup === "status"}
        onClick={() => toggle("status")}
      />
      <RateLimitIndicator
        label="5-hour"
        window={fiveHour.window}
        isOpen={openPopup === "five_hour"}
        onClick={() => toggle("five_hour")}
      />
      <RateLimitIndicator
        label="Weekly"
        window={weekly.window}
        isOpen={openPopup === "weekly"}
        onClick={() => toggle("weekly")}
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

      {openPopup === "five_hour" && (
        <RateLimitPopup label="5-hour" window={fiveHour.window} sublabel={null} now={now} />
      )}

      {openPopup === "weekly" && (
        <RateLimitPopup
          label="Weekly"
          window={weekly.window}
          sublabel={weekly.window ? weeklyKeyLabel(weekly.key) : null}
          now={now}
        />
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

interface RateLimitPopupProps {
  label: string;
  window: RateLimitWindow | null;
  /** Optional sub-label for the Weekly popup ("Opus" / "Sonnet" / "Combined"). */
  sublabel: string | null;
  now: number;
}

/**
 * Small focused popup showing one rate-limit window's percentage,
 * status, reset countdown, and overage tag. Mirrors the chat-context
 * popup's visual weight so the trio reads as siblings.
 */
function RateLimitPopup({ label, window, sublabel, now }: RateLimitPopupProps) {
  const pct = utilizationToPercent(window?.utilization);
  const resetsAt = toMillis(window?.resetsAt);
  const resetsLabel = resetsAt ? `resets in ${formatResetsIn(resetsAt, now)}` : null;

  return (
    <div className="animate-modal-in absolute right-0 top-full z-50 mt-1.5 min-w-[200px] rounded-xl border border-canvas-border bg-canvas-bg p-3 shadow-xl">
      {!window ? (
        <>
          <p className="text-[12px] font-medium text-canvas-fg">{label}: no data yet</p>
          <p className="mt-0.5 text-[11px] text-canvas-muted">
            Refreshes after the next API call.
          </p>
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            {pct !== null ? (
              <p className={`text-[18px] font-semibold ${percentClass(pct, window.status)}`}>
                {pct}%
              </p>
            ) : (
              <StatusBadge status={window.status} />
            )}
            {window.isUsingOverage && (
              <span className="rounded-full bg-orange-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-orange-500">
                overage
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-canvas-muted">
            {label}
            {sublabel ? ` · ${sublabel}` : ""}
            {resetsLabel ? ` · ${resetsLabel}` : ""}
          </p>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: RateLimitWindow["status"] }) {
  if (status === "rejected") {
    return (
      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[12px] font-semibold text-red-500">
        Limit hit
      </span>
    );
  }
  if (status === "allowed_warning") {
    return (
      <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[12px] font-semibold text-orange-500">
        Warning
      </span>
    );
  }
  return (
    <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[12px] font-semibold text-green-500">
      Allowed
    </span>
  );
}

function percentClass(pct: number, status: RateLimitWindow["status"]): string {
  if (status === "rejected" || pct >= 100) return "text-red-500";
  if (status === "allowed_warning" || pct >= 80) return "text-orange-500";
  return "text-canvas-fg";
}
