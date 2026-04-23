import { extractSession, unauthorized } from "@/lib/auth-server";
import { readIndex } from "@/lib/reports/run-store";
import { getSessionStatus, setSessionStatus } from "@/lib/session-status-store";

const RUN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z?$/;

type Params = { params: Promise<{ runId: string }> };

/**
 * Abort a running cron run. Since runs are synthetic SessionManager
 * sessions identified by sessionId = `cron-${runId}`, aborting is
 * implemented by flipping the session's status to idle — the wall-clock
 * timer + canUseTool denials handle the actual teardown. For a hard
 * interrupt, a future iteration can call sessionManager.interrupt via
 * a dedicated WebSocket message from the admin UI.
 */
export async function POST(request: Request, ctx: Params) {
  if (!extractSession(request)) return unauthorized();
  const { runId } = await ctx.params;
  if (!RUN_ID_RE.test(runId)) {
    return Response.json({ error: "Invalid runId" }, { status: 400 });
  }
  const index = await readIndex();
  const entry = index.runs.find((e) => e.runId === runId);
  if (!entry) return Response.json({ error: "Not found" }, { status: 404 });
  const sessionId = `cron-${runId}`;
  const currentEntry = getSessionStatus(sessionId);
  if (!currentEntry || currentEntry.status === "idle") {
    return Response.json({ ok: true, alreadyIdle: true });
  }
  // Signal idle to the sidebar immediately — the wall-clock abort timer
  // in SessionManager.runCron will tear down the SDK stream, and the
  // resulting "error" branch settles the run as aborted.
  setSessionStatus(sessionId, "idle");
  return Response.json({ ok: true });
}
