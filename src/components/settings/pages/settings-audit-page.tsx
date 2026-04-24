"use client";

import { useCallback, useState } from "react";
import { FiAlertTriangle, FiDownload, FiRefreshCw, FiTrash2 } from "react-icons/fi";
import { AuditDetailDrawer } from "@/components/audit/audit-detail-drawer";
import { AuditFilterBar } from "@/components/audit/audit-filter-bar";
import { AuditStatsTiles } from "@/components/audit/audit-stats";
import { AuditTable } from "@/components/audit/audit-table";
import { BulkDeleteDialog } from "@/components/audit/bulk-delete-dialog";
import type { AuditEvent, AuditFilter } from "@/lib/audit/types";
import { exportAuditEvents, useAuditEvents, useAuditStats } from "@/lib/use-audit";
import { SettingsSection } from "../settings-section";

export function SettingsAuditPage() {
  const [filter, setFilter] = useState<AuditFilter>({ limit: 100 });
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const [dialog, setDialog] = useState<null | { nuke: boolean }>(null);

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

  return (
    <div className="space-y-4">
      <SettingsSection
        title="Summary"
        description={`Auto-purged after ${stats?.retentionDays ?? 30} days. Writes persist under /root/.audit/.`}
      >
        {stats?.lastWriteError && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            <FiAlertTriangle size={13} className="mt-0.5 shrink-0 text-red-500" />
            <div className="text-[11.5px] text-red-500">
              Most recent audit write failed: {stats.lastWriteError}
            </div>
          </div>
        )}
        <AuditStatsTiles stats={stats} loading={statsLoading} />
      </SettingsSection>

      <SettingsSection title="Events" description="Filter, search, and inspect recorded activity">
        <div className="space-y-3">
          <AuditFilterBar filter={filter} onChange={setFilter} />
          {error && (
            <p className="flex items-center gap-1 text-[11px] text-red-500">
              <FiAlertTriangle size={10} />
              {error.message}
            </p>
          )}
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
      </SettingsSection>

      <SettingsSection title="Maintenance" description="Reclaim disk by purging older logs">
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-500/15"
          >
            <FiTrash2 size={11} />
            Delete everything
          </button>
          <p className="ml-auto text-[10.5px] text-canvas-muted">
            Retention: logs auto-purge after {stats?.retentionDays ?? 30} days.
          </p>
        </div>
      </SettingsSection>

      {selected && <AuditDetailDrawer event={selected} onClose={() => setSelected(null)} />}
      {dialog && (
        <BulkDeleteDialog
          nuke={dialog.nuke}
          onClose={() => setDialog(null)}
          onDone={onDialogDone}
        />
      )}
    </div>
  );
}
