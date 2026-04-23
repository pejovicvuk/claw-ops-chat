"use client";

import { useCallback, useState } from "react";
import { FiArrowLeft, FiPlus, FiRefreshCw } from "react-icons/fi";
import { useReportJobs } from "@/lib/use-reports";
import { useUrlState } from "@/lib/use-url-state";
import { deleteJob, runJobNow } from "@/lib/reports-api";
import { JobCard } from "./job-card";
import { JobEditor } from "./job-editor";
import { ReportsEmptyState } from "./reports-empty-state";

interface ReportsDashboardProps {
  onOpenSessions?: () => void;
}

/**
 * The Reports dashboard — list of job cards + New Report trigger. Reuses
 * the job-editor drawer for both create and edit.
 */
export function ReportsDashboard({ onOpenSessions }: ReportsDashboardProps) {
  const { params, setParam } = useUrlState();
  const { jobs, loading, refresh } = useReportJobs();
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const isNew = params.get("newReport") === "1";

  const closeEditor = useCallback(() => {
    setEditingSlug(null);
    setParam("newReport", null);
  }, [setParam]);

  const openNew = useCallback(() => {
    setParam("newReport", "1");
    setEditingSlug(null);
  }, [setParam]);

  const handleRun = useCallback(
    async (slug: string) => {
      try {
        await runJobNow(slug);
        setTimeout(refresh, 800);
      } catch (err) {
        alert(`Failed to trigger run: ${(err as Error).message}`);
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (slug: string) => {
      if (!confirm(`Archive job '${slug}'? Past reports are preserved.`)) return;
      try {
        await deleteJob(slug, true);
        refresh();
      } catch (err) {
        alert(`Failed to archive: ${(err as Error).message}`);
      }
    },
    [refresh],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas-bg">
      <header className="flex shrink-0 items-center justify-between border-b border-canvas-border px-4 py-3">
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
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={refresh}
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

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && jobs.length === 0 && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-32 rounded-xl bg-canvas-surface-hover/50 animate-pulse"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        )}
        {!loading && jobs.length === 0 && <ReportsEmptyState onCreate={openNew} />}
        {jobs.length > 0 && (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {jobs.map((job) => (
              <JobCard
                key={job.slug}
                job={job}
                onEdit={() => setEditingSlug(job.slug)}
                onRun={() => handleRun(job.slug)}
                onDelete={() => handleDelete(job.slug)}
              />
            ))}
          </div>
        )}
      </div>

      {(isNew || editingSlug) && (
        <JobEditor
          slug={editingSlug}
          onClose={() => {
            closeEditor();
            refresh();
          }}
        />
      )}
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
