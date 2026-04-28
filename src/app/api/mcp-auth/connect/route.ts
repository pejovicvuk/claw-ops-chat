import { spawn } from "child_process";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { findKnownServerById } from "@/app/api/mcp-status/route";
import {
  setMcpAuthSession,
  broadcastToMcpAuthSession,
  getMcpAuthSession,
  type McpAuthSession,
  type McpAuthServiceId,
} from "@/lib/mcp-auth-sessions";

/**
 * Spawn `claude mcp add --transport http <name> <url>` and stream its output
 * as SSE. The hosted Anthropic connectors (Gmail / Drive / Calendar) trigger
 * an MCP-level OAuth flow on first use — a URL is printed on stdout, the
 * user authorizes on Anthropic's site, then pastes a code back which we
 * relay via POST /submit-code.
 *
 * No Google Cloud Console project required — OAuth happens entirely between
 * the user's browser and Anthropic's infrastructure.
 */
export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as { id?: string };
  const id = body.id;
  if (id !== "gmail" && id !== "google-drive" && id !== "google-calendar") {
    return Response.json({ error: "Invalid service id" }, { status: 400 });
  }
  const serviceId: McpAuthServiceId = id;

  const known = findKnownServerById(serviceId);
  if (!known?.url) {
    return Response.json({ error: "Unknown hosted MCP URL" }, { status: 400 });
  }

  // Argv kept in one place so it's a one-line swap if a different trigger
  // is needed (e.g. `claude mcp auth <name>` when `add` doesn't emit the URL).
  const argv = ["mcp", "add", "--transport", "http", known.cliName, known.url];

  const child = spawn("claude", argv, {
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });

  const email = session.email;
  const authSession = setMcpAuthSession(email, serviceId, child);

  const URL_RE = /(https?:\/\/[^\s"'`]+)/;

  let urlEmitted = false;
  let promptEmitted = false;

  function processLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (!urlEmitted) {
      const match = trimmed.match(URL_RE);
      if (match) {
        urlEmitted = true;
        broadcastToMcpAuthSession(email, serviceId, "url", { url: match[1] });
      }
    }

    if (!promptEmitted && /code|paste/i.test(trimmed) && /\?|:/.test(trimmed)) {
      promptEmitted = true;
      broadcastToMcpAuthSession(email, serviceId, "prompt", { message: trimmed });
    }

    broadcastToMcpAuthSession(email, serviceId, "log", { line: trimmed });
  }

  child.stdout.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) processLine(line);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) processLine(line);
  });

  child.on("close", (code) => {
    broadcastToMcpAuthSession(email, serviceId, "done", {
      success: code === 0,
      ...(code !== 0 ? { error: `Process exited with code ${code}` } : {}),
    });
  });

  child.on("error", (err) => {
    broadcastToMcpAuthSession(email, serviceId, "done", {
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

      authSession.subscribers.add(write);

      write(
        `data: ${JSON.stringify({
          type: "status",
          message: `Connecting ${known.cliName}...`,
        })}\n\n`,
      );

      const onAbort = () => {
        const current: McpAuthSession | undefined = getMcpAuthSession(email, serviceId);
        current?.subscribers.delete(write);
      };
      request.signal.addEventListener("abort", onAbort);
    },
    cancel() {
      const current = getMcpAuthSession(email, serviceId);
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
