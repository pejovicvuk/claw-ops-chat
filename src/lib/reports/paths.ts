import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

/**
 * Canonical paths for the Reports feature. All file system access for
 * reports should go through these helpers so the layout is only defined
 * in one place.
 */

/** Root directory for everything reports-related. Claude can cd here. */
export const REPORTS_ROOT = "/root/reports";

/** Hidden from the file browser (starts with "."), contains job definitions. */
export const JOBS_DIR = join(REPORTS_ROOT, ".jobs");

/** Hidden from the file browser, contains per-run metadata sidecars. */
export const RUNS_DIR = join(REPORTS_ROOT, ".runs");

/** Central read/unread index file. */
export const INDEX_PATH = join(REPORTS_ROOT, ".index.json");

/** README.md that explains the layout to any Claude Code session. */
export const README_PATH = join(REPORTS_ROOT, "README.md");

/** Path to a job definition file. Caller must validate slug. */
export function jobFilePath(slug: string): string {
  return join(JOBS_DIR, `${slug}.md`);
}

/** Path to a disabled (archived) job definition file. */
export function disabledJobFilePath(slug: string): string {
  return join(JOBS_DIR, `${slug}.disabled.md`);
}

/** Directory for a job's run sidecars. */
export function jobRunsDir(slug: string): string {
  return join(RUNS_DIR, slug);
}

/** Path to one run's metadata sidecar. */
export function runSidecarPath(slug: string, runId: string): string {
  return join(RUNS_DIR, slug, `${runId}.json`);
}

/** Path to one run's structured event log (JSONL). */
export function runLogPath(slug: string, runId: string): string {
  return join(RUNS_DIR, slug, `${runId}.log.jsonl`);
}

/** Default per-job output directory. */
export function defaultOutputDir(slug: string): string {
  return join(REPORTS_ROOT, slug);
}

const README_BODY = `# Reports

This directory holds scheduled autonomous reports produced by Claude.

## Layout

- \`.jobs/<slug>.md\` — scheduled job definitions (YAML frontmatter + prompt body).
- \`.runs/<slug>/<runId>.json\` — per-run metadata sidecars (status, duration).
- \`.runs/<slug>/<runId>.log.jsonl\` — per-run structured event log.
- \`.index.json\` — read/unread index, maintained automatically.
- \`<slug>/\` — per-job output directory where generated reports live.

## When you are invoked via a cron job

You receive a prompt envelope that spells out the exact output path. Write
the report there and nowhere else — the runner checks that file exists when
you finish and marks the run failed if it doesn't.

Do not call AskUserQuestion or ExitPlanMode; the runner auto-denies them
because there is no human watching. If a tool fails, skip that section
rather than halting.
`;

/**
 * Create the reports directory tree if it doesn't exist. Called at
 * scheduler bootstrap. Idempotent — safe to call on every server start.
 */
export async function ensureReportsTree(): Promise<void> {
  for (const dir of [REPORTS_ROOT, JOBS_DIR, RUNS_DIR]) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }
  if (!existsSync(README_PATH)) {
    await writeFile(README_PATH, README_BODY, "utf-8");
  }
}
