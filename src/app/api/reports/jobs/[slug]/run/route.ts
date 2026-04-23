import { extractSession, unauthorized } from "@/lib/auth-server";
import { getScheduler } from "@/lib/reports/scheduler-singleton";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

type Params = { params: Promise<{ slug: string }> };

/**
 * Trigger a manual run of a job. Returns immediately with the runId and
 * synthetic sessionId — the run continues in the background and its
 * status is observable through /api/reports/runs and the sidebar.
 */
export async function POST(request: Request, ctx: Params) {
  if (!extractSession(request)) return unauthorized();
  const { slug } = await ctx.params;
  if (!SLUG_RE.test(slug)) {
    return Response.json({ error: "Invalid slug" }, { status: 400 });
  }
  const scheduler = getScheduler();
  if (!scheduler) {
    return Response.json({ error: "Scheduler not ready" }, { status: 503 });
  }

  // Kick off the run but don't await — the HTTP response returns as soon
  // as the runner has registered its "running" sidecar. The session id
  // is deterministic (cron-<slug>-<iso>) but we don't expose the exact
  // runId here; the client polls /api/reports/runs to discover it.
  scheduler
    .runNow(slug, "manual")
    .catch((err) => console.error(`[reports] manual run ${slug} failed`, err));

  return Response.json({ ok: true, slug }, { status: 202 });
}
