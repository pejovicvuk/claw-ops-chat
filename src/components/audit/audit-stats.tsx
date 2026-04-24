"use client";

import { FiActivity, FiAlertTriangle, FiClock, FiHardDrive } from "react-icons/fi";
import type { AuditStats } from "@/lib/audit/types";

interface AuditStatsTilesProps {
  stats: AuditStats | null;
  loading: boolean;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatRelativeDate(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return iso;
  const days = Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

export function AuditStatsTiles({ stats, loading }: AuditStatsTilesProps) {
  const errorCount = stats ? stats.bySeverity.error + stats.bySeverity.warn : 0;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Tile
        icon={<FiActivity size={13} />}
        label="Total events"
        value={stats ? stats.totalCount.toLocaleString() : loading ? "…" : "0"}
      />
      <Tile
        icon={<FiAlertTriangle size={13} />}
        label="Warn + error"
        value={stats ? errorCount.toLocaleString() : loading ? "…" : "0"}
        warn={errorCount > 0}
      />
      <Tile
        icon={<FiHardDrive size={13} />}
        label="Disk used"
        value={stats ? formatBytes(stats.diskUsageBytes) : loading ? "…" : "0 B"}
      />
      <Tile
        icon={<FiClock size={13} />}
        label="Oldest entry"
        value={stats ? formatRelativeDate(stats.oldestFileDate) : loading ? "…" : "—"}
      />
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  warn = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-canvas-border bg-canvas-bg px-3 py-2">
      <div className="flex items-center gap-1.5 text-canvas-muted">
        <span className={warn ? "text-red-500" : undefined}>{icon}</span>
        <span className="text-[11px]">{label}</span>
      </div>
      <div className={`mt-1 text-[15px] font-semibold ${warn ? "text-red-500" : "text-canvas-fg"}`}>
        {value}
      </div>
    </div>
  );
}
