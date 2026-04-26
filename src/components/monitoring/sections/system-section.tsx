"use client";

import { useMonPoll } from "@/lib/monitoring/use-mon-poll";
import { formatBytes, formatBytesPerSec, formatPercent } from "@/lib/monitoring/format";
import { bandStatus, DISK_USAGE, PERCENT_USAGE } from "@/lib/monitoring/threshold";
import type { SystemSnapshot } from "@/lib/monitoring/types";
import { useMonContext } from "../monitoring-context";
import { MetricCard } from "../primitives/metric-card";
import { SectionGrid } from "../primitives/section-grid";
import { ThresholdBar } from "../primitives/threshold-bar";

export function SystemSection() {
  const { refreshMs, paused } = useMonContext();
  const { data, error } = useMonPoll<SystemSnapshot>("/api/monitoring/system", {
    intervalMs: refreshMs,
    paused,
  });

  if (error && !data) {
    return <p className="p-4 text-[12px] text-[var(--mon-critical)]">Error: {error.message}</p>;
  }

  const memPct =
    data && data.memory.totalBytes > 0 ? (data.memory.usedBytes / data.memory.totalBytes) * 100 : 0;
  const swapPct =
    data && data.swap.totalBytes > 0 ? (data.swap.usedBytes / data.swap.totalBytes) * 100 : 0;
  const fdPct =
    data && data.fileDescriptors.limit > 0
      ? (data.fileDescriptors.open / data.fileDescriptors.limit) * 100
      : 0;

  return (
    <div className="space-y-4 p-4">
      {/* Host info */}
      {data ? (
        <div className="rounded-xl border border-canvas-border bg-canvas-bg p-3 text-[11.5px] text-canvas-muted">
          <span className="font-mono text-canvas-fg">{data.host.distro ?? data.host.platform}</span>
          {data.host.release ? <span className="ml-2">{data.host.release}</span> : null}
          {data.host.kernel ? <span className="ml-2">· {data.host.kernel}</span> : null}
          <span className="ml-2">
            · {data.host.arch} · {data.host.cores} cores · {formatBytes(data.host.totalRamBytes)}{" "}
            RAM
          </span>
          {data.host.hostname ? <span className="ml-2">· {data.host.hostname}</span> : null}
        </div>
      ) : null}

      {/* CPU */}
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">CPU</h3>
      <div className="rounded-xl border border-canvas-border bg-canvas-bg p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-canvas-muted">Aggregate</p>
            <p
              className="text-[28px] font-semibold tabular-nums"
              style={{
                color:
                  (data?.cpu.aggregatePct ?? 0) > 85
                    ? "var(--mon-critical)"
                    : (data?.cpu.aggregatePct ?? 0) > 70
                      ? "var(--mon-warning)"
                      : "var(--mon-healthy)",
              }}
            >
              {data ? formatPercent(data.cpu.aggregatePct) : "—"}
            </p>
          </div>
          {data?.cpu.tempCelsius != null ? (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-canvas-muted">Temp</p>
              <p className="text-[16px] font-semibold tabular-nums text-canvas-fg">
                {data.cpu.tempCelsius.toFixed(0)}°C
              </p>
            </div>
          ) : null}
          <div>
            <p className="text-[11px] uppercase tracking-wide text-canvas-muted">Load 1m</p>
            <p className="font-mono text-[14px] tabular-nums text-canvas-fg">
              {data?.cpu.load1.toFixed(2) ?? "—"}
            </p>
          </div>
        </div>

        {data && data.cpu.perCorePct.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {data.cpu.perCorePct.map((pct, i) => (
              <ThresholdBar
                key={i}
                value={pct}
                thresholds={PERCENT_USAGE}
                label={`c${i}`}
                height={6}
              />
            ))}
          </div>
        ) : null}
      </div>

      {/* Memory */}
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
        Memory
      </h3>
      <SectionGrid minCardWidth={220}>
        <MetricCard
          label="RAM"
          value={
            data
              ? `${formatBytes(data.memory.usedBytes)} / ${formatBytes(data.memory.totalBytes)}`
              : "—"
          }
          status={bandStatus(memPct, PERCENT_USAGE)}
          sparkline={data?.memory.series}
          sparklineDomain={[0, 100]}
        />
        <MetricCard
          label="Swap"
          value={
            data && data.swap.totalBytes > 0
              ? `${formatBytes(data.swap.usedBytes)} / ${formatBytes(data.swap.totalBytes)}`
              : "—"
          }
          status={data && swapPct > 50 ? "warning" : "healthy"}
        />
        <MetricCard label="Cached" value={data ? formatBytes(data.memory.cachedBytes) : "—"} />
        <MetricCard label="Buffers" value={data ? formatBytes(data.memory.buffersBytes) : "—"} />
      </SectionGrid>

      {/* Disks */}
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">Disks</h3>
      <div className="space-y-2">
        {(data?.disks ?? []).map((disk) => {
          const pct = disk.totalBytes > 0 ? (disk.usedBytes / disk.totalBytes) * 100 : 0;
          return (
            <div
              key={disk.mount}
              className="rounded-xl border border-canvas-border bg-canvas-bg p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
                <span className="font-mono text-canvas-fg">{disk.mount}</span>
                <span className="text-canvas-muted">{disk.fsType}</span>
                <span className="text-canvas-muted">
                  Free {formatBytes(disk.availBytes)} of {formatBytes(disk.totalBytes)}
                </span>
                <span className="text-canvas-muted">
                  R {formatBytesPerSec(disk.readBytesPerSec)} · W{" "}
                  {formatBytesPerSec(disk.writeBytesPerSec)}
                </span>
              </div>
              <div className="mt-2">
                <ThresholdBar value={pct} thresholds={DISK_USAGE} height={6} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Network */}
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-canvas-muted">
        Network
      </h3>
      <div className="space-y-2">
        {(data?.interfaces ?? []).map((iface) => (
          <div
            key={iface.iface}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-canvas-border bg-canvas-bg p-3 text-[11.5px]"
          >
            <span className="min-w-[80px] font-mono text-canvas-fg">{iface.iface}</span>
            <span className="text-canvas-muted">↓ {formatBytesPerSec(iface.rxBytesPerSec)}</span>
            <span className="text-canvas-muted">↑ {formatBytesPerSec(iface.txBytesPerSec)}</span>
            {iface.rxErrors > 0 || iface.txErrors > 0 ? (
              <span className="text-[var(--mon-warning)]">
                errors RX {iface.rxErrors} / TX {iface.txErrors}
              </span>
            ) : null}
            {iface.rxDropped > 0 || iface.txDropped > 0 ? (
              <span className="text-[var(--mon-warning)]">
                dropped RX {iface.rxDropped} / TX {iface.txDropped}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      {/* File descriptors */}
      {data && data.fileDescriptors.limit > 0 ? (
        <div className="rounded-xl border border-canvas-border bg-canvas-bg p-3">
          <div className="mb-1 flex items-center justify-between text-[11.5px]">
            <span className="text-canvas-fg">File descriptors</span>
            <span className="font-mono tabular-nums text-canvas-muted">
              {data.fileDescriptors.open.toLocaleString()} /{" "}
              {data.fileDescriptors.limit.toLocaleString()}
            </span>
          </div>
          <ThresholdBar value={fdPct} thresholds={PERCENT_USAGE} height={6} />
        </div>
      ) : null}
    </div>
  );
}
