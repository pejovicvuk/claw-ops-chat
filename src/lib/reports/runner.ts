import { existsSync } from "fs";
import { appendFile, mkdir, stat } from "fs/promises";
import { dirname } from "path";
import { assemblePrompt } from "./prompt-assembler";
import { makeRunId, upsertIndexEntry, writeRunSidecar } from "./run-store";
import { runLogPath, jobRunsDir } from "./paths";
import type { ReportJob, ReportRun, RunTrigger } from "./types";
import type { AuditWriter } from "@/lib/audit/writer";

/**
 * Interface the runner needs from the SessionManager. Declared as a
 * structural type so we don't import server.ts here (which would create
 * a cycle and drag the SDK spawn machinery into unit tests).
 *
 * server.ts exposes `runCron` matching this contract.
 */
export interface CronCapableSessionManager {
  runCron(args: {
    sessionId: string;
    prompt: string;
    cwd: string;
    allowedTools: string[];
    allowedBashPrefixes: string[];
    maxTurns: number;
    maxDurationSec: number;
    onEvent?: (event: Record<string, unknown>) => void;
  }): Promise<CronRunOutcome>;
}

export interface CronRunOutcome {
  claudeSessionId: string | null;
  turnsUsed: number;
  toolCallsCount: number;
  denials: string[];
  tokenUsage: { input: number; output: number; cacheRead: number; cacheCreate: number };
  isError: boolean;
  errorMessage?: string;
  stderrTail?: string;
}

/**
 * Execute one run of a job, end to end.
 *
 *   1. Resolve runId, outputPath, assemble prompt.
 *   2. Write a "running" sidecar + index entry.
 *   3. mkdir -p outputDir so Claude's Write tool succeeds.
 *   4. Ask SessionManager to drive a cron-policied query.
 *   5. Tee SDK events into a .log.jsonl for later audit.
 *   6. Verify the report file exists; mark success/error accordingly.
 *   7. Update the sidecar + index with the terminal status.
 */
export async function executeRun(args: {
  job: ReportJob;
  trigger: RunTrigger;
  cronTickAt: number | null;
  sessionManager: CronCapableSessionManager;
  audit?: AuditWriter;
}): Promise<ReportRun> {
  const { job, trigger, cronTickAt, sessionManager, audit } = args;
  const now = new Date();
  const runId = makeRunId(job.slug, now);
  const { prompt, outputPath } = assemblePrompt({ job, runId, now });
  const sessionId = `cron-${runId}`;

  // Ensure output directory exists so Claude's first Write call doesn't fail.
  if (!existsSync(job.outputDir)) {
    await mkdir(job.outputDir, { recursive: true });
  }
  if (!existsSync(jobRunsDir(job.slug))) {
    await mkdir(jobRunsDir(job.slug), { recursive: true });
  }

  const initial: ReportRun = {
    runId,
    jobId: job.slug,
    startedAt: now.getTime(),
    finishedAt: null,
    status: "running",
    triggeredBy: trigger,
    cronTickAt,
    reportPath: null,
    claudeSessionId: null,
    turnsUsed: 0,
    toolCallsCount: 0,
    permissionDenials: [],
    tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
  };
  await writeRunSidecar(initial);
  await upsertIndexEntry({
    runId,
    jobId: job.slug,
    jobName: job.name,
    createdAt: initial.startedAt,
    reportPath: null,
    status: "running",
    readAt: null,
  });

  const logPath = runLogPath(job.slug, runId);
  if (!existsSync(dirname(logPath))) {
    await mkdir(dirname(logPath), { recursive: true });
  }

  let toolCallsCount = 0;
  const onEvent = (event: Record<string, unknown>) => {
    if (event.type === "tool_use_start" || event.type === "tool_use_complete") {
      toolCallsCount += 1;
    }
    // Tee semantic events into the cross-cutting audit log. The per-run
    // .log.jsonl below is the forensic layer; this is the UI layer.
    if (audit) {
      if (event.type === "tool_use_start") {
        const toolName = typeof event.name === "string" ? event.name : undefined;
        audit
          .cron({
            type: "tool_use",
            severity: "info",
            actor: "system",
            subject: `Cron tool ${toolName ?? "unknown"}: ${job.slug}`,
            durationMs: null,
            slug: job.slug,
            runId,
            toolName,
            details: {},
          })
          .catch(() => {});
      } else if (event.type === "permission_denied") {
        const toolName = typeof event.tool === "string" ? event.tool : undefined;
        audit
          .cron({
            type: "permission_denied",
            severity: "warn",
            actor: "system",
            subject: `Cron permission denied ${toolName ?? "unknown"}: ${job.slug}`,
            durationMs: null,
            slug: job.slug,
            runId,
            toolName,
            details: {},
          })
          .catch(() => {});
      }
    }
    // Fire-and-forget JSONL append; errors are logged elsewhere.
    appendFile(logPath, `${JSON.stringify({ ...event, at: Date.now() })}\n`).catch(() => {});
  };

  let outcome: CronRunOutcome;
  try {
    outcome = await sessionManager.runCron({
      sessionId,
      prompt,
      cwd: job.outputDir,
      allowedTools: job.allowedTools,
      allowedBashPrefixes: job.allowedBashPrefixes,
      maxTurns: job.maxTurns,
      maxDurationSec: job.maxDurationSec,
      onEvent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorRun: ReportRun = {
      ...initial,
      finishedAt: Date.now(),
      status: "error",
      errorMessage: message,
    };
    await writeRunSidecar(errorRun);
    await upsertIndexEntry({
      runId: errorRun.runId,
      jobId: errorRun.jobId,
      jobName: job.name,
      createdAt: errorRun.startedAt,
      reportPath: null,
      status: "error",
      readAt: null,
    });
    return errorRun;
  }

  // Verify the output file exists — the run is only a success if Claude
  // actually produced the report at the expected path.
  let reportPath: string | null = null;
  try {
    const s = await stat(outputPath);
    if (s.isFile() && s.size > 0) {
      reportPath = outputPath;
    }
  } catch {
    /* file missing — treated as error below */
  }

  const finalStatus: ReportRun["status"] = outcome.isError
    ? "error"
    : reportPath
      ? "success"
      : "error";

  const final: ReportRun = {
    ...initial,
    finishedAt: Date.now(),
    status: finalStatus,
    reportPath,
    claudeSessionId: outcome.claudeSessionId,
    turnsUsed: outcome.turnsUsed,
    toolCallsCount,
    permissionDenials: outcome.denials,
    tokenUsage: outcome.tokenUsage,
    errorMessage:
      outcome.errorMessage ??
      (finalStatus === "error" && !reportPath
        ? "Run finished without writing the expected report file"
        : undefined),
    stderrTail: outcome.stderrTail,
  };
  await writeRunSidecar(final);
  await upsertIndexEntry({
    runId: final.runId,
    jobId: final.jobId,
    jobName: job.name,
    createdAt: final.startedAt,
    reportPath,
    status: finalStatus,
    readAt: null,
  });

  return final;
}
