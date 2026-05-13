import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { readJob, writeJob } from "@/lib/reports/job-store";
import { getScheduler } from "@/lib/reports/scheduler-singleton";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

type Params = { params: Promise<{ slug: string }> };

/**
 * Lightweight pause/resume endpoint. Flips the `enabled` flag in the job
 * frontmatter and re-registers the job with the scheduler — which
 * auto-unregisters when `enabled=false` (see scheduler.ts:register).
 *
 * Avoids the full PUT round-trip that requires the client to re-serialise
 * the entire markdown body just to toggle one boolean.
 */
async function postHandler(request: Request, ctx: Params) {
  if (!extractSession(request)) return unauthorized();
  const { slug } = await ctx.params;
  if (!SLUG_RE.test(slug)) {
    return Response.json({ error: "Invalid slug" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const enabled = (body as { enabled?: unknown })?.enabled;
  if (typeof enabled !== "boolean") {
    return Response.json({ error: "enabled (boolean) is required" }, { status: 400 });
  }

  const parsed = await readJob(slug);
  if (!parsed) return Response.json({ error: "Not found" }, { status: 404 });

  if (parsed.job.enabled === enabled) {
    return Response.json({ ok: true, enabled });
  }

  const updated = { ...parsed.job, enabled };
  await writeJob(updated, parsed.unknownFrontmatter);
  getScheduler()?.register(updated);

  return Response.json({ ok: true, enabled });
}

export const POST = withAudit(
  { route: "/api/reports/jobs/[slug]/enable", label: "Toggle report job enabled" },
  postHandler,
);
