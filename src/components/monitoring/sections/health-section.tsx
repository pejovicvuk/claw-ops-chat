"use client";

import { useState } from "react";
import { FiZap } from "react-icons/fi";
import { authFetch } from "@/lib/auth";
import { useMonPoll } from "@/lib/monitoring/use-mon-poll";
import { useMonSeries } from "@/lib/monitoring/use-mon-series";
import { formatBytes, formatDurationMs } from "@/lib/monitoring/format";
import { bandStatus, EVENT_LOOP_LAG_MS, PERCENT_USAGE } from "@/lib/monitoring/threshold";
import type { HealthSnapshot } from "@/lib/monitoring/types";
import { useMonContext } from "../monitoring-context";
import { CollapsibleBlock } from "../primitives/collapsible-block";
import { ConfirmActionDialog } from "../primitives/confirm-action-dialog";
import { MetricBar } from "../primitives/metric-bar";
import { MetricCard } from "../primitives/metric-card";
import { MultiSeriesChart } from "../primitives/multi-series-chart";
import { SectionGrid } from "../primitives/section-grid";
import { StatusBadge } from "../primitives/status-badge";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

const RANGE_TO_MS: Record<string, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
};

const COLOR_HEAP = "#6c8aff"; // blue
const COLOR_RSS = "#4ecdc4"; // teal
const COLOR_LOOP_P50 = "#22c55e"; // green
const COLOR_LOOP_P95 = "#f59e0b"; // amber
const COLOR_LOOP_P99 = "#ef4444"; // red

function lastFullGcLabel(at: number | null): string {
  return at ? `${formatDurationMs(Date.now() - at)} ago` : "—";
}

export function HealthSection() {
  const { refreshMs, paused } = useMonContext();
  const { data, error } = useMonPoll<HealthSnapshot>("/api/monitoring/health", {
    intervalMs: refreshMs,
    paused,
  });
  const [chartRange, setChartRange] = useState<keyof typeof RANGE_TO_MS>("15m");
  const memoryChart = useMonSeries({
    metrics: ["heapUsedBytes", "rssBytes", "externalBytes"],
    rangeMs: RANGE_TO_MS[chartRange],
    intervalMs: refreshMs,
    paused,
  });
  const loopChart = useMonSeries({
    metrics: ["loopP50Ms", "loopP95Ms", "loopP99Ms"],
    rangeMs: RANGE_TO_MS[chartRange],
    intervalMs: refreshMs,
    paused,
  });
  const [confirmGc, setConfirmGc] = useState(false);
  const [confirmHeap, setConfirmHeap] = useState(false);
  const [actionResult, setActionResult] = useState<string | null>(null);

  if (error && !data) {
    return <p className="p-4 text-[12px] text-[var(--mon-critical)]">Error: {error.message}</p>;
  }

  const heapPct =
    data && data.memory.heapTotalBytes > 0
      ? (data.memory.heapUsedBytes / data.memory.heapTotalBytes) * 100
      : 0;
  const rssAbs = data?.memory.rssBytes ?? 0;
  const heapStatus = bandStatus(heapPct, PERCENT_USAGE);
  const lagStatus = bandStatus(data?.eventLoop.lagP95Ms ?? 0, EVENT_LOOP_LAG_MS);

  return (
    <div className="space-y-4 p-4">
      {/* Hero strip */}
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-canvas-border bg-canvas-bg p-4 sm:grid-cols-4">
        <HeroCell label="Uptime" value={data ? formatDurationMs(data.process.uptimeMs) : "—"} />
        <HeroCell label="PID" value={data ? String(data.process.pid) : "—"} />
        <HeroCell label="Node" value={data?.process.nodeVersion ?? "—"} />
        <HeroCell
          label="Started"
          value={data ? new Date(data.process.startedAt).toLocaleString() : "—"}
        />
      </div>

      {/* Range selector for charts */}
      <div className="flex items-center justify-end gap-1">
        <span className="mr-2 text-[11px] text-canvas-muted">Chart range:</span>
        {(Object.keys(RANGE_TO_MS) as (keyof typeof RANGE_TO_MS)[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setChartRange(r)}
            className={`rounded-md px-2 py-1 text-[10.5px] font-medium transition-colors ${
              chartRange === r
                ? "bg-canvas-fg text-canvas-bg"
                : "text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Memory */}
      <CollapsibleBlock
        title="Memory"
        description="Heap, RSS, external buffers"
        rightAdornment={<StatusBadge status={heapStatus} size="xs" />}
      >
        <div className="space-y-3">
          {memoryChart.data ? (
            <MultiSeriesChart
              ariaLabel={`Memory usage (MB), last ${chartRange}`}
              from={memoryChart.data.from}
              to={memoryChart.data.to}
              yMin={0}
              yMax="auto"
              yUnit=" MB"
              height={160}
              series={[
                {
                  label: "Heap used",
                  color: COLOR_HEAP,
                  points: scaleBytes(memoryChart.data.series.heapUsedBytes ?? []),
                },
                {
                  label: "RSS",
                  color: COLOR_RSS,
                  points: scaleBytes(memoryChart.data.series.rssBytes ?? []),
                },
                {
                  label: "External",
                  color: "#a78bfa",
                  points: scaleBytes(memoryChart.data.series.externalBytes ?? []),
                },
              ]}
            />
          ) : (
            <div className="h-[160px] animate-pulse rounded-md bg-canvas-surface-hover" />
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <MetricBar
              value={heapPct}
              label="Heap"
              secondary={
                data
                  ? `${formatBytes(data.memory.heapUsedBytes)} / ${formatBytes(data.memory.heapTotalBytes)}`
                  : undefined
              }
            />
            <MetricBar
              value={rssAbs > 0 ? Math.min(100, (rssAbs / (2 * 1024 * 1024 * 1024)) * 100) : null}
              label="RSS / 2GB"
              secondary={data ? formatBytes(rssAbs) : undefined}
            />
          </div>
          <SectionGrid minCardWidth={180}>
            <MetricCard
              label="Heap used"
              value={data ? formatBytes(data.memory.heapUsedBytes) : "—"}
              unit={data ? `/ ${formatBytes(data.memory.heapTotalBytes)}` : ""}
              status={heapStatus}
              sparkline={data?.series.heapUsedBytes}
            />
            <MetricCard
              label="RSS"
              value={data ? formatBytes(data.memory.rssBytes) : "—"}
              status={
                data && data.memory.rssBytes > 1.5 * 1024 * 1024 * 1024 ? "warning" : "healthy"
              }
              sparkline={data?.series.rssBytes}
            />
            <MetricCard
              label="External"
              value={data ? formatBytes(data.memory.externalBytes) : "—"}
            />
            <MetricCard
              label="Array buffers"
              value={data ? formatBytes(data.memory.arrayBuffersBytes) : "—"}
            />
          </SectionGrid>
        </div>
      </CollapsibleBlock>

      {/* Event loop & GC */}
      <CollapsibleBlock
        title="Event loop & GC"
        description="Latency percentiles and garbage-collection pressure"
        rightAdornment={<StatusBadge status={lagStatus} size="xs" />}
      >
        <div className="space-y-3">
          {loopChart.data ? (
            <MultiSeriesChart
              ariaLabel={`Event-loop lag, last ${chartRange}`}
              from={loopChart.data.from}
              to={loopChart.data.to}
              yMin={0}
              yMax="auto"
              yUnit="ms"
              height={140}
              series={[
                {
                  label: "p50",
                  color: COLOR_LOOP_P50,
                  points: loopChart.data.series.loopP50Ms ?? [],
                },
                {
                  label: "p95",
                  color: COLOR_LOOP_P95,
                  points: loopChart.data.series.loopP95Ms ?? [],
                },
                {
                  label: "p99",
                  color: COLOR_LOOP_P99,
                  points: loopChart.data.series.loopP99Ms ?? [],
                },
              ]}
            />
          ) : (
            <div className="h-[140px] animate-pulse rounded-md bg-canvas-surface-hover" />
          )}
          <SectionGrid minCardWidth={170}>
            <MetricCard
              label="Loop lag p50"
              value={data ? formatDurationMs(data.eventLoop.lagP50Ms) : "—"}
              status={bandStatus(data?.eventLoop.lagP50Ms ?? 0, EVENT_LOOP_LAG_MS)}
            />
            <MetricCard
              label="Loop lag p95"
              value={data ? formatDurationMs(data.eventLoop.lagP95Ms) : "—"}
              status={bandStatus(data?.eventLoop.lagP95Ms ?? 0, EVENT_LOOP_LAG_MS)}
              sparkline={data?.series.eventLoopLagP95Ms}
              helpText="95th percentile event-loop blocking time. Above 100ms means the server is becoming unresponsive."
            />
            <MetricCard
              label="Loop lag p99"
              value={data ? formatDurationMs(data.eventLoop.lagP99Ms) : "—"}
              status={bandStatus(data?.eventLoop.lagP99Ms ?? 0, EVENT_LOOP_LAG_MS)}
            />
            <MetricCard
              label="GC pauses / min"
              value={data?.gc.pausesPerMin ?? "—"}
              sparkline={data?.series.gcPausesPerMin}
            />
            <MetricCard
              label="GC time / min"
              value={data ? formatDurationMs(data.gc.totalPauseMsPerMin) : "—"}
              helpText="Total time spent in GC pauses in the trailing minute. >5% of wall-clock means heap pressure."
            />
            <MetricCard
              label="Last full GC"
              value={lastFullGcLabel(data?.gc.lastFullGcAt ?? null)}
              size="sm"
            />
          </SectionGrid>
        </div>
      </CollapsibleBlock>

      {/* Admin actions */}
      <CollapsibleBlock
        title="Admin actions"
        description="Force GC, take a heap snapshot"
        defaultOpen={false}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirmGc(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-canvas-border px-2.5 py-1.5 text-[11.5px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiZap size={11} /> Force GC
          </button>
          <button
            type="button"
            onClick={() => setConfirmHeap(true)}
            className="rounded-md border border-canvas-border px-2.5 py-1.5 text-[11.5px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            Take heap snapshot
          </button>
          {actionResult ? (
            <span className="ml-2 text-[11px] text-canvas-muted">{actionResult}</span>
          ) : null}
        </div>
      </CollapsibleBlock>

      {confirmGc ? (
        <ConfirmActionDialog
          title="Force garbage collection"
          description="Triggers a full GC sweep. Briefly pauses the event loop. Requires Node started with --expose-gc."
          auditSubject="monitoring.force_gc"
          confirmLabel="Force GC"
          onConfirm={async () => {
            const res = await authFetch(`${BASE}/api/monitoring/actions/force-gc`, {
              method: "POST",
            });
            const json = (await res.json()) as { freedBytes?: number; error?: string };
            if (!res.ok) throw new Error(json.error ?? `${res.status}`);
            setActionResult(`Freed ${formatBytes(json.freedBytes ?? 0)}`);
          }}
          onClose={() => setConfirmGc(false)}
        />
      ) : null}
      {confirmHeap ? (
        <ConfirmActionDialog
          title="Take heap snapshot"
          description="Writes a .heapsnapshot file to /root/.monitoring/heap-snapshots/. May briefly pause the server. The file can be opened in Chrome DevTools."
          auditSubject="monitoring.heap_snapshot"
          confirmLabel="Take snapshot"
          onConfirm={async () => {
            const res = await authFetch(`${BASE}/api/monitoring/actions/heap-snapshot`, {
              method: "POST",
            });
            const json = (await res.json()) as { filename?: string; error?: string };
            if (!res.ok) throw new Error(json.error ?? `${res.status}`);
            setActionResult(`Saved ${json.filename}`);
          }}
          onClose={() => setConfirmHeap(false)}
        />
      ) : null}
    </div>
  );
}

function HeroCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-canvas-muted">{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-medium text-canvas-fg">{value}</p>
    </div>
  );
}

/** Convert raw bytes to MB so the chart Y-axis is readable. */
function scaleBytes(points: Array<{ t: number; v: number }>): Array<{ t: number; v: number }> {
  return points.map((p) => ({ t: p.t, v: p.v / (1024 * 1024) }));
}
