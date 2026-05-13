"use client";

import { useCallback, useState } from "react";
import { FiArrowLeft, FiPlus, FiRefreshCw } from "react-icons/fi";
import { useReportJobs, useReportRuns } from "@/lib/use-reports";
import { useUrlState } from "@/lib/use-url-state";
import { deleteJob, runJobNow, setJobEnabled } from "@/lib/reports-api";
import { JobCard } from "./job-card";
import { JobEditor } from "./job-editor";
import { ReportsEmptyState } from "./reports-empty-state";
import { ReportsList } from "./reports-list";

interface ReportsDashboardProps {
  onOpenSessions?: () => void;
}

type TabKey = "reports" | "schedules";

/**
 * The Reports landing page. Two tabs:
 *
 *   Reports (default)  — runs feed grouped by date (ReportsList)
 *   Schedules          — JobCard grid for managing cron definitions
 *
 * Tab is URL-driven (?tab=schedules) so refreshes / shared links land on
 * the same view. Reuses the existing JobEditor drawer for both create
 * and edit, and the same useReport{Runs,Jobs} fast-poll while this view
 * is mounted.
 */
export function ReportsDashboard({ onOpenSessions }: ReportsDashboardProps) {
  const { params, setParam } = useUrlState();
  // Dashboard is the frontmost UI for the reports feature — poll fast so
  // running pills and unread dots feel live.
  const { jobs, loading: jobsLoading, refresh: refreshJobs } = useReportJobs({ fast: true });
  const { feed, loading: runsLoading, refresh: refreshRuns } = useReportRuns({ fast: true });
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const isNew = params.get("newReport") === "1";

  const tab: TabKey = params.get("tab") === "schedules" ? "schedules" : "reports";
  const setTab = useCallback(
    (next: TabKey) => setParam("tab", next === "reports" ? null : next),
    [setParam],
  );

  const closeEditor = useCallback(() => {
    setEditingSlug(null);
    setParam("newReport", null);
  }, [setParam]);

  const openNew = useCallback(() => {
    setParam("newReport", "1");
    setEditingSlug(null);
  }, [setParam]);

  const refreshAll = useCallback(() => {
    refreshJobs();
    refreshRuns();
  }, [refreshJobs, refreshRuns]);

  const handleRun = useCallback(
    async (slug: string) => {
      try {
        await runJobNow(slug);
        // Two-step refresh: immediate so the "Running" pill appears
        // within a tick, plus a follow-up at 1.5s in case the runner
        // hasn't written the sidecar yet on the first tick.
        refreshAll();
        setTimeout(refreshAll, 1500);
      } catch (err) {
        alert(`Failed to trigger run: ${(err as Error).message}`);
      }
    },
    [refreshAll],
  );

  const handleDelete = useCallback(
    async (slug: string) => {
      if (!confirm(`Archive job '${slug}'? Past reports are preserved.`)) return;
      try {
        await deleteJob(slug, true);
        refreshAll();
      } catch (err) {
        alert(`Failed to archive: ${(err as Error).message}`);
      }
    },
    [refreshAll],
  );

  const handleTogglePause = useCallback(
    async (slug: string, nextEnabled: boolean) => {
      try {
        await setJobEnabled(slug, nextEnabled);
        refreshAll();
      } catch (err) {
        alert(`Failed to ${nextEnabled ? "resume" : "pause"}: ${(err as Error).message}`);
      }
    },
    [refreshAll],
  );

  const handleOpenJob = useCallback(
    (slug: string) => {
      setParam("job", slug);
    },
    [setParam],
  );

  const handleOpenRun = useCallback(
    (runId: string) => {
      setParam("report", runId);
    },
    [setParam],
  );

  const hasJobs = jobs.length > 0;
  const hasRuns = feed.runs.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas-bg">
      <header className="pt-safe-top flex shrink-0 items-center justify-between border-b border-canvas-border px-4 pb-3">
        <div className="flex items-center gap-2">
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
          <h1 className="text-[15px] font-semibold text-canvas-fg">Reports</h1>
          <SchedulerPill
            activeJobs={jobs.filter((j) => j.enabled).length}
            runningJobs={jobs.filter((j) => j.running).length}
          />
          <UnreadPill unread={feed.unreadCount} />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={refreshAll}
            className="btn-press flex h-9 w-9 items-center justify-center rounded-lg text-canvas-muted hover:bg-canvas-surface-hover hover:text-canvas-fg"
            aria-label="Refresh"
          >
            <FiRefreshCw size={14} />
          </button>
          <button
            type="button"
            onClick={openNew}
            className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
          >
            <FiPlus size={14} />
            New Report
          </button>
        </div>
      </header>

      <div className="flex shrink-0 items-center gap-1 border-b border-canvas-border px-4">
        <TabButton active={tab === "reports"} onClick={() => setTab("reports")}>
          Reports
          {feed.unreadCount > 0 && (
            <span
              className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none"
              style={{ backgroundColor: "var(--accent)", color: "white" }}
            >
              {feed.unreadCount > 99 ? "99+" : feed.unreadCount}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === "schedules"} onClick={() => setTab("schedules")}>
          Schedules
          {hasJobs && <span className="ml-1.5 text-[11px] text-canvas-muted">{jobs.length}</span>}
        </TabButton>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === "reports" ? (
          <ReportsPane
            runs={feed.runs}
            loading={runsLoading}
            hasJobs={hasJobs}
            jobsLoading={jobsLoading}
            onSelect={handleOpenRun}
            onCreate={openNew}
            onViewSchedules={() => setTab("schedules")}
          />
        ) : (
          <SchedulesPane
            jobs={jobs}
            loading={jobsLoading}
            hasRuns={hasRuns}
            onEdit={(slug) => setEditingSlug(slug)}
            onOpen={handleOpenJob}
            onRun={handleRun}
            onDelete={handleDelete}
            onTogglePause={handleTogglePause}
            onCreate={openNew}
          />
        )}
      </div>

      {(isNew || editingSlug) && (
        <JobEditor
          slug={editingSlug}
          onClose={() => {
            closeEditor();
            refreshAll();
          }}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`btn-press relative -mb-px flex items-center gap-1 px-3 py-2.5 text-[13px] font-medium transition-colors ${
        active ? "text-canvas-fg" : "text-canvas-muted hover:text-canvas-fg"
      }`}
      aria-pressed={active}
    >
      {children}
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-x-2 bottom-0 h-0.5 rounded-full"
          style={{ backgroundColor: "var(--accent)" }}
        />
      )}
    </button>
  );
}

function ReportsPane({
  runs,
  loading,
  hasJobs,
  jobsLoading,
  onSelect,
  onCreate,
  onViewSchedules,
}: {
  runs: ReturnType<typeof useReportRuns>["feed"]["runs"];
  loading: boolean;
  hasJobs: boolean;
  jobsLoading: boolean;
  onSelect: (runId: string) => void;
  onCreate: () => void;
  onViewSchedules: () => void;
}) {
  // Empty-state precedence:
  //   1. Loading and nothing yet → skeleton.
  //   2. No jobs configured at all → "create your first" call to action.
  //   3. Jobs exist but haven't fired yet → hint pointing at the
  //      Schedules tab so the user can verify the schedule.
  //   4. Otherwise → the runs feed (ReportsList handles its own
  //      grouped layout and empty-list rendering).
  if (loading && jobsLoading && runs.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-1.5">
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
  if (!hasJobs && !jobsLoading) {
    return <ReportsEmptyState onCreate={onCreate} />;
  }
  if (!loading && runs.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center justify-center py-16 text-center">
        <p className="text-[14px] font-medium text-canvas-fg">No reports yet</p>
        <p className="mt-2 text-[12px] leading-relaxed text-canvas-muted">
          Your scheduled jobs are configured — generated reports will appear here as soon as the
          next cron tick fires. Use{" "}
          <button
            type="button"
            onClick={onViewSchedules}
            className="font-medium text-accent hover:underline"
          >
            Schedules
          </button>{" "}
          to verify the next-run time, or trigger a run manually from there.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl">
      <ReportsList runs={runs} selectedRunId={null} onSelect={onSelect} loading={loading} />
    </div>
  );
}

function SchedulesPane({
  jobs,
  loading,
  hasRuns,
  onEdit,
  onOpen,
  onRun,
  onDelete,
  onTogglePause,
  onCreate,
}: {
  jobs: ReturnType<typeof useReportJobs>["jobs"];
  loading: boolean;
  hasRuns: boolean;
  onEdit: (slug: string) => void;
  onOpen: (slug: string) => void;
  onRun: (slug: string) => void;
  onDelete: (slug: string) => void;
  onTogglePause: (slug: string, nextEnabled: boolean) => void;
  onCreate: () => void;
}) {
  if (loading && jobs.length === 0) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-32 rounded-xl bg-canvas-surface-hover/50 animate-pulse"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    );
  }
  if (!loading && jobs.length === 0) {
    return <ReportsEmptyState onCreate={onCreate} />;
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      {!hasRuns && (
        <p className="rounded-lg border border-dashed border-canvas-border px-4 py-3 text-center text-[11px] text-canvas-muted">
          No runs have completed yet. Trigger a job manually with the play button below to verify
          everything is wired up.
        </p>
      )}
      {jobs.map((job) => (
        <JobCard
          key={job.slug}
          job={job}
          onEdit={() => onEdit(job.slug)}
          onOpen={() => onOpen(job.slug)}
          onRun={() => onRun(job.slug)}
          onDelete={() => onDelete(job.slug)}
          onTogglePause={() => onTogglePause(job.slug, !job.enabled)}
        />
      ))}
    </div>
  );
}

function SchedulerPill({ activeJobs, runningJobs }: { activeJobs: number; runningJobs: number }) {
  if (activeJobs === 0) return null;
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{
        backgroundColor: runningJobs > 0 ? "#e8553a22" : "#34d39922",
        color: runningJobs > 0 ? "#e8553a" : "#34d399",
      }}
    >
      {activeJobs} active
      {runningJobs > 0 && ` · ${runningJobs} running`}
    </span>
  );
}

function UnreadPill({ unread }: { unread: number }) {
  if (unread === 0) return null;
  return (
    <span
      className="hidden rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline-block"
      style={{ backgroundColor: "var(--accent)", color: "white" }}
      title="Unread reports"
    >
      {unread > 99 ? "99+" : unread} unread
    </span>
  );
}
