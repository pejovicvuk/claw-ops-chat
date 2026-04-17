import { spawn, type ChildProcess } from "child_process";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { loadCredentials, registerMcpServer } from "@/lib/google-custom-config";

/**
 * Spawn `uvx workspace-mcp` with the saved OAuth credentials and stream
 * stdout/stderr to the browser as SSE. The MCP server prints a Google
 * OAuth URL on startup which we forward to the UI. After the user
 * completes OAuth, workspace-mcp writes its token file and we mark
 * the MCP server as registered in ~/.claude.json.
 */
export async function POST(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const creds = await loadCredentials();
  if (!creds) {
    return Response.json({ error: "No credentials configured. Save them first." }, { status: 400 });
  }

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

      let child: ChildProcess;
      try {
        child = spawn("uvx", ["workspace-mcp", "--tool-tier", "core"], {
          stdio: ["pipe", "pipe", "pipe"],
          shell: true,
          windowsHide: true,
          env: {
            ...process.env,
            GOOGLE_OAUTH_CLIENT_ID: creds.clientId,
            GOOGLE_OAUTH_CLIENT_SECRET: creds.clientSecret,
          },
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

      function processLine(line: string): void {
        const trimmed = line.trim();
        if (!trimmed) return;

        // First Google OAuth URL → forward to UI.
        if (!urlEmitted) {
          const match = trimmed.match(URL_RE);
          if (match) {
            urlEmitted = true;
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
        if (!registered) {
          write({
            type: "done",
            success: code === 0,
            ...(code !== 0 ? { error: `Process exited with code ${code}` } : {}),
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
        write({ type: "done", success: false, error: err.message });
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });

      // Abort if the client disconnects.
      request.signal.addEventListener("abort", () => {
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
