"use client";

import { useEffect, useState } from "react";
import { formatResetsIn, toMillis } from "@/lib/format-relative-time";
import { formatElapsed } from "@/lib/format-time";
import { ratesFor } from "@/lib/model-pricing";
import type { ContextUsage } from "@/lib/use-claude-chat";
import type { ActiveToolInfo, ClaudeStatus } from "@/lib/types";
import type { RateLimitsCache, RateLimitWindow } from "@/lib/account-rate-limits";

interface HudPopupProps {
  contextUsage: ContextUsage | null;
  sessionStartedAt: number | null;
  activeTool: ActiveToolInfo | null;
  status: ClaudeStatus;
  /** Number of user-sent text messages in the current session — drives the Turns counter. */
  turnCount: number;
  /**
   * Per-session model override. `null` means Auto (let the SDK use the
   * subscription default; the active model still shows beside the
   * dropdown via `contextUsage.model`).
   */
  model: string | null;
  setModel: (next: string | null) => void;
  /**
   * Account-level rate-limit cache, fetched + polled by the parent
   * `HeaderIndicators` so the new ring indicators and this popup share
   * one network poller. `null` until the first fetch completes.
   */
  rateLimits: RateLimitsCache | null;
}

/**
 * Picker options. We surface the SDK's stable family aliases rather than
 * concrete versions so the picker keeps working when Anthropic ships a
 * new minor (e.g. Sonnet 4.6 → 4.7) without a code change. Empty string
 * = Auto (no override; the SDK uses whatever default the subscription
 * comes with).
 */
const MODEL_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

/**
 * Map the SDK's full model id (e.g. `claude-opus-4-7-20260301`) to its
 * family alias so the dropdown can show what's actually running when the
 * user has Auto selected. Returns null if we can't classify it.
 */
function modelFamily(id: string | null | undefined): "opus" | "sonnet" | "haiku" | null {
  if (!id) return null;
  if (id.includes("opus")) return "opus";
  if (id.includes("sonnet")) return "sonnet";
  if (id.includes("haiku")) return "haiku";
  return null;
}

/**
 * Combined session-stats + account-rate-limits popup. Two stacked sections:
 *
 *   1. Session — model, active tool, elapsed timer, turn count, token
 *      breakdown. Sourced live from the `useClaudeChat` hook so each
 *      open render is an instant snapshot, not a fetch.
 *   2. Rate limits — 5-hour and 7-day windows from
 *      `~/.claude/claw-account-rate-limits.json`, fetched once at the
 *      parent (`HeaderIndicators`) via `useRateLimits` and passed down.
 *      Populated by:
 *        - a `/v1/messages` ping the server fires on boot + every 15 min
 *          (status + resetsAt via the `anthropic-ratelimit-unified-*`
 *          headers, written into five_hour);
 *        - live SDK `rate_limit_event` messages on real chat turns
 *          (carry `utilization` 0..1 + window-tagged status).
 *      When `utilization` is unavailable we fall back to a status badge
 *      so the user still gets the signal that matters: "do I have
 *      headroom right now?"
 */
export function HudPopup({
  contextUsage,
  sessionStartedAt,
  activeTool,
  status,
  turnCount,
  model,
  setModel,
  rateLimits,
}: HudPopupProps) {
  const [now, setNow] = useState(() => Date.now());

  // 1-second tick. Drives both the rate-limit "resets in" countdown and the
  // session elapsed counter. Mounted only while the popup is open so we're
  // not re-rendering every tab in the background.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const fiveHour = rateLimits?.windows.five_hour;
  const sevenDay = rateLimits?.windows.seven_day;
  const rateEmpty = !rateLimits || (!fiveHour && !sevenDay);

  // Derived session values. All gracefully handle the "no data yet" state
  // so the very first render of a brand-new chat doesn't crash or flash
  // bogus zeros.
  const runningModelLabel = (() => {
    const r = ratesFor(contextUsage?.model);
    if (r) return r.label;
    return contextUsage?.model ?? null;
  })();
  // When the user has Auto selected we surface the actual family the SDK
  // chose to the right of the dropdown (e.g. "Auto · Sonnet 4.6") so the
  // picker still answers the question "what am I running right now?"
  // without forcing the user to remember the SDK's default.
  const autoHint = !model && runningModelLabel ? runningModelLabel : null;
  const elapsed = sessionStartedAt ? formatElapsed(now - sessionStartedAt) : "—";
  const isToolRunning = status === "tool_running" && activeTool;

  return (
    <div className="animate-modal-in absolute right-0 top-full z-50 mt-1.5 min-w-[280px] rounded-xl border border-canvas-border bg-canvas-bg p-3 shadow-xl">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-canvas-muted">
        Session
      </p>
      <div className="space-y-1.5">
        <SessionRow
          label="Model"
          value={
            <span className="inline-flex items-center gap-1.5">
              <select
                value={model ?? ""}
                onChange={(e) => setModel(e.target.value || null)}
                aria-label="Model"
                className="rounded-md border border-canvas-border bg-canvas-bg px-1.5 py-0.5 text-[11px] font-medium text-canvas-fg outline-none transition-colors hover:bg-canvas-surface-hover focus:border-accent"
              >
                {MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {autoHint && (
                <span className="text-[10px] text-canvas-muted" title="Currently running">
                  · {autoHint}
                </span>
              )}
              {model && runningModelLabel && modelFamily(contextUsage?.model) !== model && (
                <span
                  className="text-[10px] text-canvas-muted"
                  title="The change applies on the next turn"
                >
                  · pending
                </span>
              )}
            </span>
          }
        />
        {isToolRunning && (
          <SessionRow
            label="Active tool"
            value={
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-purple-400" />
                <span className="font-mono text-[11px] text-canvas-fg">{activeTool.name}</span>
              </span>
            }
          />
        )}
        <SessionRow label="Elapsed" value={elapsed} />
        <SessionRow label="Turns" value={String(turnCount)} />
        {contextUsage && (
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-[11px] text-canvas-muted">Tokens</span>
            <span className="text-[10px] text-canvas-muted">
              {compactToken(contextUsage.inputTokens ?? 0)} in ·{" "}
              {compactToken(contextUsage.outputTokens ?? 0)} out ·{" "}
              {compactToken(contextUsage.cacheReadTokens ?? 0)} cache hit ·{" "}
              {compactToken(contextUsage.cacheCreateTokens ?? 0)} cache write
            </span>
          </div>
        )}
      </div>

      <div className="my-3 h-px bg-canvas-border" />

      <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-canvas-muted">
        Rate limits
      </p>
      <div className="space-y-2">
        <RateRow label="5-hour" window={fiveHour} now={now} />
        <RateRow label="7-day" window={sevenDay} now={now} />
      </div>
      {rateEmpty && (
        <p className="mt-2 text-[10px] leading-snug text-canvas-muted">
          Waiting for the first data point. The server probes the API on boot and every 15 min;
          sending any chat message also refreshes these windows.
        </p>
      )}
    </div>
  );
}

interface SessionRowProps {
  label: string;
  value: React.ReactNode;
}

function SessionRow({ label, value }: SessionRowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-canvas-muted">{label}</span>
      <span className="text-[12px] font-medium text-canvas-fg">{value}</span>
    </div>
  );
}

/** Compact token formatter — keeps the breakdown row narrow on mobile. */
function compactToken(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface RateRowProps {
  label: string;
  window: RateLimitWindow | undefined;
  now: number;
}

function RateRow({ label, window, now }: RateRowProps) {
  const hasData = Boolean(window);
  const pct =
    window && typeof window.utilization === "number"
      ? Math.max(0, Math.min(100, Math.round(window.utilization * 100)))
      : null;
  const resetsAt = toMillis(window?.resetsAt);
  const resetsLabel = resetsAt ? `resets in ${formatResetsIn(resetsAt, now)}` : "";

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-canvas-muted">{label}</span>
      <span className="flex items-center gap-2">
        {!hasData ? (
          <span className="text-[12px] text-canvas-muted">—</span>
        ) : pct !== null ? (
          <span className={`text-[13px] font-semibold ${percentClass(pct, window!.status)}`}>
            {pct}%
          </span>
        ) : (
          <StatusBadge status={window!.status} />
        )}
        {window?.isUsingOverage && (
          <span className="rounded-full bg-orange-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-orange-500">
            overage
          </span>
        )}
        {resetsLabel && <span className="text-[10px] text-canvas-muted">{resetsLabel}</span>}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: RateLimitWindow["status"] }) {
  if (status === "rejected") {
    return (
      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-500">
        Limit hit
      </span>
    );
  }
  if (status === "allowed_warning") {
    return (
      <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[11px] font-semibold text-orange-500">
        Warning
      </span>
    );
  }
  return (
    <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[11px] font-semibold text-green-500">
      Allowed
    </span>
  );
}

function percentClass(pct: number, status: RateLimitWindow["status"]): string {
  if (status === "rejected" || pct >= 100) return "text-red-500";
  if (status === "allowed_warning" || pct >= 80) return "text-orange-500";
  return "text-canvas-fg";
}
