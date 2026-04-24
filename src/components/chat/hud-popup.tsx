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
 * Account-scoped rate-limits popup — only the two rows the user asked for.
 *
 * Data sources are:
 *   - A /v1/messages ping the server fires on boot + every 15 min
 *     (populates `status` + `resetsAt` + `isUsingOverage` via the
 *     `anthropic-ratelimit-unified-*` headers).
 *   - Live SDK `rate_limit_event` messages from active turns (can
 *     additionally carry an exact `utilization` 0..1 on some accounts).
 *
 * When `utilization` is unavailable we fall back to a status badge so the
 * user still gets the signal that matters: "do I have headroom right now?"
 */
export function HudPopup() {
  const [cache, setCache] = useState<RateLimitsCache | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // 1-second countdown tick. Mounted only while the popup is open.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Fetch on mount + every 30s.
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
    <div className="animate-modal-in absolute right-0 top-full z-50 mt-1.5 min-w-[280px] rounded-xl border border-canvas-border bg-canvas-bg p-3 shadow-xl">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-canvas-muted">
        Rate limits
      </p>
      <div className="space-y-2">
        <Row label="5-hour" window={fiveHour} now={now} />
        <Row label="7-day" window={sevenDay} now={now} />
      </div>
      {empty && (
        <p className="mt-2 text-[10px] leading-snug text-canvas-muted">
          Waiting for the first data point. The server probes the API on boot and every 15 min;
          sending any chat message also refreshes these windows.
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
