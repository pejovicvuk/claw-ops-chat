"use client";

import { useState } from "react";
import { FiBox } from "react-icons/fi";
import { useMonPoll } from "@/lib/monitoring/use-mon-poll";
import {
  formatBytes,
  formatBytesPerSec,
  formatDurationMs,
  formatPercent,
} from "@/lib/monitoring/format";

function uptimeOf(startedAt: number | null): string {
  return startedAt ? formatDurationMs(Date.now() - startedAt) : "—";
}
import type { DockerContainerRow, DockerSnapshot } from "@/lib/monitoring/types";
import { useMonContext } from "../monitoring-context";
import { DataTable } from "../primitives/data-table";
import { EmptyState } from "../primitives/empty-state";
import { MetricCard } from "../primitives/metric-card";
import { SectionGrid } from "../primitives/section-grid";
import { Sparkline } from "../primitives/sparkline";
import { StatusBadge } from "../primitives/status-badge";
import { DockerContainerDrawer } from "./docker-container-drawer";
import { DockerPrunePanel } from "./docker-prune-panel";

export function DockerSection() {
  const { refreshMs, paused, panel, setPanel } = useMonContext();
  const { data, error } = useMonPoll<DockerSnapshot>("/api/monitoring/docker", {
    intervalMs: refreshMs,
    paused,
  });
  const [search, setSearch] = useState("");
  const [showStopped, setShowStopped] = useState(false);

  if (error && !data) {
    return <p className="p-4 text-[12px] text-[var(--mon-critical)]">Error: {error.message}</p>;
  }

  if (data && !data.available) {
    return (
      <div className="p-4">
        <EmptyState
          icon={<FiBox size={28} />}
          title="Docker monitoring not configured"
          description={`${data.reason ?? "Mount /var/run/docker.sock into the container to enable Docker monitoring."} The chat container needs read access to the Docker daemon socket.`}
        />
      </div>
    );
  }

  const containers = (data?.containers ?? []).filter((c) => {
    if (!showStopped && c.status !== "running") return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q);
  });

  const selectedId = panel?.startsWith("container:") ? panel.slice("container:".length) : null;
  const selectedContainer = selectedId
    ? (data?.containers.find((c) => c.id === selectedId) ?? null)
    : null;

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusBadge
            status={data?.daemon.connected ? "healthy" : "warning"}
            size="sm"
            label={
              data?.daemon.connected
                ? `Connected · v${data?.daemon.version ?? "—"}`
                : "Disconnected"
            }
          />
          <span className="text-[11.5px] text-canvas-muted">
            {data?.aggregates.running ?? 0} running · {data?.aggregates.stopped ?? 0} stopped
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Search containers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg border border-canvas-border bg-canvas-bg px-3 py-1.5 text-[12px] text-canvas-fg outline-none focus:border-accent"
          />
          <label className="flex items-center gap-1.5 text-[11.5px] text-canvas-muted">
            <input
              type="checkbox"
              checked={showStopped}
              onChange={(e) => setShowStopped(e.target.checked)}
            />
            Show stopped
          </label>
        </div>
      </div>

      {/* Disk cleanup (auto-prune + manual button) */}
      <DockerPrunePanel />

      {/* Aggregates */}
      <SectionGrid minCardWidth={180}>
        <MetricCard
          label="Images"
          value={data?.aggregates.images.count ?? "—"}
          unit={data ? formatBytes(data.aggregates.images.sizeBytes) : ""}
        />
        <MetricCard label="Volumes" value={data?.aggregates.volumes.count ?? "—"} />
        <MetricCard label="Networks" value={data?.aggregates.networks.count ?? "—"} />
      </SectionGrid>

      {/* Containers */}
      <DataTable<DockerContainerRow>
        columns={[
          {
            key: "status",
            header: "Status",
            width: "100px",
            cell: (c) => (
              <StatusBadge
                status={c.status === "running" ? "healthy" : "unknown"}
                size="xs"
                label={c.status}
              />
            ),
          },
          {
            key: "name",
            header: "Name",
            sortable: true,
            sortValue: (c) => c.name,
            cell: (c) => <span className="font-medium">{c.name}</span>,
          },
          {
            key: "image",
            header: "Image",
            sortable: true,
            sortValue: (c) => c.image,
            cell: (c) => (
              <span className="block truncate text-canvas-muted" title={c.image}>
                {c.image}
              </span>
            ),
          },
          {
            key: "cpu",
            header: "CPU",
            width: "80px",
            align: "right",
            sortable: true,
            sortValue: (c) => c.cpuPct,
            cell: (c) => <span className="font-mono tabular-nums">{formatPercent(c.cpuPct)}</span>,
          },
          {
            key: "cpu-spark",
            header: "",
            width: "80px",
            cell: (c) =>
              c.cpuSeries.length > 0 ? (
                <Sparkline values={c.cpuSeries} ariaLabel={`${c.name} CPU`} />
              ) : null,
          },
          {
            key: "mem",
            header: "Mem",
            width: "120px",
            align: "right",
            sortable: true,
            sortValue: (c) => c.memBytes,
            cell: (c) => (
              <span className="font-mono tabular-nums text-canvas-muted">
                {formatBytes(c.memBytes)}{" "}
                {c.memLimitBytes > 0 ? `/ ${formatBytes(c.memLimitBytes)}` : ""}
              </span>
            ),
          },
          {
            key: "uptime",
            header: "Up",
            width: "80px",
            align: "right",
            sortable: true,
            sortValue: (c) => c.startedAt ?? 0,
            cell: (c) => (
              <span className="font-mono tabular-nums text-canvas-muted">
                {uptimeOf(c.startedAt)}
              </span>
            ),
          },
        ]}
        rows={containers}
        rowKey={(c) => c.id}
        defaultSort={{ key: "cpu", dir: "desc" }}
        onRowClick={(c) => setPanel(`container:${c.id}`)}
        maxHeight={500}
      />

      {selectedContainer ? (
        <DockerContainerDrawer container={selectedContainer} onClose={() => setPanel(null)} />
      ) : null}
    </div>
  );
}

// Placeholder usage to silence the "unused" lint warning.
void formatBytesPerSec;
