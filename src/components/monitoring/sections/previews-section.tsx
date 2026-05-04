"use client";

import { useMonPoll } from "@/lib/monitoring/use-mon-poll";
import {
  formatBytes,
  formatDurationMs,
  formatNumber,
  formatPercent,
  formatTimeAgo,
} from "@/lib/monitoring/format";
import type { PreviewItemRow, PreviewsSnapshot } from "@/lib/monitoring/types";
import { useMonContext } from "../monitoring-context";
import { DataTable } from "../primitives/data-table";
import { MetricCard } from "../primitives/metric-card";
import { SectionGrid } from "../primitives/section-grid";
import { StatusBadge } from "../primitives/status-badge";

/**
 * Phase 6a (#134): "Previews" monitoring section. Surfaces the
 * concurrent-preview cap, Chromium aggregate CPU/RAM, and a per-preview
 * row with heartbeat health, frame counts, and restart count.
 *
 * Single-user model: all rows are owned by the same actor, but we still
 * show the email column so an operator scanning the audit log later
 * can match these rows against `category=preview` events.
 */
export function PreviewsSection() {
  const { refreshMs, paused } = useMonContext();
  const { data, error } = useMonPoll<PreviewsSnapshot>("/api/monitoring/previews", {
    intervalMs: refreshMs,
    paused,
  });

  if (error && !data) {
    return <p className="p-4 text-[12px] text-[var(--mon-critical)]">Error: {error.message}</p>;
  }

  const active = data?.active ?? 0;
  const max = data?.maxActive ?? 0;
  const capStatus = max === 0 ? "info" : active >= max ? "critical" : active > 0 ? "healthy" : "info";

  return (
    <div className="space-y-4 p-4">
      <SectionGrid minCardWidth={180}>
        <MetricCard
          label="Active previews"
          value={data ? `${active} / ${max}` : "—"}
          status={capStatus}
          sparkline={data?.series.active}
        />
        <MetricCard
          label="Chromium CPU"
          value={data?.chromium.cpuPct != null ? formatPercent(data.chromium.cpuPct) : "—"}
        />
        <MetricCard
          label="Chromium RAM"
          value={data?.chromium.memBytes != null ? formatBytes(data.chromium.memBytes) : "—"}
        />
        <MetricCard
          label="Frames sent"
          value={data ? formatNumber(data.totalFramesSent) : "—"}
        />
        <MetricCard
          label="Bytes sent"
          value={data ? formatBytes(data.totalBytesSent) : "—"}
        />
        <MetricCard
          label="Restarts"
          value={data ? formatNumber(data.totalRestartCount) : "—"}
          status={data && data.totalRestartCount > 0 ? "warning" : "info"}
        />
      </SectionGrid>

      <DataTable<PreviewItemRow>
        columns={[
          {
            key: "health",
            header: "Health",
            width: "100px",
            cell: (p) => <HeartbeatBadge row={p} />,
          },
          {
            key: "subject",
            header: "Project / Item",
            sortable: true,
            sortValue: (p) => `${p.projectSlug}/${p.itemSlug}`,
            cell: (p) => (
              <span className="font-mono text-[11px]">
                {p.projectSlug}/{p.itemSlug}
              </span>
            ),
          },
          {
            key: "port",
            header: "Port",
            width: "60px",
            align: "right",
            sortable: true,
            sortValue: (p) => p.port,
            cell: (p) => <span className="font-mono">{p.port}</span>,
          },
          {
            key: "codec",
            header: "Codec",
            width: "70px",
            cell: (p) => (
              <span className="font-mono text-[11px] text-canvas-muted uppercase">{p.codec}</span>
            ),
          },
          {
            key: "uptime",
            header: "Up",
            width: "80px",
            align: "right",
            sortable: true,
            sortValue: (p) => p.openedAt,
            cell: (p) => (
              <span className="font-mono tabular-nums text-canvas-muted">
                {formatDurationMs(Date.now() - p.openedAt)}
              </span>
            ),
          },
          {
            key: "frames",
            header: "Frames",
            width: "90px",
            align: "right",
            sortable: true,
            sortValue: (p) => p.framesSent,
            cell: (p) => (
              <span className="font-mono tabular-nums">{formatNumber(p.framesSent)}</span>
            ),
          },
          {
            key: "bytes",
            header: "Bytes",
            width: "100px",
            align: "right",
            sortable: true,
            sortValue: (p) => p.bytesSent,
            cell: (p) => (
              <span className="font-mono tabular-nums text-canvas-muted">
                {formatBytes(p.bytesSent)}
              </span>
            ),
          },
          {
            key: "restarts",
            header: "Restarts",
            width: "80px",
            align: "right",
            sortable: true,
            sortValue: (p) => p.restartCount,
            cell: (p) => (
              <span
                className={`font-mono tabular-nums ${p.restartCount > 0 ? "text-[var(--mon-warning)]" : "text-canvas-muted"}`}
              >
                {p.restartCount}
              </span>
            ),
          },
          {
            key: "lastBeat",
            header: "Last beat",
            width: "90px",
            align: "right",
            cell: (p) => (
              <span className="font-mono text-[11px] text-canvas-muted">
                {p.lastHeartbeatAt ? formatTimeAgo(p.lastHeartbeatAt) : "—"}
              </span>
            ),
          },
        ]}
        rows={data?.items ?? []}
        rowKey={(p) => p.id}
        defaultSort={{ key: "uptime", dir: "desc" }}
        empty="No active preview windows"
        maxHeight={500}
      />
    </div>
  );
}

function HeartbeatBadge({ row }: { row: PreviewItemRow }) {
  if (row.consecutiveFailures >= 2) {
    return <StatusBadge status="critical" size="xs" label="stuck" />;
  }
  if (row.consecutiveFailures >= 1) {
    return <StatusBadge status="warning" size="xs" label="lagging" />;
  }
  if (row.lastHeartbeatAt) {
    return <StatusBadge status="healthy" size="xs" label="ok" />;
  }
  return <StatusBadge status="info" size="xs" label="starting" />;
}
