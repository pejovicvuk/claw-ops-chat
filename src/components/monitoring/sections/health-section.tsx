"use client";

import { useState } from "react";
import { FiZap } from "react-icons/fi";
import { authFetch } from "@/lib/auth";
import { useMonPoll } from "@/lib/monitoring/use-mon-poll";
import { formatBytes, formatDurationMs } from "@/lib/monitoring/format";
import { bandStatus, EVENT_LOOP_LAG_MS, PERCENT_USAGE } from "@/lib/monitoring/threshold";
import type { HealthSnapshot } from "@/lib/monitoring/types";
import { useMonContext } from "../monitoring-context";
import { ConfirmActionDialog } from "../primitives/confirm-action-dialog";
import { MetricCard } from "../primitives/metric-card";
import { SectionGrid } from "../primitives/section-grid";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

function lastFullGcLabel(at: number | null): string {
  return at ? `${formatDurationMs(Date.now() - at)} ago` : "—";
}

export function HealthSection() {
  const { refreshMs, paused } = useMonContext();
  const { data, error } = useMonPoll<HealthSnapshot>("/api/monitoring/health", {
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

  return (
    <div className="space-y-4 p-4">
      {/* Hero row */}
      <SectionGrid minCardWidth={200}>
        <MetricCard
          label="Uptime"
          value={data ? formatDurationMs(data.process.uptimeMs) : "—"}
          status="info"
        />
        <MetricCard label="PID" value={data?.process.pid ?? "—"} status="info" />
        <MetricCard label="Node" value={data?.process.nodeVersion ?? "—"} size="sm" status="info" />
      </SectionGrid>

      {/* Memory */}
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
        Memory
      </h3>
      <SectionGrid minCardWidth={200}>
        <MetricCard
          label="RSS"
          value={data ? formatBytes(data.memory.rssBytes) : "—"}
          status={data && data.memory.rssBytes > 1.5 * 1024 * 1024 * 1024 ? "warning" : "healthy"}
          sparkline={data?.series.rssBytes}
        />
        <MetricCard
          label="Heap used"
          value={data ? formatBytes(data.memory.heapUsedBytes) : "—"}
          unit={data ? `/ ${formatBytes(data.memory.heapTotalBytes)}` : ""}
          status={bandStatus(heapPct, PERCENT_USAGE)}
          sparkline={data?.series.heapUsedBytes}
        />
        <MetricCard label="External" value={data ? formatBytes(data.memory.externalBytes) : "—"} />
        <MetricCard
          label="Array buffers"
          value={data ? formatBytes(data.memory.arrayBuffersBytes) : "—"}
        />
      </SectionGrid>

      {/* Event loop & GC */}
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
        Event loop &amp; GC
      </h3>
      <SectionGrid minCardWidth={180}>
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

      {/* Admin actions */}
      <div className="rounded-xl border border-canvas-border bg-canvas-bg p-3">
        <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
          <FiZap size={11} /> Admin actions
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {typeof globalThis !== "undefined" ? (
            <button
              type="button"
              onClick={() => setConfirmGc(true)}
              className="rounded-md border border-canvas-border px-2.5 py-1.5 text-[11.5px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
            >
              Force GC
            </button>
          ) : null}
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
      </div>

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
