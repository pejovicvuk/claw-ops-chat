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
import { resolveBundledClaudeBinary } from "@/lib/claude-status";
import { issueAuthState, type ClaudeAuthMethod } from "@/lib/claude-auth-state";
import { buildAuthorizeUrl, deriveCodeChallenge } from "@/lib/claude-auth-direct-oauth";

/**
 * Start the Claude Code sign-in flow and stream progress as SSE.
 *
 * Three selectable backends. The client doesn't need to know which is
 * live — it always reads the same SSE event types (status / url / log
 * / prompt / done).
 *
 *   - **Path A (default)** — direct HTTP OAuth. We generate PKCE
 *     ourselves, hand the browser the claude.com authorize URL, and
 *     complete the handshake in `/submit-code` by hitting Anthropic's
 *     token endpoint directly. No subprocess. The credentials file is
 *     written to `~/.claude/.credentials.json` in the exact shape the
 *     CLI would write. This is the primary path because the CLI's own
 *     `claude auth login --claudeai` and `claude setup-token`
 *     subcommands are broken in the currently deployed CLI version
 *     (they hang after code paste even when invoked by hand in SSH).
 *
 *   - **Path C (opt-in via `CLAUDE_AUTH_USE_REPL=1`)** — drive the
 *     interactive REPL with `/login`. Placeholder for now; the REPL
 *     flow was the user's documented-working manual workaround and
 *     is a useful backstop, but implementing auto-dismiss of trust
 *     prompts is a separate chunk of work. Falls through to Path D
 *     until implemented.
 *
 *   - **Path D (opt-in via `CLAUDE_AUTH_USE_SUBCOMMAND=1`)** — the
 *     legacy `spawn("claude", ["auth", "login", ...])` flow, kept as
 *     an emergency rollback toggle. Known-broken on the reporting
 *     deployment but harmless to leave behind a flag for ops to flip
 *     if Anthropic ever rotates OAuth endpoints out from under
 *     Path A.
 */
export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();
  const { email } = session;

  const body = (await request.json().catch(() => ({}))) as { method?: string };
  const method: ClaudeAuthMethod =
    body.method === "console" || body.method === "token" ? body.method : "claudeai";

  const useSubcommand = process.env.CLAUDE_AUTH_USE_SUBCOMMAND === "1";
  // Future: respect process.env.CLAUDE_AUTH_USE_REPL === "1" once
  // Path C lands. Today it's unwired, so the flag is a no-op.

  if (useSubcommand) {
    return legacySubcommandFlow(request, email, method);
  }
  return directOAuthFlow(request, email, method);
}

// ────────────────────────────────────────────────────────────────
// Path A — direct OAuth
// ────────────────────────────────────────────────────────────────

/**
 * Mint PKCE state, emit the authorize URL over SSE, and park the
 * stream open so `/submit-code` can push the terminal `done` event
 * when the handshake completes. We plug into the existing session
 * map with a noop LoginSubprocess so the timeout / broadcast wiring
 * doesn't need to be re-implemented.
 */
function directOAuthFlow(request: Request, email: string, method: ClaudeAuthMethod) {
  const entry = issueAuthState(email, method);
  const authUrl = buildAuthorizeUrl({
    state: entry.state,
    codeChallenge: deriveCodeChallenge(entry.codeVerifier),
  });

  const loginSession = setLoginSession(email, noopSubprocess(), method);
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
      write(
        `data: ${JSON.stringify({
          type: "status",
          message: "Opening Anthropic sign-in…",
          backend: "direct",
        })}\n\n`,
      );
      // Hand the URL to the UI immediately — nothing else to wait for.
      write(`data: ${JSON.stringify({ type: "url", url: authUrl })}\n\n`);

      const onAbort = () => {
        const current: LoginSession | undefined = getLoginSession(email);
        current?.subscribers.delete(write);
      };
      request.signal.addEventListener("abort", onAbort);
    },
    cancel() {
      const current = getLoginSession(email);
      if (current) current.subscribers.clear();
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

/**
 * LoginSubprocess that does nothing. Used by Path A to satisfy the
 * existing session-map type without a real child. Write / kill are
 * inert — the direct flow has no subprocess to signal.
 */
function noopSubprocess(): LoginSubprocess {
  return {
    pid: undefined,
    exitCode: null,
    killed: false,
    write() {
      /* no subprocess in direct flow */
    },
    kill() {
      /* no subprocess in direct flow */
    },
    onData() {
      /* no child output */
    },
    onClose() {
      /* no child lifecycle */
    },
    onError() {
      /* no child errors */
    },
  };
}

// ────────────────────────────────────────────────────────────────
// Path D — legacy subprocess (behind env flag, broken on reporting
// deployment but preserved for rollback)
// ────────────────────────────────────────────────────────────────

function legacySubcommandFlow(request: Request, email: string, method: ClaudeAuthMethod) {
  const args = method === "token" ? ["setup-token"] : ["auth", "login", `--${method}`];

  const bundledClaude = resolveBundledClaudeBinary();
  const claudeCmd = bundledClaude ?? "claude";

  let subprocess: LoginSubprocess;
  let backend: "pty" | "pipe";

  const ptyModule = tryLoadPtyModule();
  if (ptyModule) {
    const pty = ptyModule.spawn(claudeCmd, args, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    });
    subprocess = adaptPty(pty);
    backend = "pty";
  } else {
    const useShell = !bundledClaude;
    const child = spawn(claudeCmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: useShell,
      windowsHide: true,
    });
    subprocess = adaptChildProcess(child);
    backend = "pipe";
  }

  const loginSession = setLoginSession(email, subprocess, method);

  const URL_RE = /(https?:\/\/[^\s"'`]+)/;
  const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;
  let urlEmitted = false;
  let promptEmitted = false;

  subprocess.onData((chunk) => {
    const cleaned = chunk.replace(ANSI_RE, "");
    if (!cleaned.trim()) return;
    if (!urlEmitted) {
      const match = cleaned.match(URL_RE);
      if (match) {
        urlEmitted = true;
        broadcastToSession(email, "url", { url: match[1] });
      }
    }
    if (!promptEmitted && /code|paste/i.test(cleaned) && /\?|:/.test(cleaned)) {
      promptEmitted = true;
      const lastLine =
        cleaned
          .split(/\r?\n/)
          .filter((l) => l.trim())
          .pop() ?? "";
      broadcastToSession(email, "prompt", { message: lastLine.trim() });
    }
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
    broadcastToSession(email, "done", { success: false, error: err.message });
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
      loginSession.subscribers.add(write);
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
      if (current) current.subscribers.clear();
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
