"use client";

import { FiDownload, FiPause, FiPlay } from "react-icons/fi";
import { useMonContext, type MonRefreshOption, type MonRangeOption } from "./monitoring-context";

const REFRESH_OPTIONS: ReadonlyArray<{ value: MonRefreshOption; label: string }> = [
  { value: "2s", label: "2s" },
  { value: "5s", label: "5s" },
  { value: "10s", label: "10s" },
  { value: "30s", label: "30s" },
  { value: "off", label: "Off" },
];

const RANGE_OPTIONS: ReadonlyArray<{ value: MonRangeOption; label: string }> = [
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" },
];

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

export function MonitoringToolbar() {
  const { range, setRange, refresh, setRefresh, paused, setPaused } = useMonContext();

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-canvas-border px-3 py-2">
      <div
        className="inline-flex overflow-hidden rounded-md border border-canvas-border"
        role="group"
        aria-label="Time range"
      >
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setRange(opt.value)}
            className={`px-2 py-1 text-[11px] font-medium transition-colors ${
              range === opt.value
                ? "bg-canvas-surface-hover text-canvas-fg"
                : "text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
            }`}
            aria-pressed={range === opt.value}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="inline-flex items-center gap-1.5 rounded-md border border-canvas-border px-2">
        <span className="text-[10.5px] text-canvas-muted">Refresh</span>
        <select
          value={refresh}
          onChange={(e) => setRefresh(e.target.value as MonRefreshOption)}
          className="bg-transparent py-1 pr-1 text-[11px] font-medium text-canvas-fg outline-none"
        >
          {REFRESH_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={() => setPaused(!paused)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
          paused
            ? "border-[var(--mon-warning)]/30 bg-[var(--mon-warning)]/10 text-[var(--mon-warning)]"
            : "border-canvas-border text-canvas-muted hover:text-canvas-fg"
        }`}
        aria-pressed={paused}
        title={paused ? "Resume live updates" : "Pause live updates"}
      >
        {paused ? <FiPlay size={11} /> : <FiPause size={11} />}
        {paused ? "Paused" : "Pause"}
      </button>

      <a
        href={`${BASE}/api/monitoring/snapshot`}
        download
        className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-canvas-border px-2 py-1 text-[11px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
        title="Export snapshot of all sections as JSON"
      >
        <FiDownload size={11} />
        Snapshot
      </a>
    </div>
  );
}
