"use client";

import { useEffect, useState } from "react";
import { FiClock, FiEdit2, FiPauseCircle, FiPlay, FiPlayCircle, FiTrash2 } from "react-icons/fi";
import { humanizeCron } from "@/lib/cron-humanize";
import { formatRelativeTime, formatTimeUntil } from "@/lib/format-time";
import type { JobWithMeta } from "@/lib/reports-api";
import type { ReportRun } from "@/lib/reports/types";

interface JobCardProps {
  job: JobWithMeta;
  /** Opens the JobEditor drawer for in-place editing. */
  onEdit: () => void;
  /** Navigates to ?view=reports&job=<slug> — the per-job run history view. */
  onOpen: () => void;
  onRun: () => void;
  onDelete: () => void;
  /** Flips `enabled` via the lightweight /enable endpoint. */
  onTogglePause: () => void;
}

export function JobCard({ job, onEdit, onOpen, onRun, onDelete, onTogglePause }: JobCardProps) {
  // Re-render every 30s so the "Next in Xh Ym" countdown ticks down
  // without requiring a full /api/reports/jobs refetch.
  const next = job.nextRuns[0];
  const visibleTimestamp = next ? new Date(next).getTime() : null;
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!visibleTimestamp) return;
    const t = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [visibleTimestamp]);

  const schedule = humanizeCron(job.schedule);
  const visibleTools = job.allowedTools.slice(0, 3);
  const extraTools = job.allowedTools.length - visibleTools.length;
  const lastRunAt = job.runCounts?.lastRunAt ?? null;
  const lastRunStatus = job.runCounts?.lastRunStatus ?? null;

  const handleAction = (e: React.MouseEvent, fn: () => void) => {
    // Buttons inside the card own their click; the parent card-body
    // click otherwise tries to navigate to the job detail view.
    e.stopPropagation();
    fn();
  };

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="focus-ring cursor-pointer rounded-xl border border-canvas-border bg-canvas-bg p-4 shadow-sm transition-colors hover:bg-canvas-surface-hover/30"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold text-canvas-fg">{job.name}</h3>
            <StatusPill running={job.running} enabled={job.enabled} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-canvas-muted">
            <span className="inline-flex items-center gap-1.5">
              <FiClock size={11} />
              {schedule}
            </span>
            {job.enabled && visibleTimestamp && (
              <>
                <span>·</span>
                <span
                  style={{ color: "var(--canvas-fg)" }}
                  title={new Date(visibleTimestamp).toLocaleString()}
                >
                  next {formatTimeUntil(visibleTimestamp)}
                </span>
                <span className="text-[10px] text-canvas-muted">
                  (
                  {new Date(visibleTimestamp).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  )
                </span>
              </>
            )}
          </p>
          {lastRunAt && lastRunStatus && (
            <p className="mt-1 text-[11px] text-canvas-muted">
              Last run: {formatRelativeTime(lastRunAt)} <StatusGlyph status={lastRunStatus} />
            </p>
          )}
          {job.runCounts && job.runCounts.total > 0 && (
            // Execution counter — gives the user an at-a-glance sense of
            // a job's health. Success rate excludes in-flight runs.
            <p className="mt-0.5 text-[11px] text-canvas-muted">
              {job.runCounts.total} run{job.runCounts.total === 1 ? "" : "s"}
              {job.runCounts.total - job.runCounts.running > 0 && (
                <>
                  {" "}
                  ·{" "}
                  {Math.round(
                    (job.runCounts.success /
                      Math.max(1, job.runCounts.total - job.runCounts.running)) *
                      100,
                  )}
                  % success
                </>
              )}
              {job.runCounts.error > 0 && (
                <>
                  {" · "}
                  <span style={{ color: "#f87171" }}>{job.runCounts.error} failed</span>
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            label="Run now"
            onClick={(e) => handleAction(e, onRun)}
            disabled={job.running}
          >
            <FiPlay size={13} />
          </IconButton>
          <IconButton
            label={job.enabled ? "Pause" : "Resume"}
            onClick={(e) => handleAction(e, onTogglePause)}
            disabled={job.running}
          >
            {job.enabled ? <FiPauseCircle size={13} /> : <FiPlayCircle size={13} />}
          </IconButton>
          <IconButton label="Edit" onClick={(e) => handleAction(e, onEdit)}>
            <FiEdit2 size={13} />
          </IconButton>
          <IconButton label="Archive" onClick={(e) => handleAction(e, onDelete)}>
            <FiTrash2 size={13} />
          </IconButton>
        </div>
      </div>

      {job.allowedTools.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {visibleTools.map((tool) => (
            <span
              key={tool}
              className="inline-flex items-center rounded-full bg-canvas-surface-hover px-2 py-0.5 text-[10px] text-canvas-muted"
            >
              {tool}
            </span>
          ))}
          {extraTools > 0 && (
            <span className="text-[10px] text-canvas-muted">and {extraTools} more</span>
          )}
        </div>
      )}
    </article>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="btn-press flex h-8 w-8 items-center justify-center rounded-lg text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function StatusPill({ running, enabled }: { running: boolean; enabled: boolean }) {
  if (running) {
    return (
      <span
        className="animate-session-active rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
        style={{ backgroundColor: "#60a5fa33", color: "#60a5fa" }}
      >
        Running
      </span>
    );
  }
  if (!enabled) {
    return (
      <span
        className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
        style={{ backgroundColor: "var(--canvas-surface-hover)", color: "var(--canvas-muted)" }}
      >
        Paused
      </span>
    );
  }
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: "#34d39922", color: "#34d399" }}
    >
      Active
    </span>
  );
}

function StatusGlyph({ status }: { status: ReportRun["status"] }) {
  if (status === "success") return <span style={{ color: "#34d399" }}>✓</span>;
  if (status === "running") return <span style={{ color: "#60a5fa" }}>⟳</span>;
  return <span style={{ color: "#f87171" }}>✗</span>;
}
