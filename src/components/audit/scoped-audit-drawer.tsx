"use client";

import { useState } from "react";
import type { AuditEvent, AuditFilter } from "@/lib/audit/types";
import { useAuditEvents } from "@/lib/use-audit";
import { AuditDetailDrawer } from "./audit-detail-drawer";
import { AuditTable } from "./audit-table";

interface ScopedAuditDrawerProps {
  /** Pre-filter applied to the audit reader. */
  filter: AuditFilter;
  /** Limit for first page. */
  limit?: number;
  /** Header / hint shown above the table. */
  description?: string;
}

/**
 * Drop-in audit-table snippet for drill-downs (WS session, container,
 * cron job). Reuses the main `useAuditEvents` hook with a pre-filled
 * filter and renders the same table + detail drawer as the full audit
 * page, just narrowed to relevant events.
 */
export function ScopedAuditDrawer({ filter, limit = 50, description }: ScopedAuditDrawerProps) {
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const { events, hasMore, loading, error, loadMore } = useAuditEvents({ ...filter, limit });

  return (
    <div className="space-y-2">
      {description ? <p className="text-[11px] text-canvas-muted">{description}</p> : null}
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
      {selected ? <AuditDetailDrawer event={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
