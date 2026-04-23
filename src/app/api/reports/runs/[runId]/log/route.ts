import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { runLogPath } from "@/lib/reports/paths";
import { readIndex, readRunSidecar } from "@/lib/reports/run-store";
import type { ReportRun } from "@/lib/reports/types";

const RUN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z?$/;

type Params = { params: Promise<{ runId: string }> };

export interface RunLogEvent {
  type: string;
  at: number;
  [key: string]: unknown;
}

interface LogResponse {
  run: ReportRun | null;
  status: ReportRun["status"] | null;
  events: RunLogEvent[];
  /** Number of events returned; clients can diff with the prior poll. */
  total: number;
}

/**
 * Read the .log.jsonl for a run and return parsed events plus current
 * status. The viewer polls this every 1.5s while the run is in flight;
 * returning the full log each time is acceptable at our volumes (hundreds
 * of events per run) and removes the need for a cursor protocol.
 *
 * Supports `?since=<index>` to skip events the client already has — a
 * cheap optimisation that keeps network traffic low on long runs.
 */
export async function GET(request: Request, ctx: Params) {
  if (!extractSession(request)) return unauthorized();
  const { runId } = await ctx.params;
  if (!RUN_ID_RE.test(runId)) {
    return Response.json({ error: "Invalid runId" }, { status: 400 });
  }

  const url = new URL(request.url);
  const since = Math.max(0, Number(url.searchParams.get("since") ?? "0") || 0);

  const index = await readIndex();
  const entry = index.runs.find((e) => e.runId === runId);
  if (!entry) return Response.json({ error: "Not found" }, { status: 404 });

  const sidecar = await readRunSidecar(entry.jobId, runId);

  const logFile = runLogPath(entry.jobId, runId);
  let events: RunLogEvent[] = [];
  if (existsSync(logFile)) {
    try {
      const raw = await readFile(logFile, "utf-8");
      const lines = raw.split("\n").filter((l) => l.trim().length > 0);
      events = lines
        .map((line) => {
          try {
            return JSON.parse(line) as RunLogEvent;
          } catch {
            return null;
          }
        })
        .filter((e): e is RunLogEvent => e !== null);
    } catch {
      /* fall through with empty events */
    }
  }

  const total = events.length;
  const sliced = since > 0 ? events.slice(since) : events;

  const body: LogResponse = {
    run: sidecar,
    status: sidecar?.status ?? entry.status,
    events: sliced,
    total,
  };
  return Response.json(body);
}
