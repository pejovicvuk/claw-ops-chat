"use client";

import { useMemo, useState } from "react";
import { useMonPoll } from "@/lib/monitoring/use-mon-poll";
import { formatDurationMs, formatRate } from "@/lib/monitoring/format";
import type { LogErrorGroup, LogLevel, LogLine, LogsSnapshot } from "@/lib/monitoring/types";
import { useMonContext } from "../monitoring-context";
import { EmptyState } from "../primitives/empty-state";
import { MetricCard } from "../primitives/metric-card";
import { SectionGrid } from "../primitives/section-grid";

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: "text-canvas-muted",
  info: "text-canvas-fg",
  warn: "text-[var(--mon-warning)]",
  error: "text-[var(--mon-critical)]",
};

function ageMap(groups: LogErrorGroup[]): Map<string, string> {
  const map = new Map<string, string>();
  const now = Date.now();
  for (const g of groups) {
    map.set(g.fingerprint, formatDurationMs(now - g.lastSeen));
  }
  return map;
}

export function LogsSection() {
  const { refreshMs, paused } = useMonContext();
  const { data, error } = useMonPoll<LogsSnapshot>("/api/monitoring/logs", {
    intervalMs: refreshMs,
    paused,
  });
  const [search, setSearch] = useState("");
  const [showLevels, setShowLevels] = useState<Record<LogLevel, boolean>>({
    debug: false,
    info: true,
    warn: true,
    error: true,
  });

  const filtered = useMemo(() => {
    if (!data?.recent) return [];
    const q = search.toLowerCase().trim();
    return data.recent.filter((l) => {
      if (!showLevels[l.level]) return false;
      if (q && !l.message.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, search, showLevels]);

  const errorGroupAges = ageMap(data?.errorGroups ?? []);

  if (error && !data) {
    return <p className="p-4 text-[12px] text-[var(--mon-critical)]">Error: {error.message}</p>;
  }

  return (
    <div className="space-y-4 p-4">
      <SectionGrid minCardWidth={180}>
        <MetricCard
          label="Errors / 5m"
          value={data?.counts.errorsLast5m ?? "—"}
          status={
            data && data.counts.errorsLast5m > 10
              ? "critical"
              : data && data.counts.errorsLast5m > 0
                ? "warning"
                : "healthy"
          }
        />
        <MetricCard label="Errors / 1h" value={data?.counts.errorsLast1h ?? "—"} />
        <MetricCard label="Errors / 24h" value={data?.counts.errorsLast24h ?? "—"} />
        <MetricCard label="Tail rate" value={data ? formatRate(data.counts.tailRatePerSec) : "—"} />
      </SectionGrid>

      {data && data.errorGroups.length > 0 ? (
        <>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
            Error groups
          </h3>
          <ul className="space-y-2">
            {data.errorGroups.map((g) => (
              <li
                key={g.fingerprint}
                className="rounded-xl border border-[var(--mon-critical)]/20 bg-[var(--mon-critical)]/5 p-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[11.5px] text-[var(--mon-critical)]">
                    × {g.count}
                  </span>
                  <span className="text-[11px] text-canvas-muted">
                    last {errorGroupAges.get(g.fingerprint) ?? "—"} ago
                  </span>
                </div>
                <p className="mt-1 truncate text-[12px] text-canvas-fg">{g.sample.message}</p>
              </li>
            ))}
          </ul>
        </>
      ) : data?.counts.errorsLast24h === 0 ? (
        <EmptyState
          variant="celebratory"
          title="No errors in the last 24 hours"
          description="Logs and stderr capture is enabled. Errors will surface here automatically."
        />
      ) : null}

      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
        Live tail
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search log lines…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] rounded-lg border border-canvas-border bg-canvas-bg px-3 py-1.5 text-[12px] text-canvas-fg outline-none focus:border-accent"
        />
        {(Object.keys(showLevels) as LogLevel[]).map((lvl) => (
          <label key={lvl} className="flex items-center gap-1 text-[11px] text-canvas-muted">
            <input
              type="checkbox"
              checked={showLevels[lvl]}
              onChange={(e) => setShowLevels({ ...showLevels, [lvl]: e.target.checked })}
            />
            {lvl}
          </label>
        ))}
      </div>
      <div
        className="overflow-y-auto rounded-xl border border-canvas-border bg-canvas-bg p-2 font-mono text-[10.5px] leading-snug"
        style={{ maxHeight: 360 }}
      >
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-canvas-muted">No log lines</p>
        ) : (
          filtered.slice(-500).map((l, i) => <LogRow key={`${l.t}-${i}`} line={l} />)
        )}
      </div>
    </div>
  );
}

function LogRow({ line }: { line: LogLine }) {
  return (
    <p className={`whitespace-pre-wrap break-all ${LEVEL_COLOR[line.level]}`}>
      <span className="text-canvas-muted">
        {new Date(line.t).toISOString().slice(11, 23)} [{line.level}]{" "}
      </span>
      {line.message}
    </p>
  );
}
