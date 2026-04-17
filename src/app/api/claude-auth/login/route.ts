import { spawn } from "child_process";
import { extractSession, unauthorized } from "@/lib/auth-server";
import {
  setLoginSession,
  broadcastToSession,
  getLoginSession,
  type LoginSession,
} from "@/lib/claude-auth-sessions";

/**
 * Spawn `claude auth login --<method>` and stream its output as SSE.
 * The browser keeps this stream open and also calls POST /submit-code
 * separately to feed the OAuth code back into the child process.
 */
export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as { method?: string };
  const method = body.method === "console" || body.method === "token" ? body.method : "claudeai";

  // Spawn the appropriate CLI command.
  // Inherit stdin/stdout/stderr as pipes so we can relay them.
  const args = method === "token" ? ["setup-token"] : ["auth", "login", `--${method}`];
  // Prefer the system-installed Claude binary; fall back to "claude" on PATH.
  const cmd = process.platform === "win32" ? "claude" : "claude";

  const child = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "pipe"],
    shell: true, // required so Windows resolves `claude.exe` via PATH
    windowsHide: true,
  });

  const loginSession = setLoginSession(session.email, child, method);

  // URL regex — matches any https:// link printed by the CLI.
  const URL_RE = /(https?:\/\/[^\s"'`]+)/;

  let urlEmitted = false;
  let promptEmitted = false;

  function processLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Capture the login URL the first time it appears.
    if (!urlEmitted) {
      const match = trimmed.match(URL_RE);
      if (match) {
        urlEmitted = true;
        broadcastToSession(session.email, "url", { url: match[1] });
      }
    }

    // Detect prompts asking for the code (varies by CLI version).
    if (!promptEmitted && /code|paste/i.test(trimmed) && /\?|:/.test(trimmed)) {
      promptEmitted = true;
      broadcastToSession(session.email, "prompt", { message: trimmed });
    }

    broadcastToSession(session.email, "log", { line: trimmed });
  }

  child.stdout.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) processLine(line);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) processLine(line);
  });

  child.on("close", (code) => {
    broadcastToSession(session.email, "done", {
      success: code === 0,
      ...(code !== 0 ? { error: `Process exited with code ${code}` } : {}),
    });
  });

  child.on("error", (err) => {
    broadcastToSession(session.email, "done", {
      success: false,
      error: err.message,
    });
  });

  // Build the SSE stream for this client.
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

      // Subscribe to broadcasts for this user's session.
      loginSession.subscribers.add(write);

      // Initial event.
      write(`data: ${JSON.stringify({ type: "status", message: "Starting login..." })}\n\n`);

      // Cleanup when the stream closes (client disconnect).
      const onAbort = () => {
        const current: LoginSession | undefined = getLoginSession(session.email);
        current?.subscribers.delete(write);
      };
      request.signal.addEventListener("abort", onAbort);
    },
    cancel() {
      const current = getLoginSession(session.email);
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
