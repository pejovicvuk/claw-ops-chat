import { spawn } from "child_process";
import { extractSession, unauthorized } from "@/lib/auth-server";
import {
  setPrereqSession,
  getPrereqSession,
  broadcastToPrereqSession,
  type PrereqSession,
} from "@/lib/prereq-sessions";

/**
 * Install the `uv` / `uvx` CLI on the server where this app runs.
 *
 * Commands are hardcoded to the official Astral installer — no user input
 * is passed to the shell. `uv` installs to `$HOME/.local/bin` on Linux/macOS
 * and `%USERPROFILE%\.local\bin` on Windows by default, so no sudo/admin
 * privileges are required.
 *
 * Stream stdout/stderr as SSE so the user can watch progress live.
 */

type Platform = "win32" | "linux" | "darwin" | "other";

function detectPlatform(): Platform {
  if (process.platform === "win32") return "win32";
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "darwin";
  return "other";
}

interface InstallCommand {
  shell: string;
  args: string[];
  human: string;
}

function buildInstallCommand(platform: Platform): InstallCommand | null {
  if (platform === "win32") {
    const cmd = "irm https://astral.sh/uv/install.ps1 | iex";
    return {
      shell: "powershell",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd],
      human: `powershell -Command "${cmd}"`,
    };
  }
  if (platform === "linux" || platform === "darwin") {
    const cmd = "curl -LsSf https://astral.sh/uv/install.sh | sh";
    return {
      shell: "sh",
      args: ["-c", cmd],
      human: cmd,
    };
  }
  return null;
}

export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();

  const platform = detectPlatform();
  const command = buildInstallCommand(platform);
  if (!command) {
    return Response.json({ error: `Unsupported platform: ${process.platform}` }, { status: 400 });
  }

  const child = spawn(command.shell, command.args, {
    stdio: ["ignore", "pipe", "pipe"],
    // On Windows, spawn needs `shell: true` to resolve `powershell.exe`
    // via PATH when not given an absolute path.
    shell: platform === "win32",
    windowsHide: true,
  });

  const email = session.email;
  const prereqId = "uv" as const;
  const installSession = setPrereqSession(email, prereqId, child);

  broadcastToPrereqSession(email, prereqId, "status", {
    message: `Running: ${command.human}`,
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
    broadcastToPrereqSession(email, prereqId, "done", {
      success: code === 0,
      ...(code !== 0 ? { error: `Installer exited with code ${code}` } : {}),
    });
  });

  child.on("error", (err) => {
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
