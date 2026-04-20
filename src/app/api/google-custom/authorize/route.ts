import { spawn, type ChildProcess } from "child_process";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { loadCredentials, registerMcpServer } from "@/lib/google-custom-config";
import { augmentPathWithLocalBin } from "@/lib/platform-detect";

/**
 * Spawn `uvx workspace-mcp` with the saved OAuth credentials and stream
 * stdout/stderr to the browser as SSE. The MCP server prints a Google
 * OAuth URL on startup which we forward to the UI. After the user
 * completes OAuth, workspace-mcp writes its token file and we mark
 * the MCP server as registered in ~/.claude.json.
 */
export async function POST(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const loadedCreds = await loadCredentials();
  if (!loadedCreds) {
    return Response.json({ error: "No credentials configured. Save them first." }, { status: 400 });
  }
  const creds = loadedCreds;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      function write(obj: Record<string, unknown>): void {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* closed */
        }
      }

      write({ type: "status", message: "Starting workspace-mcp..." });

      // workspace-mcp binds its own HTTP server for the OAuth callback. It
      // honours PORT + WORKSPACE_MCP_PORT from the environment. The chat
      // app is itself listening on PORT=3100, so if we let ...process.env
      // leak through untouched, workspace-mcp picks 3100, collides with the
      // chat, logs "Minimal OAuth server is already running" and never
      // emits the authorization URL — the SSE stream hangs forever.
      //
      // Pin the MCP callback server to a high port that nothing else in
      // the container uses. claw-nginx sidecar proxies
      // /chat/api/google-custom/oauth-callback → localhost:MCP_PORT so
      // Google's redirect can reach it through the chat's public URL.
      const MCP_PORT = process.env.WORKSPACE_MCP_PORT || "8765";

      let child: ChildProcess;
      try {
        child = spawn("uvx", ["workspace-mcp", "--tool-tier", "core"], {
          stdio: ["pipe", "pipe", "pipe"],
          shell: true,
          windowsHide: true,
          env: augmentPathWithLocalBin({
            ...process.env,
            GOOGLE_OAUTH_CLIENT_ID: creds.clientId,
            GOOGLE_OAUTH_CLIENT_SECRET: creds.clientSecret,
            PORT: MCP_PORT,
            WORKSPACE_MCP_PORT: MCP_PORT,
          }),
        });
      } catch (err) {
        write({
          type: "done",
          success: false,
          error: err instanceof Error ? err.message : "Failed to spawn uvx",
        });
        controller.close();
        return;
      }

      const URL_RE = /(https?:\/\/accounts\.google\.com\/o\/oauth2\/[^\s"'`]+)/;
      const EMAIL_RE =
        /(?:authenticated|logged in|signed in)\s+(?:as\s+)?([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/i;

      let urlEmitted = false;
      let registered = false;
      // Tail of recent stderr lines. Dumped when the process exits without
      // emitting a URL so the UI can show why it stalled.
      const stderrTail: string[] = [];

      // Fail-fast timer: if no URL arrives within 45s, kill the MCP process
      // and report what we have. Better than the UI spinning forever.
      const URL_TIMEOUT_MS = 45_000;
      const urlTimeout = setTimeout(() => {
        if (!urlEmitted && !registered) {
          write({
            type: "done",
            success: false,
            error:
              "Timed out waiting for authorization URL. workspace-mcp started but never emitted one. " +
              "Common causes: port collision, missing OAuth credentials, or an OAuth-client-id / redirect-URI mismatch.",
            stderrTail: stderrTail.slice(-15).join("\n"),
          });
          if (!child.killed) child.kill();
        }
      }, URL_TIMEOUT_MS);

      function processLine(line: string): void {
        const trimmed = line.trim();
        if (!trimmed) return;

        // Keep a rolling window of the last 30 stderr-ish lines so we can
        // dump them on timeout / error exit.
        stderrTail.push(trimmed);
        if (stderrTail.length > 30) stderrTail.shift();

        // First Google OAuth URL → forward to UI.
        if (!urlEmitted) {
          const match = trimmed.match(URL_RE);
          if (match) {
            urlEmitted = true;
            clearTimeout(urlTimeout);
            write({ type: "url", url: match[1] });
          }
        }

        // Detect successful authentication — register MCP server in claude.json.
        if (!registered) {
          const emailMatch = trimmed.match(EMAIL_RE);
          if (emailMatch || /token\s+saved|credentials\s+stored/i.test(trimmed)) {
            registered = true;
            const email = emailMatch?.[1] ?? null;
            // Persist MCP server entry (best-effort) and notify UI.
            registerMcpServer(creds)
              .then(() => {
                write({ type: "done", success: true, email });
                // Close the process gracefully after success.
                if (!child.killed) child.kill();
              })
              .catch((err) => {
                write({
                  type: "done",
                  success: false,
                  error: err instanceof Error ? err.message : "Failed to register MCP server",
                });
                if (!child.killed) child.kill();
              });
          }
        }

        write({ type: "log", line: trimmed });
      }

      child.stdout?.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n")) processLine(line);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n")) processLine(line);
      });

      child.on("close", (code) => {
        clearTimeout(urlTimeout);
        if (!registered) {
          write({
            type: "done",
            success: code === 0,
            ...(code !== 0
              ? {
                  error: `workspace-mcp exited with code ${code} before authorization completed.`,
                  stderrTail: stderrTail.slice(-15).join("\n"),
                }
              : {}),
          });
        }
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });

      child.on("error", (err) => {
        clearTimeout(urlTimeout);
        write({
          type: "done",
          success: false,
          error: err.message,
          stderrTail: stderrTail.slice(-15).join("\n"),
        });
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });

      // Abort if the client disconnects.
      request.signal.addEventListener("abort", () => {
        clearTimeout(urlTimeout);
        if (!child.killed) child.kill();
      });
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
