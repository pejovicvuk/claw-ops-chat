import matter from "gray-matter";
import type { ConcurrencyPolicy, ReportJob } from "./types";

/**
 * Parse and serialize a job markdown file.
 *
 * Round-trips are lossless for every field the form surfaces AND for any
 * unknown frontmatter keys — so a hand-edited file with extra YAML keys
 * survives a form-mediated save unchanged.
 */

/** Defaults applied when a field is missing from the frontmatter. */
export const JOB_DEFAULTS = {
  version: 1,
  enabled: true,
  maxTurns: 40,
  maxDurationSec: 900,
  concurrency: "skip" as ConcurrencyPolicy,
  allowedTools: [] as string[],
  allowedBashPrefixes: [] as string[],
  allowedMcpServers: [] as string[],
  notifyOnComplete: true,
  notifyOnError: true,
};

export interface ParsedJob {
  job: ReportJob;
  /** Frontmatter keys the parser didn't recognise — preserved on write. */
  unknownFrontmatter: Record<string, unknown>;
}

const KNOWN_KEYS = new Set([
  "id",
  "name",
  "schedule",
  "timezone",
  "enabled",
  "version",
  "maxTurns",
  "maxDurationSec",
  "concurrency",
  "allowedTools",
  "allowedBashPrefixes",
  "allowedMcpServers",
  "outputDir",
  "outputFilename",
  "slug",
  "notifyOnComplete",
  "notifyOnError",
]);

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function concurrency(value: unknown): ConcurrencyPolicy {
  if (value === "skip" || value === "queue" || value === "cancel-previous") return value;
  return JOB_DEFAULTS.concurrency;
}

/**
 * Parse a job markdown file. Throws if frontmatter is missing or the `id`
 * key can't be resolved — we deliberately don't silently coerce a bad file
 * into a "default" job so the caller can show an error instead of
 * registering a phantom cron.
 */
export function parseJobMarkdown(content: string): ParsedJob {
  const parsed = matter(content);
  const fm = (parsed.data ?? {}) as Record<string, unknown>;

  const id = str(fm.id) || str(fm.slug);
  if (!id) {
    throw new Error("Job markdown is missing 'id' / 'slug' frontmatter key");
  }

  const job: ReportJob = {
    id,
    slug: str(fm.slug) || id,
    name: str(fm.name) || id,
    schedule: str(fm.schedule),
    timezone: str(fm.timezone) || "UTC",
    enabled: bool(fm.enabled, JOB_DEFAULTS.enabled),
    version: num(fm.version, JOB_DEFAULTS.version),
    maxTurns: num(fm.maxTurns, JOB_DEFAULTS.maxTurns),
    maxDurationSec: num(fm.maxDurationSec, JOB_DEFAULTS.maxDurationSec),
    concurrency: concurrency(fm.concurrency),
    allowedTools: stringArray(fm.allowedTools),
    allowedBashPrefixes: stringArray(fm.allowedBashPrefixes),
    allowedMcpServers: stringArray(fm.allowedMcpServers),
    outputDir: str(fm.outputDir) || `/root/reports/${id}`,
    outputFilename: str(fm.outputFilename) || `{date}-${id}.md`,
    notifyOnComplete: bool(fm.notifyOnComplete, JOB_DEFAULTS.notifyOnComplete),
    notifyOnError: bool(fm.notifyOnError, JOB_DEFAULTS.notifyOnError),
    prompt: (parsed.content ?? "").trim(),
  };

  const unknownFrontmatter: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fm)) {
    if (!KNOWN_KEYS.has(key)) {
      unknownFrontmatter[key] = value;
    }
  }

  return { job, unknownFrontmatter };
}

/**
 * Serialize a job back to markdown+YAML. Preserves unknown frontmatter keys
 * passed in via `unknownFrontmatter` so a round trip doesn't drop user data.
 */
export function serializeJobMarkdown(
  job: ReportJob,
  unknownFrontmatter: Record<string, unknown> = {},
): string {
  const fm: Record<string, unknown> = {
    id: job.id,
    name: job.name,
    schedule: job.schedule,
    timezone: job.timezone,
    enabled: job.enabled,
    version: job.version,
    maxTurns: job.maxTurns,
    maxDurationSec: job.maxDurationSec,
    concurrency: job.concurrency,
    allowedTools: job.allowedTools,
    allowedBashPrefixes: job.allowedBashPrefixes,
    allowedMcpServers: job.allowedMcpServers,
    outputDir: job.outputDir,
    outputFilename: job.outputFilename,
    slug: job.slug,
    notifyOnComplete: job.notifyOnComplete,
    notifyOnError: job.notifyOnError,
    ...unknownFrontmatter,
  };

  return matter.stringify(job.prompt || "", fm);
}
