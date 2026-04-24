import { spawn } from "child_process";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { clearLoginSession } from "@/lib/claude-auth-sessions";
import { clearAuthState } from "@/lib/claude-auth-state";
import { deleteCredentialsFile, CREDENTIALS_PATH } from "@/lib/claude-auth-direct-oauth";
import { resolveBundledClaudeBinary } from "@/lib/claude-status";

/**
 * Log out of Claude Code.
 *
 * Default path: just delete `~/.claude/.credentials.json`. The SDK
 * reads that file on each query and treats its absence as "not
 * authenticated" — same net effect as running `claude auth logout`
 * without the subprocess hazards. The CLI's own logout subcommand
 * hangs on the reporting deployment in the same way its login
 * subcommand does, so we've stopped relying on it.
 *
 * Legacy path (behind `CLAUDE_AUTH_USE_SUBCOMMAND=1`): falls back to
 * the old `spawn("claude", ["auth", "logout"])` flow for anyone
 * running a CLI where that subcommand works. Kept for rollback;
 * wouldn't be the default even if it were reliable because direct
 * file-delete is both simpler and faster.
 */
async function postHandler(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();

  // Always clean up any in-flight sign-in flow first — abandoned PKCE
  // state or a stranded REPL child should go away before we touch the
  // credentials file. Both helpers are no-ops when nothing's pending.
  clearAuthState(session.email);
  clearLoginSession(session.email);

  if (process.env.CLAUDE_AUTH_USE_SUBCOMMAND === "1") {
    return legacySubcommandLogout();
  }

  try {
    await deleteCredentialsFile();
  } catch (err) {
    return Response.json(
      {
        error: `Couldn't remove ${CREDENTIALS_PATH}: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      },
      { status: 500 },
    );
  }
  return Response.json({ ok: true });
}

export const POST = withAudit(
  { route: "/api/claude-auth/logout", label: "Claude logout" },
  postHandler,
);

async function legacySubcommandLogout(): Promise<Response> {
  const bundled = resolveBundledClaudeBinary();
  const claudeCmd = bundled ?? "claude";
  const useShell = !bundled;

  const { exitCode, stderr } = await new Promise<{ exitCode: number; stderr: string }>(
    (resolve) => {
      const child = spawn(claudeCmd, ["auth", "logout"], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: useShell,
        windowsHide: true,
      });
      let errBuf = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        errBuf += chunk.toString();
      });
      child.on("close", (code) => resolve({ exitCode: code ?? 1, stderr: errBuf }));
      child.on("error", (err) => resolve({ exitCode: 1, stderr: errBuf || err.message }));
      setTimeout(() => {
        if (!child.killed) child.kill();
        resolve({ exitCode: 1, stderr: errBuf || "Timed out after 10s" });
      }, 10_000);
    },
  );

  if (exitCode !== 0) {
    return Response.json(
      { error: stderr.trim().split(/\r?\n/).slice(-3).join("\n") || "Logout failed" },
      { status: 500 },
    );
  }
  return Response.json({ ok: true });
}
