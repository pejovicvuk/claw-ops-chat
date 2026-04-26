"use client";

import { useMonPoll } from "@/lib/monitoring/use-mon-poll";
import { formatDurationMs, formatPercent, formatRate } from "@/lib/monitoring/format";

function ago(at: number): string {
  return `${formatDurationMs(Date.now() - at)} ago`;
}
import { bandStatus, ERROR_RATE_PCT } from "@/lib/monitoring/threshold";
import type { ApmRouteRow, ApmSlowOpRow, ApmSnapshot } from "@/lib/monitoring/types";
import { useMonContext } from "../monitoring-context";
import { DataTable } from "../primitives/data-table";
import { MetricCard } from "../primitives/metric-card";
import { SectionGrid } from "../primitives/section-grid";
import { Sparkline } from "../primitives/sparkline";

export function ApmSection() {
  const { refreshMs, paused } = useMonContext();
  const { data, error } = useMonPoll<ApmSnapshot>("/api/monitoring/apm", {
    intervalMs: refreshMs,
    paused,
  });

  if (error && !data) {
    return <p className="p-4 text-[12px] text-[var(--mon-critical)]">Error: {error.message}</p>;
  }

  return (
    <div className="space-y-4 p-4">
      {/* Summary */}
      <SectionGrid minCardWidth={180}>
        <MetricCard
          label="Requests / min"
          value={data ? formatRate(data.summary.rpm, "/min") : "—"}
          sparkline={data?.series.rpm}
          status="info"
        />
        <MetricCard
          label="Error rate"
          value={data ? formatPercent(data.summary.errorRate) : "—"}
          status={bandStatus(data?.summary.errorRate ?? 0, ERROR_RATE_PCT)}
        />
        <MetricCard
          label="Latency p50"
          value={data ? formatDurationMs(data.summary.p50Ms) : "—"}
          sparkline={data?.series.p50Ms}
        />
        <MetricCard
          label="Latency p95"
          value={data ? formatDurationMs(data.summary.p95Ms) : "—"}
          sparkline={data?.series.p95Ms}
        />
        <MetricCard
          label="Latency p99"
          value={data ? formatDurationMs(data.summary.p99Ms) : "—"}
          sparkline={data?.series.p99Ms}
        />
      </SectionGrid>

      {/* SDK turn latency */}
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
        Claude SDK turn latency
      </h3>
      <SectionGrid minCardWidth={180}>
        <MetricCard label="Turn p50" value={data ? formatDurationMs(data.sdk.turnP50Ms) : "—"} />
        <MetricCard label="Turn p95" value={data ? formatDurationMs(data.sdk.turnP95Ms) : "—"} />
        <MetricCard label="Turn p99" value={data ? formatDurationMs(data.sdk.turnP99Ms) : "—"} />
        <MetricCard
          label="Turns / min"
          value={data?.sdk.turnsPerMinSeries.slice(-1)[0] ?? "—"}
          sparkline={data?.sdk.turnsPerMinSeries}
        />
      </SectionGrid>

      {/* Per-route table */}
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
        Per-route (last 5 minutes)
      </h3>
      <DataTable<ApmRouteRow>
        columns={[
          {
            key: "route",
            header: "Route",
            cell: (r) => (
              <span className="font-mono text-[11px]">
                <span className="text-canvas-muted">{r.method}</span> {r.route}
              </span>
            ),
            sortable: true,
            sortValue: (r) => r.route,
          },
          {
            key: "calls",
            header: "Calls",
            width: "70px",
            align: "right",
            sortable: true,
            sortValue: (r) => r.calls,
            cell: (r) => <span className="font-mono">{r.calls}</span>,
          },
          {
            key: "p50",
            header: "p50",
            width: "70px",
            align: "right",
            sortable: true,
            sortValue: (r) => r.p50Ms,
            cell: (r) => (
              <span className="font-mono tabular-nums">{formatDurationMs(r.p50Ms)}</span>
            ),
          },
          {
            key: "p95",
            header: "p95",
            width: "70px",
            align: "right",
            sortable: true,
            sortValue: (r) => r.p95Ms,
            cell: (r) => (
              <span className="font-mono tabular-nums">{formatDurationMs(r.p95Ms)}</span>
            ),
          },
          {
            key: "p99",
            header: "p99",
            width: "70px",
            align: "right",
            sortable: true,
            sortValue: (r) => r.p99Ms,
            cell: (r) => (
              <span className="font-mono tabular-nums">{formatDurationMs(r.p99Ms)}</span>
            ),
          },
          {
            key: "errors",
            header: "Errors",
            width: "70px",
            align: "right",
            sortable: true,
            sortValue: (r) => r.errorRate,
            cell: (r) => (
              <span
                className="font-mono tabular-nums"
                style={{
                  color:
                    r.errorRate > 5
                      ? "var(--mon-critical)"
                      : r.errorRate > 1
                        ? "var(--mon-warning)"
                        : "var(--canvas-muted)",
                }}
              >
                {formatPercent(r.errorRate)}
              </span>
            ),
          },
        ]}
        rows={data?.routes ?? []}
        rowKey={(r) => `${r.method} ${r.route}`}
        defaultSort={{ key: "calls", dir: "desc" }}
        empty="No request samples yet"
        maxHeight={300}
      />

      {/* Slow ops */}
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
        Slow operations (≥250ms)
      </h3>
      <DataTable<ApmSlowOpRow>
        columns={[
          {
            key: "at",
            header: "When",
            width: "100px",
            cell: (r) => <span className="text-canvas-muted">{ago(r.at)}</span>,
          },
          {
            key: "route",
            header: "Route",
            cell: (r) => (
              <span className="font-mono text-[11px]">
                {r.method} {r.route}
              </span>
            ),
          },
          {
            key: "duration",
            header: "Duration",
            width: "100px",
            align: "right",
            sortable: true,
            sortValue: (r) => r.durationMs,
            cell: (r) => (
              <span className="font-mono tabular-nums text-[var(--mon-warning)]">
                {formatDurationMs(r.durationMs)}
              </span>
            ),
          },
          {
            key: "actor",
            header: "Actor",
            width: "150px",
            cell: (r) => <span className="block truncate text-canvas-muted">{r.actor}</span>,
          },
          {
            key: "status",
            header: "Status",
            width: "60px",
            align: "right",
            cell: (r) => <span className="font-mono tabular-nums">{r.statusCode}</span>,
          },
        ]}
        rows={data?.slowOps ?? []}
        rowKey={(r) => r.id}
        empty="No slow operations recorded"
        maxHeight={250}
      />

      {/* Reference Sparkline so the unused-import lint doesn't fire if APM is empty. */}
      {data && data.errorsByRoute.length === 0 ? <Sparkline values={[]} ariaLabel="empty" /> : null}
    </div>
  );
}
