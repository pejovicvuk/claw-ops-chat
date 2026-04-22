import { spawn } from "child_process";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { clearLoginSession } from "@/lib/claude-auth-sessions";
import { resolveBundledClaudeBinary } from "@/lib/claude-status";

/**
 * Log out of Claude Code by running `claude auth logout`.
 * Also kills any in-flight login process for this user.
 *
 * Resolves the CLI by absolute path from the SDK's bundled platform
 * package (see resolveBundledClaudeBinary) instead of relying on
 * PATH. Non-interactive /bin/sh doesn't source ~/.bashrc or
 * ~/.profile, so a bare `claude` spawn fails with "not found" on
 * deployments where the CLI lives in a user-scoped npm prefix —
 * which was the original symptom here (logout endpoint returning
 * 500 after the user logged in manually via SSH).
 */
export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();

  // If a login is in progress, cancel it first.
  clearLoginSession(session.email);

  const bundled = resolveBundledClaudeBinary();
  const claudeCmd = bundled ?? "claude";
  // Absolute path ⇒ skip the shell layer entirely. Only opt into a
  // shell when we're forced to rely on PATH lookup for the bare name.
  const useShell = !bundled;

  const { exitCode, stderr } = await new Promise<{
    exitCode: number;
    stderr: string;
  }>((resolve) => {
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
    // Safety timeout — logout should be fast.
    setTimeout(() => {
      if (!child.killed) child.kill();
      resolve({ exitCode: 1, stderr: errBuf || "Timed out after 10s" });
    }, 10_000);
  });

  if (exitCode !== 0) {
    // Surface the actual CLI error so the UI has something useful to
    // show instead of a generic "Logout failed".
    return Response.json(
      {
        error: stderr.trim().split(/\r?\n/).slice(-3).join("\n") || "Logout failed",
      },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
}
