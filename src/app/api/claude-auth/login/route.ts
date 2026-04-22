import { spawn } from "child_process";
import { extractSession, unauthorized } from "@/lib/auth-server";
import {
  setLoginSession,
  broadcastToSession,
  getLoginSession,
  type LoginSession,
} from "@/lib/claude-auth-sessions";
import {
  adaptChildProcess,
  adaptPty,
  tryLoadPtyModule,
  type LoginSubprocess,
} from "@/lib/claude-auth-subprocess";
import { augmentPathWithLocalBin } from "@/lib/platform-detect";

/**
 * Spawn `claude auth login --<method>` and stream its output as SSE.
 * The browser keeps this stream open and also calls POST /submit-code
 * separately to feed the OAuth code back into the child process.
 *
 * Backends:
 *   - Preferred: node-pty. Gives the CLI a real terminal. Some Claude CLI
 *     versions read the paste-code via raw-mode TTY; pipe-spawned stdin
 *     is dropped on the floor in that case and Submit silently wedges.
 *   - Fallback: child_process.spawn with pipe stdio. Used when node-pty's
 *     native binding isn't available (e.g. dev Windows without the
 *     prebuilt wheel).
 *
 * The rest of the flow (SSE log/url/prompt/done events, the
 * /submit-code stdin write, session timeout + cleanup) is identical
 * across both backends thanks to the LoginSubprocess abstraction in
 * src/lib/claude-auth-subprocess.ts.
 */
export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();
  const { email } = session;

  const body = (await request.json().catch(() => ({}))) as { method?: string };
  const method = body.method === "console" || body.method === "token" ? body.method : "claudeai";

  const args = method === "token" ? ["setup-token"] : ["auth", "login", `--${method}`];

  // Augment PATH with ~/.local/bin so `claude` resolves when the CLI
  // was installed via the in-app installer after the chat server
  // started. Same reasoning as the fix in server.ts handleUserMessage
  // — without this, the subprocess may fail to find `claude`.
  const spawnEnv = augmentPathWithLocalBin();

  let subprocess: LoginSubprocess;
  let backend: "pty" | "pipe";

  const ptyModule = tryLoadPtyModule();
  if (ptyModule) {
    // PTY path — the claude CLI thinks it has a real terminal.
    const pty = ptyModule.spawn("claude", args, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: process.cwd(),
      env: spawnEnv as Record<string, string>,
    });
    subprocess = adaptPty(pty);
    backend = "pty";
  } else {
    // Fallback — no native PTY bindings available. The CLI may wedge
    // on stdin if it uses raw-mode input, but most versions read via
    // plain readline and work fine with a pipe.
    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true, // required on Windows to resolve `claude.exe` via PATH
      windowsHide: true,
      env: spawnEnv,
    });
    subprocess = adaptChildProcess(child);
    backend = "pipe";
  }

  const loginSession = setLoginSession(email, subprocess, method);

  // URL regex — matches any https:// link printed by the CLI.
  const URL_RE = /(https?:\/\/[^\s"'`]+)/;

  let urlEmitted = false;
  let promptEmitted = false;
  let lineBuffer = ""; // PTY data arrives in arbitrary chunks, not line-aligned

  function processLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (!urlEmitted) {
      const match = trimmed.match(URL_RE);
      if (match) {
        urlEmitted = true;
        broadcastToSession(email, "url", { url: match[1] });
      }
    }

    // Detect prompts asking for the code (varies by CLI version).
    if (!promptEmitted && /code|paste/i.test(trimmed) && /\?|:/.test(trimmed)) {
      promptEmitted = true;
      broadcastToSession(email, "prompt", { message: trimmed });
    }

    broadcastToSession(email, "log", { line: trimmed });
  }

  subprocess.onData((chunk) => {
    // Both backends emit text; split on \n and keep a trailing partial
    // line in the buffer so we don't drop the last fragment when a
    // chunk boundary cuts through the middle of a line.
    lineBuffer += chunk;
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() ?? "";
    for (const line of lines) processLine(line);
  });

  subprocess.onClose((code) => {
    // Flush any trailing partial line so we don't miss a final error
    // that arrived without a newline before exit.
    if (lineBuffer.trim()) processLine(lineBuffer);
    lineBuffer = "";
    broadcastToSession(email, "done", {
      success: code === 0,
      ...(code !== 0 ? { error: `Process exited with code ${code ?? "?"}` } : {}),
    });
  });

  subprocess.onError((err) => {
    broadcastToSession(email, "done", {
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

      loginSession.subscribers.add(write);

      // Initial event — includes which backend we're on so the UI can
      // surface that diagnostically if the user hits weird behavior.
      write(
        `data: ${JSON.stringify({
          type: "status",
          message: "Starting login…",
          backend,
        })}\n\n`,
      );

      const onAbort = () => {
        const current: LoginSession | undefined = getLoginSession(email);
        current?.subscribers.delete(write);
      };
      request.signal.addEventListener("abort", onAbort);
    },
    cancel() {
      const current = getLoginSession(email);
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
