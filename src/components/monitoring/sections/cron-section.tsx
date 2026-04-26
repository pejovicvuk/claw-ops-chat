"use client";

import { useMonPoll } from "@/lib/monitoring/use-mon-poll";
import { formatDurationMs, formatPercent } from "@/lib/monitoring/format";
import type { CronSnapshot } from "@/lib/monitoring/types";
import { useMonContext } from "../monitoring-context";
import { MetricCard } from "../primitives/metric-card";
import { SectionGrid } from "../primitives/section-grid";

export function CronSection() {
  const { refreshMs, paused } = useMonContext();
  const { data, error } = useMonPoll<CronSnapshot>("/api/monitoring/cron", {
    intervalMs: refreshMs,
    paused,
  });

  if (error && !data) {
    return <p className="p-4 text-[12px] text-[var(--mon-critical)]">Error: {error.message}</p>;
  }

  const max = data ? Math.max(1, ...data.aggregates.runsByHour) : 1;

  return (
    <div className="space-y-4 p-4">
      <SectionGrid minCardWidth={180}>
        <MetricCard label="Jobs total" value={data?.aggregates.jobsTotal ?? "—"} />
        <MetricCard label="Active" value={data?.aggregates.jobsActive ?? "—"} status="info" />
        <MetricCard
          label="Running now"
          value={data?.aggregates.jobsRunning ?? "—"}
          status={(data?.aggregates.jobsRunning ?? 0) > 0 ? "warning" : "healthy"}
        />
        <MetricCard label="Runs (24h)" value={data?.aggregates.runsLast24h ?? "—"} />
        <MetricCard
          label="Success rate"
          value={data ? formatPercent(data.aggregates.successRate) : "—"}
          status={
            data && data.aggregates.successRate < 95
              ? "warning"
              : data && data.aggregates.successRate < 80
                ? "critical"
                : "healthy"
          }
        />
        <MetricCard
          label="Avg duration"
          value={data ? formatDurationMs(data.aggregates.avgDurationMs) : "—"}
        />
      </SectionGrid>

      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
          Runs per hour (last 24h)
        </h3>
        <div className="flex h-[80px] items-end gap-0.5 rounded-xl border border-canvas-border bg-canvas-bg p-2">
          {(data?.aggregates.runsByHour ?? new Array(24).fill(0)).map((count, i) => {
            const height = (count / max) * 100;
            return (
              <div
                key={i}
                title={`${count} runs ${24 - i}h ago`}
                className="flex-1 rounded-sm bg-accent/40 transition-colors hover:bg-accent/60"
                style={{ height: `${Math.max(2, height)}%` }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
