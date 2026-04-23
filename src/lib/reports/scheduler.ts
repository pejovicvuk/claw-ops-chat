import cron from "node-cron";
import { listJobs } from "./job-store";
import { executeRun, type CronCapableSessionManager } from "./runner";
import { reconcileCrashedRuns } from "./run-store";
import { ensureReportsTree } from "./paths";
import type { ReportJob, ReportRun, RunTrigger } from "./types";

/**
 * Singleton scheduler. Manages node-cron tasks + per-job in-flight
 * bookkeeping so a still-running job handles a re-tick according to the
 * job's `concurrency` policy.
 *
 * Lifecycle:
 *   new ReportScheduler(sessionManager) → stored in scheduler-singleton
 *   .bootstrap()                         → load jobs, reconcile crashes, register tasks
 *   .register(job) / .unregister(slug)   → runtime add/remove
 *   .runNow(slug, trigger)               → manual trigger (or internal tick)
 */

type ScheduledTask = ReturnType<typeof cron.schedule>;

interface InflightRun {
  runId: string;
  startedAt: number;
  abort?: () => void;
}

export interface SchedulerStatus {
  activeJobCount: number;
  runningCount: number;
}

export class ReportScheduler {
  private tasks = new Map<string, ScheduledTask>();
  private inflight = new Map<string, InflightRun>();
  private queues = new Map<string, Array<() => Promise<void>>>();
  private jobs = new Map<string, ReportJob>();

  constructor(private readonly sessionManager: CronCapableSessionManager) {}

  async bootstrap(): Promise<void> {
    await ensureReportsTree();
    const repaired = await reconcileCrashedRuns();
    if (repaired > 0) {
      console.log(`> Reports: reconciled ${repaired} crashed run(s) from prior boot`);
    }
    const parsed = await listJobs();
    for (const { job } of parsed) {
      this.jobs.set(job.slug, job);
      if (job.enabled) this.register(job);
    }
    console.log(`> Reports scheduler: ${this.tasks.size} active job(s) of ${parsed.length} total`);
  }

  /** Register (or re-register) a job's cron task. Called on boot and after CRUD. */
  register(job: ReportJob): void {
    this.unregister(job.slug);
    this.jobs.set(job.slug, job);
    if (!job.enabled) return;
    if (!cron.validate(job.schedule)) {
      console.warn(`[reports] ${job.slug}: invalid cron expression ${job.schedule}`);
      return;
    }
    const task = cron.schedule(
      job.schedule,
      () => {
        this.tick(job).catch((err) => console.error(`[reports] ${job.slug} tick error`, err));
      },
      { timezone: job.timezone || "UTC" },
    );
    this.tasks.set(job.slug, task);
  }

  unregister(slug: string): void {
    const task = this.tasks.get(slug);
    if (task) {
      try {
        task.stop();
      } catch {
        /* node-cron occasionally throws on double-stop */
      }
      this.tasks.delete(slug);
    }
  }

  /** Called when a job file is deleted — clears all in-memory state for it. */
  forget(slug: string): void {
    this.unregister(slug);
    this.jobs.delete(slug);
    this.queues.delete(slug);
  }

  /** Handle a cron tick, honoring the job's concurrency policy. */
  private async tick(job: ReportJob): Promise<void> {
    const active = this.inflight.get(job.slug);
    if (active) {
      switch (job.concurrency) {
        case "skip":
          console.log(`[reports] ${job.slug}: skip tick (still running ${active.runId})`);
          return;
        case "cancel-previous":
          if (active.abort) active.abort();
          break;
        case "queue": {
          const queue = this.queues.get(job.slug) ?? [];
          queue.push(async () => {
            await this.executeNow(job, "cron", Date.now());
          });
          this.queues.set(job.slug, queue);
          return;
        }
      }
    }
    await this.executeNow(job, "cron", Date.now());
  }

  /** Public: manual "Run now" trigger. Returns the terminal run record. */
  async runNow(slug: string, trigger: RunTrigger = "manual"): Promise<ReportRun | null> {
    const job = this.jobs.get(slug);
    if (!job) return null;
    return this.executeNow(job, trigger, null);
  }

  private async executeNow(
    job: ReportJob,
    trigger: RunTrigger,
    cronTickAt: number | null,
  ): Promise<ReportRun> {
    const run = await (async (): Promise<ReportRun> => {
      this.inflight.set(job.slug, {
        runId: `${job.slug}-pending`,
        startedAt: Date.now(),
      });
      try {
        return await executeRun({
          job,
          trigger,
          cronTickAt,
          sessionManager: this.sessionManager,
        });
      } finally {
        this.inflight.delete(job.slug);
        // Drain queued runs (concurrency=queue).
        const queue = this.queues.get(job.slug);
        if (queue && queue.length > 0) {
          const next = queue.shift();
          this.queues.set(job.slug, queue);
          if (next) {
            next().catch((err) => console.error(`[reports] ${job.slug} queued run error`, err));
          }
        }
      }
    })();
    return run;
  }

  status(): SchedulerStatus {
    return {
      activeJobCount: this.tasks.size,
      runningCount: this.inflight.size,
    };
  }

  /** Snapshot of loaded jobs — used by the API route that lists jobs with next-run info. */
  listJobs(): ReportJob[] {
    return Array.from(this.jobs.values());
  }

  isRunning(slug: string): boolean {
    return this.inflight.has(slug);
  }
}
