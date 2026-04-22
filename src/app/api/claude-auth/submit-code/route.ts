import { extractSession, unauthorized } from "@/lib/auth-server";
import { getLoginSession, broadcastToSession } from "@/lib/claude-auth-sessions";

/**
 * Relay the OAuth code from the browser to the running `claude auth login`
 * child process's stdin. The SSE stream from /login emits the eventual
 * "done" event when the child exits.
 *
 * The status codes matter here — the UI uses them to distinguish "keep
 * waiting for done" from "the login process is gone; start over":
 *
 *   200 { ok: true }   → code written, SSE will emit "done" shortly
 *   400 { error }      → empty code body (client bug)
 *   404 { error }      → no active login session — user hit /submit-code
 *                        without ever calling /login (or the session
 *                        cleaner swept it).
 *   410 { error }      → login process already exited. UI should bail
 *                        out of the "verifying" spinner and offer a
 *                        fresh Start-over.
 *   502 { error }      → stdin.write threw. Rare; shell or pipe broke.
 *
 * We also emit a synthetic "log" SSE event into the same session when
 * the code is accepted for relay, so the client sees immediate movement
 * on the stream even before the CLI starts printing.
 */
export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!code) {
    return Response.json({ error: "Code is required" }, { status: 400 });
  }

  const loginSession = getLoginSession(session.email);
  if (!loginSession) {
    return Response.json(
      { error: "No active login session. Start the login flow first." },
      { status: 404 },
    );
  }

  // Subprocess liveness: if it already exited (10-minute session timer
  // fired, or the CLI crashed, or the user clicked Submit twice), we
  // have nothing to feed. Returning 410 is the signal the UI uses to
  // bail out of "verifying" instead of waiting forever for a `done`
  // event that will never come.
  const subprocess = loginSession.process;
  if (subprocess.exitCode !== null || subprocess.killed) {
    return Response.json(
      { error: "Login process already ended — start the sign-in flow again." },
      { status: 410 },
    );
  }

  try {
    subprocess.write(`${code}\n`);
  } catch (err) {
    return Response.json(
      {
        error: `Couldn't reach the Claude CLI: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      },
      { status: 502 },
    );
  }

  // Synthetic log line on the SSE stream so the client sees something
  // happen the instant Submit completes — the CLI itself is often silent
  // for a second or two while it verifies the code against Anthropic.
  broadcastToSession(session.email, "log", {
    line: "Submitted code, waiting for Claude…",
  });

  return Response.json({ ok: true });
}
