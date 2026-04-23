import { extractSession, unauthorized } from "@/lib/auth-server";
import { archiveJob, deleteJob, readJob, writeJob } from "@/lib/reports/job-store";
import { parseJobMarkdown, serializeJobMarkdown } from "@/lib/reports/job-parser";
import { validateJob } from "@/lib/reports/job-validator";
import { getScheduler } from "@/lib/reports/scheduler-singleton";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

type Params = { params: Promise<{ slug: string }> };

async function resolveSlug(ctx: Params): Promise<string | null> {
  const { slug } = await ctx.params;
  return SLUG_RE.test(slug) ? slug : null;
}

export async function GET(request: Request, ctx: Params) {
  if (!extractSession(request)) return unauthorized();
  const slug = await resolveSlug(ctx);
  if (!slug) return Response.json({ error: "Invalid slug" }, { status: 400 });
  const parsed = await readJob(slug);
  if (!parsed) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    job: parsed.job,
    markdown: serializeJobMarkdown(parsed.job, parsed.unknownFrontmatter),
  });
}

export async function PUT(request: Request, ctx: Params) {
  if (!extractSession(request)) return unauthorized();
  const slug = await resolveSlug(ctx);
  if (!slug) return Response.json({ error: "Invalid slug" }, { status: 400 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const content = (body as { markdown?: string })?.markdown;
  if (typeof content !== "string" || content.trim() === "") {
    return Response.json({ error: "markdown body is required" }, { status: 400 });
  }
  try {
    const { job, unknownFrontmatter } = parseJobMarkdown(content);
    if (job.slug !== slug) {
      return Response.json(
        { error: "Slug in frontmatter must match the URL path" },
        { status: 400 },
      );
    }
    const errors = validateJob(job);
    if (errors.length > 0) {
      return Response.json({ error: "validation failed", errors }, { status: 400 });
    }
    await writeJob(job, unknownFrontmatter);
    getScheduler()?.register(job);
    return Response.json({ job });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Parse failed" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request, ctx: Params) {
  if (!extractSession(request)) return unauthorized();
  const slug = await resolveSlug(ctx);
  if (!slug) return Response.json({ error: "Invalid slug" }, { status: 400 });
  const url = new URL(request.url);
  const archive = url.searchParams.get("archive") !== "0"; // default: archive (soft delete)
  const scheduler = getScheduler();
  scheduler?.forget(slug);
  if (archive) {
    await archiveJob(slug);
  } else {
    await deleteJob(slug);
  }
  return Response.json({ ok: true, archived: archive });
}
