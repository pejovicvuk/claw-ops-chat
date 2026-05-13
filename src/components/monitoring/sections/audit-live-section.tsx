"use client";

import { useCallback, useEffect, useState } from "react";
import { FiAlertTriangle, FiDownload, FiRefreshCw, FiTrash2 } from "react-icons/fi";
import { AuditDetailDrawer } from "@/components/audit/audit-detail-drawer";
import { AuditFilterBar } from "@/components/audit/audit-filter-bar";
import { AuditStatsTiles } from "@/components/audit/audit-stats";
import { AuditTable } from "@/components/audit/audit-table";
import { BulkDeleteDialog } from "@/components/audit/bulk-delete-dialog";
import type { AuditEvent, AuditFilter } from "@/lib/audit/types";
import { exportAuditEvents, useAuditEvents, useAuditStats } from "@/lib/use-audit";
import { useExitAnimation } from "@/lib/use-exit-animation";
import { useMonContext } from "../monitoring-context";
import { CollapsibleBlock } from "../primitives/collapsible-block";

/**
 * Single audit dashboard inside Monitoring. Replaces the standalone
 * Settings → Activity → Audit log page that previously lived at
 * `?settings=audit` — all features (stats, live tail, filtered events,
 * NDJSON export, bulk delete) consolidated here so operators have one
 * place to look.
 */
export function AuditLiveSection() {
  const { paused } = useMonContext();
  const [filter, setFilter] = useState<AuditFilter>({ limit: 100 });
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [dialog, setDialog] = useState<null | { nuke: boolean }>(null);
  const [lastDialog, setLastDialog] = useState<{ nuke: boolean } | null>(null);
  if (dialog && dialog !== lastDialog) setLastDialog(dialog);
  const { mounted: dialogMounted, state: dialogAnim } = useExitAnimation(dialog !== null, 200);
  const [autoRefreshSec, setAutoRefreshSec] = useState<number | null>(10);

  const { events, hasMore, loading, error, loadMore, refresh } = useAuditEvents(filter);
  const { stats, refetch: refetchStats, loading: statsLoading } = useAuditStats();

  const onDialogDone = useCallback(
    (_result: { deleted: string[]; bytesFreed: number }) => {
      void _result;
      refresh();
      void refetchStats();
    },
    [refresh, refetchStats],
  );

  // Auto-refresh on the user-selected cadence, paused when the global
  // pause flag is on or when the tab is hidden.
  useEffect(() => {
    if (paused || !autoRefreshSec) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
        void refetchStats();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") {
        refresh();
        void refetchStats();
      }
    }, autoRefreshSec * 1000);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [autoRefreshSec, paused, refresh, refetchStats]);

  return (
    <div className="space-y-4 p-4">
      {/* Summary tiles */}
      <CollapsibleBlock
        title="Summary"
        description={`Auto-purged after ${stats?.retentionDays ?? 30} days · /root/.audit/`}
      >
        {stats?.lastWriteError ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-[var(--mon-critical)]/20 bg-[var(--mon-critical)]/5 p-3">
            <FiAlertTriangle size={13} className="mt-0.5 shrink-0 text-[var(--mon-critical)]" />
            <div className="text-[11.5px] text-[var(--mon-critical)]">
              Most recent audit write failed: {stats.lastWriteError}
            </div>
          </div>
        ) : null}
        <AuditStatsTiles stats={stats} loading={statsLoading} />
      </CollapsibleBlock>

      {/* Live tail + filter + table */}
      <CollapsibleBlock title="Events" description="Filter, search, and inspect recorded activity">
        <div className="space-y-3">
          <AuditFilterBar
            filter={filter}
            onChange={setFilter}
            autoRefreshSec={autoRefreshSec}
            onAutoRefreshChange={setAutoRefreshSec}
          />
          {error ? (
            <p className="flex items-center gap-1 text-[11px] text-[var(--mon-critical)]">
              <FiAlertTriangle size={10} />
              {error.message}
            </p>
          ) : null}
          <AuditTable
            events={events}
            hasMore={hasMore}
            loading={loading}
            onLoadMore={loadMore}
            onSelect={setSelected}
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                refresh();
                void refetchStats();
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-canvas-border px-2 py-1 text-[11px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
            >
              <FiRefreshCw size={11} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => exportAuditEvents(filter)}
              className="inline-flex items-center gap-1.5 rounded-md border border-canvas-border px-2 py-1 text-[11px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
            >
              <FiDownload size={11} />
              Export NDJSON
            </button>
          </div>
        </div>
      </CollapsibleBlock>

      {/* Maintenance — collapsed by default since it's destructive */}
      <CollapsibleBlock
        title="Maintenance"
        description="Reclaim disk by purging older logs"
        defaultOpen={false}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setDialog({ nuke: false })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-border px-3 py-2 text-[12px] font-medium text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
          >
            <FiTrash2 size={11} />
            Delete older logs…
          </button>
          <button
            type="button"
            onClick={() => setDialog({ nuke: true })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--mon-critical)]/10 px-3 py-2 text-[12px] font-medium text-[var(--mon-critical)] transition-colors hover:bg-[var(--mon-critical)]/15"
          >
            <FiTrash2 size={11} />
            Delete everything
          </button>
          <p className="ml-auto text-[10.5px] text-canvas-muted">
            Retention: logs auto-purge after {stats?.retentionDays ?? 30} days.
          </p>
        </div>
      </CollapsibleBlock>

      {selected ? <AuditDetailDrawer event={selected} onClose={() => setSelected(null)} /> : null}
      {dialogMounted && lastDialog ? (
        <BulkDeleteDialog
          nuke={lastDialog.nuke}
          onClose={() => setDialog(null)}
          onDone={onDialogDone}
          animationState={dialogAnim}
        />
      ) : null}
    </div>
  );
}
