import { extractSession, unauthorized } from "@/lib/auth-server";
import { getScheduler } from "@/lib/reports/scheduler-singleton";
import { getSessionManager } from "@/lib/reports/session-manager-singleton";
import { listJobs } from "@/lib/reports/job-store";

/**
 * Read-only diagnostics for the reports runtime. Use it to answer "why
 * doesn't Run Now work?" without SSH'ing into the container:
 *
 *   curl https://…/chat/api/reports/diagnostics
 *
 * Returns:
 *   - whether the scheduler and SessionManager singletons are registered
 *     (seen through the same globalThis handle the API routes use)
 *   - how many job files are on disk
 *   - scheduler task count + next-fire time per slug
 *
 * If `schedulerSingletonSet` or `sessionManagerSingletonSet` is false, the
 * custom server (server.ts / server.js) hasn't booted the singletons —
 * check that the container is running `node server.js`, not `next start`.
 */
export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const scheduler = getScheduler();
  const sessionManager = getSessionManager();
  const jobsOnDisk = await listJobs().catch(() => []);

  const schedulerState = scheduler
    ? {
        ...scheduler.status(),
        nextRuns: scheduler.listJobs().map((job) => {
          const next = scheduler.nextRunFor(job.slug);
          return {
            slug: job.slug,
            enabled: job.enabled,
            schedule: job.schedule,
            timezone: job.timezone,
            nextRunAt: next ? next.toISOString() : null,
            running: scheduler.isRunning(job.slug),
          };
        }),
      }
    : null;

  return Response.json({
    schedulerSingletonSet: scheduler !== null,
    sessionManagerSingletonSet: sessionManager !== null,
    jobsOnDisk: jobsOnDisk.length,
    jobFilenames: jobsOnDisk.map((j) => j.filename),
    scheduler: schedulerState,
    now: new Date().toISOString(),
  });
}
