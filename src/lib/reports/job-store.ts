import { existsSync } from "fs";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "fs/promises";
import { dirname } from "path";
import { parseJobMarkdown, serializeJobMarkdown, type ParsedJob } from "./job-parser";
import { JOBS_DIR, disabledJobFilePath, ensureReportsTree, jobFilePath } from "./paths";
import type { ReportJob } from "./types";

/**
 * CRUD for job definitions (markdown files under /root/reports/.jobs/).
 *
 * Writes are atomic (write to .tmp then rename) so a crash mid-write
 * never leaves half a YAML document on disk. Slug is validated before
 * every file system touch so `../../../etc/passwd` can't escape.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function assertSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new Error(`Invalid job slug: ${slug}`);
  }
}

/** List every enabled job (disabled/archived jobs have .disabled.md suffix). */
export async function listJobs(): Promise<Array<ParsedJob & { filename: string }>> {
  await ensureReportsTree();
  const out: Array<ParsedJob & { filename: string }> = [];
  let entries: string[];
  try {
    entries = await readdir(JOBS_DIR);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (!name.endsWith(".md") || name.endsWith(".disabled.md")) continue;
    try {
      const raw = await readFile(`${JOBS_DIR}/${name}`, "utf-8");
      out.push({ ...parseJobMarkdown(raw), filename: name });
    } catch (err) {
      console.warn(`[reports] failed to parse ${name}:`, (err as Error).message);
    }
  }
  return out;
}

/** Read one job. Returns null if missing. */
export async function readJob(slug: string): Promise<ParsedJob | null> {
  assertSlug(slug);
  const path = jobFilePath(slug);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf-8");
  return parseJobMarkdown(raw);
}

/** Create or overwrite a job file. Performs atomic write. */
export async function writeJob(
  job: ReportJob,
  unknownFrontmatter: Record<string, unknown> = {},
): Promise<void> {
  assertSlug(job.id);
  await ensureReportsTree();
  const path = jobFilePath(job.id);
  const content = serializeJobMarkdown(job, unknownFrontmatter);
  const tmp = `${path}.tmp`;
  const dir = dirname(path);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, path);
}

/** Permanently delete a job (keeps historical runs; those belong to run-store). */
export async function deleteJob(slug: string): Promise<void> {
  assertSlug(slug);
  const path = jobFilePath(slug);
  if (existsSync(path)) await unlink(path);
}

/**
 * Archive a job (rename .md → .disabled.md). Preserves history and makes
 * the job recoverable. The scheduler skips .disabled.md files, so archiving
 * effectively pauses the job without data loss.
 */
export async function archiveJob(slug: string): Promise<void> {
  assertSlug(slug);
  const src = jobFilePath(slug);
  if (!existsSync(src)) return;
  await rename(src, disabledJobFilePath(slug));
}
