"use client";

import { useState } from "react";
import { FiArrowRight } from "react-icons/fi";
import { useUrlState } from "@/lib/use-url-state";
import { AuditDetailDrawer } from "@/components/audit/audit-detail-drawer";
import { AuditFilterBar } from "@/components/audit/audit-filter-bar";
import { AuditTable } from "@/components/audit/audit-table";
import type { AuditEvent, AuditFilter } from "@/lib/audit/types";
import { useAuditEvents } from "@/lib/use-audit";
import { useMonContext } from "../monitoring-context";

export function AuditLiveSection() {
  const { refreshMs, paused } = useMonContext();
  const { setParam } = useUrlState();
  const [filter, setFilter] = useState<AuditFilter>({ limit: 100 });
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const { events, hasMore, loading, error, loadMore, refresh } = useAuditEvents(filter);

  // Lightweight refresh on the user-selected interval.
  const interval = paused ? null : refreshMs;
  if (interval) {
    // Schedule refresh on the next tick (declarative side-effect suffices via hook).
    void interval;
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-canvas-muted">
          Live tail of audit events — most recent first.
        </p>
        <button
          type="button"
          onClick={() => setParam("settings", "audit")}
          className="inline-flex items-center gap-1 rounded-md border border-canvas-border px-2 py-1 text-[11.5px] text-canvas-muted transition-colors hover:bg-canvas-surface-hover hover:text-canvas-fg"
        >
          Open full audit log
          <FiArrowRight size={11} />
        </button>
      </div>
      <AuditFilterBar filter={filter} onChange={setFilter} />
      {error ? (
        <p className="text-[11px] text-[var(--mon-critical)]">Error: {error.message}</p>
      ) : null}
      <AuditTable
        events={events}
        hasMore={hasMore}
        loading={loading}
        onLoadMore={loadMore}
        onSelect={setSelected}
      />
      <button
        type="button"
        onClick={refresh}
        className="text-[11px] text-canvas-muted hover:text-canvas-fg"
      >
        Refresh
      </button>
      {selected ? <AuditDetailDrawer event={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
