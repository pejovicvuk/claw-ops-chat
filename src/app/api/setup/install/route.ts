import { spawn } from "child_process";
import { extractSession, unauthorized } from "@/lib/auth-server";

export async function POST(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      function send(data: string) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      function sendEvent(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      send("Installing Claude Code CLI...");
      send(`> npm install -g @anthropic-ai/claude-code`);

      const isWindows = process.platform === "win32";
      const npmCmd = isWindows ? "npm.cmd" : "npm";

      const child = spawn(npmCmd, ["install", "-g", "@anthropic-ai/claude-code"], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: isWindows,
      });

      child.stdout.on("data", (chunk: Buffer) => {
        const lines = chunk.toString().split("\n").filter(Boolean);
        for (const line of lines) send(line);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const lines = chunk.toString().split("\n").filter(Boolean);
        for (const line of lines) send(line);
      });

      child.on("close", (code) => {
        if (code === 0) {
          send("Claude Code installed successfully.");
          sendEvent("done", { success: true });
        } else {
          send(`Installation failed with exit code ${code}`);
          sendEvent("done", { success: false, code });
        }
        controller.close();
      });

      child.on("error", (err) => {
        send(`Error: ${err.message}`);
        sendEvent("done", { success: false, error: err.message });
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
