/**
 * Shared types for the Reports feature.
 *
 * - ReportJob: a scheduled cron definition, persisted as markdown+YAML at
 *   /root/reports/.jobs/<slug>.md.
 * - ReportRun: a single execution of a job. Metadata sidecar lives at
 *   /root/reports/.runs/<slug>/<iso>.json.
 * - ReportsIndex: the central read/unread index at /root/reports/.index.json.
 */

/** Per-job concurrency policy when a tick fires while the previous run is still alive. */
export type ConcurrencyPolicy = "skip" | "queue" | "cancel-previous";

/** Terminal / lifecycle state of a single run. */
export type RunStatus = "running" | "success" | "error" | "timeout" | "aborted";

/** How a run was triggered — distinguishes cron ticks from manual "Run now" clicks. */
export type RunTrigger = "cron" | "manual";

/** The persisted job definition. Fields mirror the YAML frontmatter 1:1. */
export interface ReportJob {
  /** Slug / file stem. Must match /^[a-z0-9][a-z0-9-]{0,63}$/. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Five-field cron expression (`* * * * *`). Timezone-aware via `timezone`. */
  schedule: string;
  /** IANA timezone name (e.g. "Europe/Belgrade"). Required — never fall back to server tz. */
  timezone: string;
  enabled: boolean;
  /** Schema version. Bumped when frontmatter shape changes. */
  version: number;
  /** Hard cap on agent turns per run. Enforced by our canUseTool. */
  maxTurns: number;
  /** Wall-clock cap in seconds. Enforced via AbortController. */
  maxDurationSec: number;
  concurrency: ConcurrencyPolicy;
  /** Tools Claude is allowed to call in this run. Empty = no tools allowed. */
  allowedTools: string[];
  /**
   * When Bash is in allowedTools, each invocation's command string must start
   * with one of these prefixes to be allowed through. Empty array = Bash denied
   * even if present in allowedTools (belt-and-suspenders default).
   */
  allowedBashPrefixes: string[];
  /** Subset of MCP server names from ~/.claude.json that this run may reach. */
  allowedMcpServers: string[];
  /** Directory Claude should write reports into. */
  outputDir: string;
  /** Filename template. Tokens: {date} {datetime} {slug} {runId}. */
  outputFilename: string;
  /** Alias of id — exposed for template substitution. */
  slug: string;
  notifyOnComplete: boolean;
  notifyOnError: boolean;
  /** Markdown prompt body after the frontmatter. */
  prompt: string;
}

/** Run metadata sidecar, written to .runs/<slug>/<iso>.json. */
export interface ReportRun {
  /** Unique id: <slug>-<iso>. Matches safe filename regex. */
  runId: string;
  jobId: string;
  startedAt: number;
  finishedAt: number | null;
  status: RunStatus;
  triggeredBy: RunTrigger;
  /** The cron tick that was supposed to fire, if any. null for manual runs. */
  cronTickAt: number | null;
  /** Absolute path to the generated .md; null if the run failed before writing. */
  reportPath: string | null;
  /** SessionManager sessionId so the UI can open the run as a read-only chat. */
  claudeSessionId: string | null;
  turnsUsed: number;
  toolCallsCount: number;
  /** Tools Claude tried to call that weren't whitelisted. */
  permissionDenials: string[];
  tokenUsage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreate: number;
  };
  errorMessage?: string;
  stderrTail?: string;
}

/** One entry in the central read/unread index. */
export interface ReportsIndexEntry {
  runId: string;
  jobId: string;
  jobName: string;
  createdAt: number;
  reportPath: string | null;
  status: RunStatus;
  /** ms epoch when the user opened the report, or null if still unread. */
  readAt: number | null;
}

export interface ReportsIndex {
  version: 1;
  /** Sorted newest-first. Capped at MAX_INDEX_ENTRIES (see run-store.ts). */
  runs: ReportsIndexEntry[];
}
