"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth";
import { formatResetsIn, toMillis } from "@/lib/format-relative-time";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

interface RateLimitWindow {
  status: "allowed" | "allowed_warning" | "rejected";
  utilization?: number;
  resetsAt?: number | null;
  isUsingOverage?: boolean;
}

interface RateLimitsCache {
  updatedAt: number | null;
  windows: Record<string, RateLimitWindow>;
}

/**
 * Account-scoped rate-limits popup. Shows exactly two rows — the
 * Claude subscriber 5-hour and 7-day windows, same as VS Code's Claude
 * extension or the `/usage` slash command. Numbers are account-wide
 * (not per-session) so switching chats shows the same values.
 *
 * Data comes from `GET /chat/api/rate-limits`, which is populated by
 * the server whenever any turn in any session emits an SDK
 * `rate_limit_event`. If the cache is empty (fresh deployment, no
 * turns have run), the rows render "—" with a footnote.
 */
export function HudPopup() {
  const [cache, setCache] = useState<RateLimitsCache | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // One-second tick for the "resets in …" countdown. Mounted only while
  // the popup is open, so closed popups don't burn cycles.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Fetch on mount + every 30s. The fetch is authFetch-gated so it
  // rides the existing session cookie.
  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await authFetch(`${BASE}/api/rate-limits`);
        if (!res.ok) throw new Error("fetch");
        const data = (await res.json()) as RateLimitsCache;
        if (!cancelled) setCache(data);
      } catch {
        if (!cancelled) setCache({ updatedAt: null, windows: {} });
      }
    };
    void pull();
    const id = setInterval(pull, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const fiveHour = cache?.windows.five_hour;
  const sevenDay = cache?.windows.seven_day;
  const empty = !cache || (!fiveHour && !sevenDay);

  return (
    <div className="animate-modal-in absolute right-0 top-full z-50 mt-1.5 min-w-[260px] rounded-xl border border-canvas-border bg-canvas-bg p-3 shadow-xl">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-canvas-muted">
        Rate limits
      </p>
      <div className="space-y-1.5">
        <Row label="5-hour" window={fiveHour} now={now} />
        <Row label="7-day" window={sevenDay} now={now} />
      </div>
      {empty && (
        <p className="mt-2 text-[10px] leading-snug text-canvas-muted">
          Numbers appear after your first turn.
        </p>
      )}
    </div>
  );
}

interface RowProps {
  label: string;
  window: RateLimitWindow | undefined;
  now: number;
}

function Row({ label, window, now }: RowProps) {
  const pct =
    window && typeof window.utilization === "number"
      ? Math.max(0, Math.min(100, Math.round(window.utilization * 100)))
      : null;
  const resetsAt = toMillis(window?.resetsAt);
  const resetsLabel = resetsAt ? `resets in ${formatResetsIn(resetsAt, now)}` : "";
  const pctClass =
    pct === null
      ? "text-canvas-muted"
      : window?.status === "rejected" || pct >= 100
        ? "text-red-500"
        : pct >= 80
          ? "text-orange-500"
          : "text-canvas-fg";

  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-canvas-muted">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className={`text-[13px] font-semibold ${pctClass}`}>
          {pct === null ? "—" : `${pct}%`}
        </span>
        {resetsLabel && <span className="text-[10px] text-canvas-muted">{resetsLabel}</span>}
      </span>
    </div>
  );
}
