"use client";

import { FiCheckCircle, FiXCircle, FiLoader } from "react-icons/fi";
import { formatRelativeTime } from "@/lib/format-time";
import type { ReportsIndexEntry } from "@/lib/reports/types";

interface ReportsListProps {
  runs: ReportsIndexEntry[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
  loading: boolean;
}

/**
 * Sidebar list of generated reports. Uses the same row chrome as
 * SessionList (left border for status color, bold title for unread)
 * so switching between the two feels consistent.
 */
export function ReportsList({ runs, selectedRunId, onSelect, loading }: ReportsListProps) {
  if (loading && runs.length === 0) {
    return (
      <div className="space-y-1.5 px-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-12 rounded-lg bg-canvas-surface-hover/50 animate-pulse"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-[12px] text-canvas-muted">No reports yet</p>
        <p className="mt-1.5 px-6 text-[11px] leading-relaxed text-canvas-muted">
          Schedule a cron job from the Reports dashboard — generated reports will appear here.
        </p>
      </div>
    );
  }

  const { running, today, yesterday, thisWeek, earlier } = group(runs);

  return (
    <div className="space-y-3">
      {running.length > 0 && (
        <Group label="Running now">
          {running.map((run) => (
            <Row
              key={run.runId}
              run={run}
              selected={run.runId === selectedRunId}
              onSelect={onSelect}
            />
          ))}
        </Group>
      )}
      {today.length > 0 && (
        <Group label="Today">
          {today.map((run) => (
            <Row
              key={run.runId}
              run={run}
              selected={run.runId === selectedRunId}
              onSelect={onSelect}
            />
          ))}
        </Group>
      )}
      {yesterday.length > 0 && (
        <Group label="Yesterday">
          {yesterday.map((run) => (
            <Row
              key={run.runId}
              run={run}
              selected={run.runId === selectedRunId}
              onSelect={onSelect}
            />
          ))}
        </Group>
      )}
      {thisWeek.length > 0 && (
        <Group label="This week">
          {thisWeek.map((run) => (
            <Row
              key={run.runId}
              run={run}
              selected={run.runId === selectedRunId}
              onSelect={onSelect}
            />
          ))}
        </Group>
      )}
      {earlier.length > 0 && (
        <Group label="Earlier">
          {earlier.map((run) => (
            <Row
              key={run.runId}
              run={run}
              selected={run.runId === selectedRunId}
              onSelect={onSelect}
            />
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="sticky top-0 z-10 bg-canvas-bg px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-canvas-muted"
        style={{ letterSpacing: "0.08em" }}
      >
        {label}
      </div>
      <div className="space-y-0.5 px-2">{children}</div>
    </div>
  );
}

function Row({
  run,
  selected,
  onSelect,
}: {
  run: ReportsIndexEntry;
  selected: boolean;
  onSelect: (runId: string) => void;
}) {
  const unread = run.readAt === null;
  const statusColor = statusColorFor(run.status);
  return (
    <button
      type="button"
      onClick={() => onSelect(run.runId)}
      className={`row-hover focus-ring flex w-full items-start gap-2 rounded-lg pl-2.5 pr-3 py-2 text-left transition-colors ${
        selected
          ? "bg-canvas-surface-hover text-canvas-fg"
          : "text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
      } ${run.status === "running" ? "animate-session-active" : ""}`}
      style={{
        borderLeftWidth: 4,
        borderLeftStyle: "solid",
        borderLeftColor: statusColor,
      }}
      title={run.status}
    >
      <StatusIcon status={run.status} />
      <div className="min-w-0 flex-1">
        <p
          className={`line-clamp-1 text-[13px] ${
            unread ? "font-semibold text-canvas-fg" : selected ? "font-medium" : ""
          }`}
        >
          {run.jobName}
        </p>
        <p className="mt-0.5 text-[10px]" style={unread ? { color: statusColor } : undefined}>
          {run.status === "running" ? "Running…" : formatRelativeTime(run.createdAt)}
        </p>
      </div>
      {unread && (
        <span
          aria-label="Unread"
          className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: "var(--accent)" }}
        />
      )}
    </button>
  );
}

function StatusIcon({ status }: { status: ReportsIndexEntry["status"] }) {
  const common = { size: 12, className: "mt-1 shrink-0" };
  if (status === "running") return <FiLoader {...common} style={{ color: "#60a5fa" }} />;
  if (status === "success") return <FiCheckCircle {...common} style={{ color: "#34d399" }} />;
  return <FiXCircle {...common} style={{ color: "#f87171" }} />;
}

function statusColorFor(status: ReportsIndexEntry["status"]): string {
  switch (status) {
    case "running":
      return "#60a5fa";
    case "success":
      return "#34d399";
    case "error":
    case "timeout":
    case "aborted":
      return "#f87171";
    default:
      return "transparent";
  }
}

interface Groups {
  running: ReportsIndexEntry[];
  today: ReportsIndexEntry[];
  yesterday: ReportsIndexEntry[];
  thisWeek: ReportsIndexEntry[];
  earlier: ReportsIndexEntry[];
}

function group(runs: ReportsIndexEntry[]): Groups {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const thisWeekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
  const out: Groups = {
    running: [],
    today: [],
    yesterday: [],
    thisWeek: [],
    earlier: [],
  };
  for (const run of runs) {
    if (run.status === "running") {
      out.running.push(run);
      continue;
    }
    const t = run.createdAt;
    if (t >= todayStart) out.today.push(run);
    else if (t >= yesterdayStart) out.yesterday.push(run);
    else if (t >= thisWeekStart) out.thisWeek.push(run);
    else out.earlier.push(run);
  }
  return out;
}
