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

  let subprocess: LoginSubprocess;
  let backend: "pty" | "pipe";

  // Pipe is the default path. PTY stays available as an opt-in escape
  // hatch via CLAUDE_AUTH_USE_PTY=1 — the right fix for CLI versions
  // that read the paste-code through a raw TTY, but defaulting to it
  // regressed URL detection on the reporting deployment.
  //
  // Env: deliberately NOT overridden for the pipe path. Passing
  // `augmentPathWithLocalBin()` clobbered PATH on at least one prod
  // container — the shell resolved `claude` fine from the inherited
  // process.env but could not find it once we replaced env with our
  // spread clone (`/bin/sh: claude: not found`). Node's default
  // behavior when `env` is omitted is exactly what we want: child
  // inherits process.env verbatim, just like the original working
  // code did before the PATH-augmentation was added.
  const usePty = process.env.CLAUDE_AUTH_USE_PTY === "1";
  const ptyModule = usePty ? tryLoadPtyModule() : null;
  if (ptyModule) {
    // PTY still needs an explicit env since node-pty doesn't inherit
    // by default on all platforms. Use augmented PATH here because the
    // PTY path also needs to find `claude` and there's no shell layer
    // to fall back on if it isn't found.
    const pty = ptyModule.spawn("claude", args, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: process.cwd(),
      env: augmentPathWithLocalBin() as Record<string, string>,
    });
    subprocess = adaptPty(pty);
    backend = "pty";
  } else {
    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true, // required on Windows to resolve `claude.exe` via PATH
      windowsHide: true,
      // No `env` — inherit process.env so the shell can resolve
      // `claude` from the container's own PATH. See reasoning above.
    });
    subprocess = adaptChildProcess(child);
    backend = "pipe";
  }

  const loginSession = setLoginSession(email, subprocess, method);

  // URL regex — matches any https:// link printed by the CLI.
  const URL_RE = /(https?:\/\/[^\s"'`]+)/;
  // ANSI CSI sequences (colors, cursor moves, clear-line, etc.). PTY
  // output under node-pty is full of these; without stripping first,
  // the URL regex matches control-sequence noise and the prompt-detect
  // heuristic drifts. Stripping also makes the log events readable.
  const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;

  let urlEmitted = false;
  let promptEmitted = false;

  subprocess.onData((chunk) => {
    // Strip terminal control codes first — the rest of the detection
    // logic assumes plain text.
    const cleaned = chunk.replace(ANSI_RE, "");
    if (!cleaned.trim()) return;

    // Scan for the URL on the *whole* chunk (not per-line). The CLI
    // frequently prints the login URL on the same line as a prompt with
    // no trailing newline — the old line-buffered path sat on that
    // fragment forever and the browser was stuck on "Waiting for login
    // URL…". Matching the raw cleaned text releases it as soon as the
    // bytes arrive.
    if (!urlEmitted) {
      const match = cleaned.match(URL_RE);
      if (match) {
        urlEmitted = true;
        broadcastToSession(email, "url", { url: match[1] });
      }
    }

    // Prompt sniffer. Same tolerant matching — runs on the raw chunk so
    // a CR-terminated prompt isn't lost.
    if (!promptEmitted && /code|paste/i.test(cleaned) && /\?|:/.test(cleaned)) {
      promptEmitted = true;
      const lastLine =
        cleaned
          .split(/\r?\n/)
          .filter((l) => l.trim())
          .pop() ?? "";
      broadcastToSession(email, "prompt", { message: lastLine.trim() });
    }

    // Emit every non-empty line of the chunk as a log event so the
    // settings UI surfaces live CLI output. Splitting on both CR and LF
    // catches progress indicators that rewrite themselves with bare
    // carriage returns — otherwise we'd drop their text entirely.
    for (const raw of cleaned.split(/\r?\n|\r/)) {
      const line = raw.trim();
      if (line) broadcastToSession(email, "log", { line });
    }
  });

  subprocess.onClose((code) => {
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
