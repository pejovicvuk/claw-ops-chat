import { spawn } from "child_process";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { clearLoginSession } from "@/lib/claude-auth-sessions";

/**
 * Log out of Claude Code by running `claude auth logout`.
 * Also kills any in-flight login process for this user.
 */
export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();

  // If a login is in progress, cancel it first.
  clearLoginSession(session.email);

  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn("claude", ["auth", "logout"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      windowsHide: true,
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
    // Safety timeout — logout should be fast.
    setTimeout(() => {
      if (!child.killed) child.kill();
      resolve(1);
    }, 10_000);
  });

  if (exitCode !== 0) {
    return Response.json({ error: "Logout failed" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
