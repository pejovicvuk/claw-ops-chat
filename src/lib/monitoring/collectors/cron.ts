import { getScheduler } from "../../reports/scheduler-singleton";
import { listRunsForJob } from "../../reports/run-store";
import type { CronSnapshot } from "../types";

/**
 * Read aggregate cron stats — total jobs, runs in last 24h, success rate,
 * runs-per-hour histogram. Reads from the existing scheduler singleton +
 * run-store; never duplicates state.
 */
export async function collectCron(): Promise<CronSnapshot> {
  const scheduler = getScheduler();
  if (!scheduler) {
    return {
      aggregates: {
        jobsTotal: 0,
        jobsActive: 0,
        jobsRunning: 0,
        runsLast24h: 0,
        successRate: 0,
        avgDurationMs: 0,
        runsByHour: new Array<number>(24).fill(0),
      },
    };
  }

  const jobs = scheduler.listJobs();
  const status = scheduler.status();

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const cutoff = now - dayMs;

  const runsByHour = new Array<number>(24).fill(0);
  let runsLast24h = 0;
  let successCount = 0;
  let totalDurationMs = 0;
  let durationSamples = 0;

  for (const job of jobs) {
    const runs = await listRunsForJob(job.slug).catch(() => []);
    for (const run of runs) {
      const at = run.startedAt;
      if (typeof at !== "number" || at < cutoff) continue;
      runsLast24h += 1;
      if (run.status === "success") successCount += 1;
      const duration = run.finishedAt && run.startedAt ? run.finishedAt - run.startedAt : null;
      if (typeof duration === "number" && duration > 0) {
        totalDurationMs += duration;
        durationSamples += 1;
      }
      const hourBucket = Math.floor((at - cutoff) / (60 * 60 * 1000));
      const idx = Math.max(0, Math.min(23, hourBucket));
      runsByHour[idx] += 1;
    }
  }

  return {
    aggregates: {
      jobsTotal: jobs.length,
      jobsActive: status.activeJobCount,
      jobsRunning: status.runningCount,
      runsLast24h,
      successRate: runsLast24h > 0 ? (successCount / runsLast24h) * 100 : 100,
      avgDurationMs: durationSamples > 0 ? totalDurationMs / durationSamples : 0,
      runsByHour,
    },
  };
}
