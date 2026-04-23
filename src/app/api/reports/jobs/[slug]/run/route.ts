import { extractSession, unauthorized } from "@/lib/auth-server";
import { readJob } from "@/lib/reports/job-store";
import { executeRun } from "@/lib/reports/runner";
import { getScheduler } from "@/lib/reports/scheduler-singleton";
import { getSessionManager } from "@/lib/reports/session-manager-singleton";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

type Params = { params: Promise<{ slug: string }> };

/**
 * Trigger a manual run of a job. Returns immediately with 202; the run
 * continues in the background and is observable through /api/reports/runs
 * and the sidebar.
 *
 * Two execution paths:
 *   1. If the scheduler singleton is registered, call scheduler.runNow()
 *      so per-job concurrency policies + in-flight tracking apply.
 *   2. If the scheduler isn't available (transient bootstrap race, etc.)
 *      but the SessionManager singleton IS, call executeRun() directly.
 *      This removes the 503 floor for "Run Now" — the button works as
 *      long as the custom server has booted far enough to register the
 *      SessionManager.
 */
export async function POST(request: Request, ctx: Params) {
  if (!extractSession(request)) return unauthorized();
  const { slug } = await ctx.params;
  if (!SLUG_RE.test(slug)) {
    return Response.json({ error: "Invalid slug" }, { status: 400 });
  }

  const scheduler = getScheduler();
  if (scheduler) {
    scheduler
      .runNow(slug, "manual")
      .catch((err) => console.error(`[reports] manual run ${slug} failed`, err));
    return Response.json({ ok: true, slug, via: "scheduler" }, { status: 202 });
  }

  // Scheduler not registered — try the direct path via SessionManager.
  const sm = getSessionManager();
  if (!sm) {
    console.warn(
      `[reports] Run Now ${slug}: both scheduler and SessionManager singletons are null. ` +
        `The container must run 'node server.js' (custom server), not 'next start'. ` +
        `Check /api/reports/diagnostics for runtime state.`,
    );
    return Response.json(
      {
        error:
          "Reports runtime not initialised. Check /chat/api/reports/diagnostics — " +
          "the container probably needs a rebuild with the latest code or is running " +
          "without the custom server.",
      },
      { status: 503 },
    );
  }
  const parsed = await readJob(slug);
  if (!parsed) {
    return Response.json({ error: `Job '${slug}' not found` }, { status: 404 });
  }
  // Fire-and-forget: respond 202 immediately, let the run complete in the
  // background. The runner writes the sidecar + index synchronously enough
  // that the next /api/reports/runs poll will show the "running" entry.
  console.log(`[reports] Run Now ${slug} via direct path (scheduler singleton was null)`);
  executeRun({
    job: parsed.job,
    trigger: "manual",
    cronTickAt: null,
    sessionManager: sm,
  }).catch((err) => console.error(`[reports] direct run ${slug} failed`, err));
  return Response.json({ ok: true, slug, via: "direct" }, { status: 202 });
}
