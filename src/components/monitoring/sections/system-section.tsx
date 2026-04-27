"use client";

import { useMonPoll } from "@/lib/monitoring/use-mon-poll";
import { formatBytes, formatBytesPerSec } from "@/lib/monitoring/format";
import { bandStatus, DISK_USAGE, PERCENT_USAGE } from "@/lib/monitoring/threshold";
import type { SystemSnapshot } from "@/lib/monitoring/types";
import { useMonContext } from "../monitoring-context";
import { CollapsibleBlock } from "../primitives/collapsible-block";
import { Gauge } from "../primitives/gauge";
import { MetricBar } from "../primitives/metric-bar";
import { MetricCard } from "../primitives/metric-card";
import { SectionGrid } from "../primitives/section-grid";
import { Sparkline } from "../primitives/sparkline";
import { StatusBadge } from "../primitives/status-badge";
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
  const cpuPct = data?.cpu.aggregatePct ?? 0;
  const cpuStatus = bandStatus(cpuPct, PERCENT_USAGE);
  const memStatus = bandStatus(memPct, PERCENT_USAGE);

  return (
    <div className="space-y-4 p-4">
      {/* Host info */}
      {data ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-canvas-border bg-canvas-bg p-3 text-[11.5px] text-canvas-muted">
          <span className="font-mono text-canvas-fg">{data.host.distro ?? data.host.platform}</span>
          {data.host.release ? <span>{data.host.release}</span> : null}
          {data.host.kernel ? <span>· {data.host.kernel}</span> : null}
          <span>· {data.host.arch}</span>
          <span>· {data.host.cores} cores</span>
          <span>· {formatBytes(data.host.totalRamBytes)} RAM</span>
          {data.host.hostname ? <span>· {data.host.hostname}</span> : null}
        </div>
      ) : null}

      {/* Top-row gauges */}
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-canvas-border bg-canvas-bg p-4 sm:grid-cols-4">
        <div className="flex justify-center">
          <Gauge
            value={cpuPct}
            min={0}
            max={100}
            thresholds={PERCENT_USAGE}
            label="CPU"
            unit="%"
            size={110}
          />
        </div>
        <div className="flex justify-center">
          <Gauge
            value={memPct}
            min={0}
            max={100}
            thresholds={PERCENT_USAGE}
            label="Memory"
            unit="%"
            size={110}
          />
        </div>
        {data && data.swap.totalBytes > 0 ? (
          <div className="flex justify-center">
            <Gauge
              value={swapPct}
              min={0}
              max={100}
              thresholds={PERCENT_USAGE}
              label="Swap"
              unit="%"
              size={110}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-canvas-muted">
            <span className="text-[24px]">—</span>
            <span className="mt-1 text-[10.5px] font-medium uppercase tracking-wider">Swap</span>
          </div>
        )}
        <div className="flex justify-center">
          <Gauge
            value={fdPct}
            min={0}
            max={100}
            thresholds={PERCENT_USAGE}
            label="FDs"
            unit="%"
            size={110}
          />
        </div>
      </div>

      {/* CPU */}
      <CollapsibleBlock
        title="CPU"
        description={`Aggregate ${cpuPct.toFixed(1)}% · ${data?.cpu.perCorePct.length ?? 0} cores`}
        rightAdornment={<StatusBadge status={cpuStatus} size="xs" />}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricBar value={cpuPct} label="Aggregate" />
            <MetricCard
              label="Load 1m / 5m / 15m"
              value={
                data
                  ? `${data.cpu.load1.toFixed(2)} / ${data.cpu.load5.toFixed(2)} / ${data.cpu.load15.toFixed(2)}`
                  : "—"
              }
              size="sm"
            />
            <MetricCard
              label="Temp"
              value={data?.cpu.tempCelsius != null ? `${data.cpu.tempCelsius.toFixed(0)}°C` : "—"}
              size="sm"
            />
          </div>
          {data && data.cpu.perCorePct.length > 0 ? (
            <div>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-canvas-muted">
                Per-core
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
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
            </div>
          ) : null}
          {data && data.cpu.series.length > 0 ? (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-canvas-muted">
                Last 60 ticks
              </p>
              <Sparkline
                values={data.cpu.series}
                width={500}
                height={40}
                domain={[0, 100]}
                ariaLabel="CPU history"
                filled
                showLastPoint
              />
            </div>
          ) : null}
        </div>
      </CollapsibleBlock>

      {/* Memory */}
      <CollapsibleBlock
        title="Memory"
        description={
          data
            ? `${formatBytes(data.memory.usedBytes)} / ${formatBytes(data.memory.totalBytes)}`
            : "—"
        }
        rightAdornment={<StatusBadge status={memStatus} size="xs" />}
      >
        <div className="space-y-3">
          <MetricBar
            value={memPct}
            label="Used"
            secondary={
              data
                ? `${formatBytes(data.memory.usedBytes)} / ${formatBytes(data.memory.totalBytes)}`
                : undefined
            }
          />
          <SectionGrid minCardWidth={150}>
            <MetricCard
              label="Cached"
              value={data ? formatBytes(data.memory.cachedBytes) : "—"}
              size="sm"
            />
            <MetricCard
              label="Buffers"
              value={data ? formatBytes(data.memory.buffersBytes) : "—"}
              size="sm"
            />
            <MetricCard
              label="Free"
              value={data ? formatBytes(data.memory.freeBytes) : "—"}
              size="sm"
            />
            <MetricCard
              label="Swap"
              value={
                data && data.swap.totalBytes > 0
                  ? `${formatBytes(data.swap.usedBytes)} / ${formatBytes(data.swap.totalBytes)}`
                  : "—"
              }
              status={swapPct > 50 ? "warning" : "healthy"}
              size="sm"
            />
          </SectionGrid>
        </div>
      </CollapsibleBlock>

      {/* Disks */}
      <CollapsibleBlock
        title="Disks"
        description={`${data?.disks.length ?? 0} mount${(data?.disks.length ?? 0) === 1 ? "" : "s"}`}
      >
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
          {!data || data.disks.length === 0 ? (
            <p className="rounded-md bg-canvas-surface-hover px-3 py-4 text-center text-[11.5px] text-canvas-muted">
              No mounted filesystems
            </p>
          ) : null}
        </div>
      </CollapsibleBlock>

      {/* Network */}
      <CollapsibleBlock
        title="Network"
        description={`${data?.interfaces.length ?? 0} interface${(data?.interfaces.length ?? 0) === 1 ? "" : "s"}`}
        defaultOpen={false}
      >
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
          {!data || data.interfaces.length === 0 ? (
            <p className="rounded-md bg-canvas-surface-hover px-3 py-4 text-center text-[11.5px] text-canvas-muted">
              No network interfaces
            </p>
          ) : null}
        </div>
      </CollapsibleBlock>

      {/* File descriptors */}
      {data && data.fileDescriptors.limit > 0 ? (
        <div className="rounded-xl border border-canvas-border bg-canvas-bg p-3">
          <MetricBar
            value={fdPct}
            label="File descriptors"
            secondary={`${data.fileDescriptors.open.toLocaleString()} / ${data.fileDescriptors.limit.toLocaleString()}`}
          />
        </div>
      ) : null}
    </div>
  );
}
