"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiArrowLeft,
  FiClock,
  FiEdit2,
  FiPauseCircle,
  FiPlay,
  FiPlayCircle,
  FiTrash2,
} from "react-icons/fi";
import { humanizeCron } from "@/lib/cron-humanize";
import { deleteJob, fetchJobRuns, runJobNow, setJobEnabled } from "@/lib/reports-api";
import { useReportJobs, useReportRuns } from "@/lib/use-reports";
import { useUrlState } from "@/lib/use-url-state";
import type { ReportRun, ReportsIndexEntry } from "@/lib/reports/types";
import { JobEditor } from "./job-editor";
import { ReportsList } from "./reports-list";

interface JobDetailProps {
  slug: string;
  onOpenSessions?: () => void;
}

const PER_JOB_POLL_MS = 3000;

/**
 * Per-job detail page reached via ?view=reports&job=<slug>. Pulls the
 * job's run sidecars directly (so the page works even when the central
 * index has dropped older runs), then joins them against the global
 * read/unread index so the dots match the Reports tab.
 */
export function JobDetail({ slug, onOpenSessions }: JobDetailProps) {
  const { setParam } = useUrlState();
  const { jobs, refresh: refreshJobs } = useReportJobs({ fast: true });
  const { feed } = useReportRuns({ fast: true });
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const job = jobs.find((j) => j.slug === slug) ?? null;
  const missing = jobs.length > 0 && !job;

  const refreshRuns = useCallback(async () => {
    try {
      const { runs: next } = await fetchJobRuns(slug);
      setRuns(next);
    } catch {
      /* transient; next poll retries */
    } finally {
      setRunsLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    refreshRuns();
    const t = setInterval(refreshRuns, PER_JOB_POLL_MS);
    return () => clearInterval(t);
  }, [refreshRuns]);

  const readAtByRunId = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const entry of feed.runs) m.set(entry.runId, entry.readAt);
    return m;
  }, [feed.runs]);

  const indexEntries: ReportsIndexEntry[] = useMemo(
    () =>
      runs.map((run) => ({
        runId: run.runId,
        jobId: run.jobId,
        jobName: job?.name ?? run.jobId,
        createdAt: run.startedAt,
        reportPath: run.reportPath,
        status: run.status,
        // Default to read for runs that have aged out of the central
        // index — otherwise every old run on a busy job would show as
        // unread, which is noise rather than signal.
        readAt: readAtByRunId.has(run.runId) ? (readAtByRunId.get(run.runId) ?? null) : Date.now(),
      })),
    [runs, job?.name, readAtByRunId],
  );

  const handleBack = useCallback(() => {
    setParam("job", null);
    setParam("tab", "schedules");
  }, [setParam]);

  const handleOpenRun = useCallback(
    (runId: string) => {
      setParam("report", runId);
    },
    [setParam],
  );

  const handleRun = useCallback(async () => {
    try {
      await runJobNow(slug);
      refreshJobs();
      refreshRuns();
      setTimeout(() => {
        refreshJobs();
        refreshRuns();
      }, 1500);
    } catch (err) {
      alert(`Failed to trigger run: ${(err as Error).message}`);
    }
  }, [slug, refreshJobs, refreshRuns]);

  const handleTogglePause = useCallback(async () => {
    if (!job) return;
    try {
      await setJobEnabled(slug, !job.enabled);
      refreshJobs();
    } catch (err) {
      alert(`Failed: ${(err as Error).message}`);
    }
  }, [slug, job, refreshJobs]);

  const handleDelete = useCallback(async () => {
    if (!confirm(`Archive job '${slug}'? Past reports are preserved.`)) return;
    try {
      await deleteJob(slug, true);
      handleBack();
    } catch (err) {
      alert(`Failed to archive: ${(err as Error).message}`);
    }
  }, [slug, handleBack]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas-bg">
      <header className="pt-safe-top flex shrink-0 items-center gap-2 border-b border-canvas-border px-4 pb-3">
        {onOpenSessions && (
          <button
            type="button"
            onClick={onOpenSessions}
            className="btn-press flex h-9 w-9 items-center justify-center rounded-lg text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg md:hidden"
            aria-label="Open sidebar"
          >
            <FiArrowLeft size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={handleBack}
          className="btn-press flex h-9 w-9 items-center justify-center rounded-lg text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
          aria-label="Back to schedules"
          title="Back to schedules"
        >
          <FiArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="line-clamp-1 text-[15px] font-semibold text-canvas-fg">
              {job?.name ?? slug}
            </h1>
            {job && <StatusPill running={job.running} enabled={job.enabled} />}
          </div>
          {job && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-canvas-muted">
              <span className="inline-flex items-center gap-1">
                <FiClock size={10} />
                {humanizeCron(job.schedule)}
              </span>
              {job.nextRuns[0] && (
                <>
                  <span>·</span>
                  <span title={new Date(job.nextRuns[0]).toLocaleString()}>
                    next{" "}
                    {new Date(job.nextRuns[0]).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </>
              )}
              <span>·</span>
              <span className="font-mono">{slug}</span>
            </p>
          )}
        </div>
        {job && (
          <div className="flex items-center gap-1">
            <IconButton label="Run now" onClick={handleRun} disabled={job.running}>
              <FiPlay size={13} />
            </IconButton>
            <IconButton
              label={job.enabled ? "Pause" : "Resume"}
              onClick={handleTogglePause}
              disabled={job.running}
            >
              {job.enabled ? <FiPauseCircle size={13} /> : <FiPlayCircle size={13} />}
            </IconButton>
            <IconButton label="Edit" onClick={() => setEditing(true)}>
              <FiEdit2 size={13} />
            </IconButton>
            <IconButton label="Archive" onClick={handleDelete}>
              <FiTrash2 size={13} />
            </IconButton>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {missing ? (
          <div className="mx-auto max-w-md py-12 text-center">
            <p className="text-[14px] font-medium text-canvas-fg">Job not found</p>
            <p className="mt-1 text-[12px] text-canvas-muted">
              The schedule <span className="font-mono">{slug}</span> no longer exists.
            </p>
            <button
              type="button"
              onClick={handleBack}
              className="btn-press mt-4 rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
            >
              Back to schedules
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">
            <ReportsList
              runs={indexEntries}
              selectedRunId={null}
              onSelect={handleOpenRun}
              loading={runsLoading}
            />
          </div>
        )}
      </div>

      {editing && (
        <JobEditor
          slug={slug}
          onClose={() => {
            setEditing(false);
            refreshJobs();
          }}
        />
      )}
    </div>
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
      className="btn-press flex h-9 w-9 items-center justify-center rounded-lg text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg disabled:opacity-40"
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
