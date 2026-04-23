"use client";

import { useEffect, useState } from "react";
import { FiClock, FiEdit2, FiPlay, FiTrash2 } from "react-icons/fi";
import { humanizeCron } from "@/lib/cron-humanize";
import { formatRelativeTime } from "@/lib/format-time";
import { fetchJobRuns, type JobWithMeta } from "@/lib/reports-api";
import type { ReportRun } from "@/lib/reports/types";

interface JobCardProps {
  job: JobWithMeta;
  onEdit: () => void;
  onRun: () => void;
  onDelete: () => void;
}

export function JobCard({ job, onEdit, onRun, onDelete }: JobCardProps) {
  const [lastRun, setLastRun] = useState<ReportRun | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchJobRuns(job.slug)
      .then(({ runs }) => {
        if (!cancelled) setLastRun(runs[0] ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [job.slug]);

  const schedule = humanizeCron(job.schedule);
  const next = job.nextRuns[0];
  const visibleTools = job.allowedTools.slice(0, 3);
  const extraTools = job.allowedTools.length - visibleTools.length;

  return (
    <article className="rounded-xl border border-canvas-border bg-canvas-bg p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold text-canvas-fg">{job.name}</h3>
            <StatusPill running={job.running} enabled={job.enabled} />
          </div>
          <p className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-canvas-muted">
            <FiClock size={11} />
            <span>{schedule}</span>
            {next && (
              <span className="text-canvas-muted">· next: {new Date(next).toLocaleString()}</span>
            )}
          </p>
          {lastRun && (
            <p className="mt-1 text-[11px] text-canvas-muted">
              Last run: {formatRelativeTime(lastRun.startedAt)}{" "}
              <StatusGlyph status={lastRun.status} />
              {lastRun.finishedAt &&
                ` (${((lastRun.finishedAt - lastRun.startedAt) / 1000).toFixed(1)}s)`}
            </p>
          )}
          {job.runCounts && job.runCounts.total > 0 && (
            // Execution counter — gives the user an at-a-glance sense of
            // a job's health without expanding the run history. Success
            // rate calculated from completed runs (excludes in-flight).
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
          <IconButton label="Run now" onClick={onRun} disabled={job.running}>
            <FiPlay size={13} />
          </IconButton>
          <IconButton label="Edit" onClick={onEdit}>
            <FiEdit2 size={13} />
          </IconButton>
          <IconButton label="Archive" onClick={onDelete}>
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
  onClick: () => void;
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
