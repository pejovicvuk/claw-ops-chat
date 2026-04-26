"use client";

import { useMemo, useState } from "react";
import { useMonPoll } from "@/lib/monitoring/use-mon-poll";
import { formatBytes, formatPercent } from "@/lib/monitoring/format";
import type { ProcessRow, ProcessesSnapshot } from "@/lib/monitoring/types";
import { useMonContext } from "../monitoring-context";
import { DataTable } from "../primitives/data-table";
import { EmptyState } from "../primitives/empty-state";

export function ProcessesSection() {
  const { refreshMs, paused } = useMonContext();
  const { data, error } = useMonPoll<ProcessesSnapshot>("/api/monitoring/processes", {
    intervalMs: refreshMs ?? 5000,
    paused,
  });
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!data?.rows) return [];
    const q = search.toLowerCase().trim();
    if (!q) return data.rows;
    return data.rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.cmdline.toLowerCase().includes(q) ||
        r.user.toLowerCase().includes(q) ||
        r.pid.toString().includes(q),
    );
  }, [data, search]);

  if (error && !data) {
    return <p className="p-4 text-[12px] text-[var(--mon-critical)]">Error: {error.message}</p>;
  }

  if (data && !data.available) {
    return (
      <div className="p-4">
        <EmptyState
          title="Process listing unavailable"
          description={data.reason ?? "/proc not readable on this platform."}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search processes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] rounded-lg border border-canvas-border bg-canvas-bg px-3 py-1.5 text-[12px] text-canvas-fg outline-none focus:border-accent"
        />
        <span className="text-[11px] text-canvas-muted">
          {filtered.length} of {data?.totalProcs ?? 0} processes
        </span>
        {data && data.zombieCount > 0 ? (
          <span className="rounded-md bg-[var(--mon-warning)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--mon-warning)]">
            {data.zombieCount} zombie{data.zombieCount > 1 ? "s" : ""}
          </span>
        ) : null}
      </div>

      <DataTable<ProcessRow>
        columns={[
          {
            key: "pid",
            header: "PID",
            width: "70px",
            sortable: true,
            sortValue: (r) => r.pid,
            cell: (r) => <span className="font-mono">{r.pid}</span>,
          },
          {
            key: "user",
            header: "User",
            width: "100px",
            sortable: true,
            sortValue: (r) => r.user,
            cell: (r) => <span className="text-canvas-muted">{r.user}</span>,
          },
          {
            key: "name",
            header: "Name",
            sortable: true,
            sortValue: (r) => r.name,
            cell: (r) => (
              <span className="block truncate font-medium" title={r.cmdline}>
                {r.name}
              </span>
            ),
          },
          {
            key: "cpu",
            header: "CPU",
            width: "70px",
            align: "right",
            sortable: true,
            sortValue: (r) => r.cpuPct,
            cell: (r) => (
              <span className="font-mono tabular-nums text-canvas-fg">
                {formatPercent(r.cpuPct, 1)}
              </span>
            ),
          },
          {
            key: "mem",
            header: "RSS",
            width: "100px",
            align: "right",
            sortable: true,
            sortValue: (r) => r.memBytes,
            cell: (r) => (
              <span className="font-mono tabular-nums text-canvas-muted">
                {formatBytes(r.memBytes)}
              </span>
            ),
          },
          {
            key: "state",
            header: "State",
            width: "60px",
            align: "center",
            sortable: false,
            cell: (r) =>
              r.state === "Z" ? (
                <span className="text-[var(--mon-warning)]">Z</span>
              ) : (
                <span className="text-canvas-muted">{r.state}</span>
              ),
          },
        ]}
        rows={filtered}
        rowKey={(r) => `${r.pid}`}
        defaultSort={{ key: "cpu", dir: "desc" }}
        maxHeight={520}
      />
    </div>
  );
}
