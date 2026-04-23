import { extractSession, unauthorized } from "@/lib/auth-server";
import { listJobs, readJob, writeJob } from "@/lib/reports/job-store";
import { parseJobMarkdown } from "@/lib/reports/job-parser";
import { validateJob } from "@/lib/reports/job-validator";
import { getScheduler } from "@/lib/reports/scheduler-singleton";
import { countRunsForJob } from "@/lib/reports/run-store";
import { nextRunTimes } from "@/lib/cron-humanize";
import type { ReportJob } from "@/lib/reports/types";

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  const jobs = await listJobs();
  const scheduler = getScheduler();
  const out = await Promise.all(
    jobs.map(async ({ job }) => {
      // Enrichment per job: next scheduled run times (for dashboard
      // preview), in-flight flag from the scheduler, and aggregate run
      // counts so the UI can show "N runs · M% success" without a second
      // request per card.
      const [nextRuns, runCounts] = await Promise.all([
        nextRunTimes(job.schedule, job.timezone, 3),
        countRunsForJob(job.slug),
      ]);
      return {
        ...job,
        nextRuns,
        running: scheduler?.isRunning(job.slug) ?? runCounts.running > 0,
        runCounts,
      };
    }),
  );
  return Response.json({ jobs: out });
}

export async function POST(request: Request) {
  if (!extractSession(request)) return unauthorized();
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

  let job: ReportJob;
  let unknownFrontmatter: Record<string, unknown>;
  try {
    const parsed = parseJobMarkdown(content);
    job = parsed.job;
    unknownFrontmatter = parsed.unknownFrontmatter;
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Parse failed" },
      { status: 400 },
    );
  }

  const errors = validateJob(job);
  if (errors.length > 0) {
    return Response.json({ error: "validation failed", errors }, { status: 400 });
  }

  const existing = await readJob(job.slug);
  if (existing) {
    return Response.json({ error: `Job with slug '${job.slug}' already exists` }, { status: 409 });
  }

  await writeJob(job, unknownFrontmatter);
  getScheduler()?.register(job);

  return Response.json({ job }, { status: 201 });
}
