import { join } from "path";
import type { ReportJob } from "./types";

/**
 * Assemble the final prompt the runner sends to Claude. Consists of:
 *   1. The job's prompt body (with {{token}} substitutions).
 *   2. An environment envelope describing the run context + output path.
 *
 * Tokens recognised in the body: {{outputPath}} {{outputDir}} {{date}}
 * {{datetime}} {{jobId}} {{slug}} {{runId}} {{timezone}}.
 *
 * Tokens recognised in the filename pattern (different braces, single):
 * {date} {datetime} {slug} {runId}.
 */

export interface PromptContext {
  job: ReportJob;
  runId: string;
  now: Date;
}

/** Resolve the final output filename by substituting {date}, {slug}, etc. */
export function resolveOutputFilename(ctx: PromptContext): string {
  const { job, runId, now } = ctx;
  const date = now.toISOString().slice(0, 10); // 2026-04-23
  const datetime = now
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/-\d{3}Z$/, "Z");
  return job.outputFilename
    .replace(/\{date\}/g, date)
    .replace(/\{datetime\}/g, datetime)
    .replace(/\{slug\}/g, job.slug)
    .replace(/\{runId\}/g, runId);
}

/** Full absolute path Claude should write the report to. */
export function resolveOutputPath(ctx: PromptContext): string {
  return join(ctx.job.outputDir, resolveOutputFilename(ctx));
}

/** Substitute {{tokens}} in the prompt body. */
function substituteBody(body: string, ctx: PromptContext, outputPath: string): string {
  const { job, runId, now } = ctx;
  const date = now.toISOString().slice(0, 10);
  const datetime = now.toISOString();
  const replacements: Record<string, string> = {
    outputPath,
    outputDir: job.outputDir,
    date,
    datetime,
    jobId: job.id,
    slug: job.slug,
    runId,
    timezone: job.timezone,
  };
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return replacements[key] ?? `{{${key}}}`;
  });
}

const ENVELOPE_PREAMBLE = "\n\n---\n\nENVIRONMENT (do not rely on your own clock):";

/** Build the final prompt string sent to the SDK. */
export function assemblePrompt(ctx: PromptContext): { prompt: string; outputPath: string } {
  const outputPath = resolveOutputPath(ctx);
  const body = substituteBody(ctx.job.prompt, ctx, outputPath);
  const envelope =
    `${ENVELOPE_PREAMBLE}\n` +
    `- Today: ${ctx.now.toISOString().slice(0, 10)}\n` +
    `- Job ID / slug: ${ctx.job.id} / ${ctx.job.slug}\n` +
    `- Output file (MUST write here): ${outputPath}\n` +
    `- Timezone: ${ctx.job.timezone}\n\n` +
    "All permissions pre-granted for tools declared in the job.\n" +
    "Do NOT call AskUserQuestion or ExitPlanMode (auto-denied). You are running\n" +
    "autonomously — if a tool fails, continue with the remaining sections.\n";
  return { prompt: `${body}${envelope}`, outputPath };
}
