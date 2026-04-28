import { spawn } from "child_process";
import { extractSession, unauthorized } from "@/lib/auth-server";
import {
  setPrereqSession,
  getPrereqSession,
  broadcastToPrereqSession,
  type PrereqSession,
} from "@/lib/prereq-sessions";
import { buildUvInstallCommand, detectPlatform } from "@/lib/platform-detect";

/** Prevents simultaneous uv installer processes from being spawned. */
let uvInstallInProgress = false;

/**
 * Install the `uv` / `uvx` CLI on the server where this app runs.
 *
 * `buildUvInstallCommand()` picks the right executable (resolved PowerShell
 * on Windows, curl-or-wget on Unix) and returns a spawn triplet we use
 * *without* `shell: true`. On Windows that is the critical fix — wrapping
 * the PowerShell pipeline in cmd.exe caused cmd to interpret `|` as its
 * own pipe, breaking `iex`.
 *
 * The installer targets `$HOME/.local/bin` (Unix) or
 * `%USERPROFILE%\.local\bin` (Windows), so no sudo/admin is needed.
 */

export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();

  if (uvInstallInProgress) {
    return Response.json({ error: "uv installation already in progress" }, { status: 409 });
  }
  uvInstallInProgress = true;

  const platform = detectPlatform();
  const built = await buildUvInstallCommand();
  if ("error" in built) {
    uvInstallInProgress = false;
    return Response.json({ error: built.error }, { status: 400 });
  }

  const child = spawn(built.shell, built.args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });

  const email = session.email;
  const prereqId = "uv" as const;
  const installSession = setPrereqSession(email, prereqId, child);

  broadcastToPrereqSession(email, prereqId, "status", {
    message: `Running: ${built.human}`,
    platform,
  });

  function processLine(line: string): void {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed) return;
    broadcastToPrereqSession(email, prereqId, "log", { line: trimmed });
  }

  child.stdout.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) processLine(line);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) processLine(line);
  });

  child.on("close", (code) => {
    uvInstallInProgress = false;
    broadcastToPrereqSession(email, prereqId, "done", {
      success: code === 0,
      ...(code !== 0 ? { error: `Installer exited with code ${code}` } : {}),
    });
  });

  child.on("error", (err) => {
    uvInstallInProgress = false;
    broadcastToPrereqSession(email, prereqId, "done", {
      success: false,
      error: err.message,
    });
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      function write(payload: string): void {
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          /* closed */
        }
      }

      installSession.subscribers.add(write);

      write(
        `data: ${JSON.stringify({
          type: "status",
          message: "Starting uv install...",
          platform,
        })}\n\n`,
      );

      const onAbort = () => {
        const current: PrereqSession | undefined = getPrereqSession(email, prereqId);
        current?.subscribers.delete(write);
      };
      request.signal.addEventListener("abort", onAbort);
    },
    cancel() {
      const current = getPrereqSession(email, prereqId);
      if (current) {
        for (const sub of current.subscribers) {
          if (sub) current.subscribers.delete(sub);
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
