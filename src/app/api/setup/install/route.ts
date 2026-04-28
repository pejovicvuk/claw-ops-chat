import { spawn } from "child_process";
import { extractSession, unauthorized } from "@/lib/auth-server";

/** Prevents simultaneous npm install processes from being spawned. */
let installInProgress = false;

export async function POST(request: Request) {
  if (!extractSession(request)) return unauthorized();

  if (installInProgress) {
    return Response.json({ error: "Installation already in progress" }, { status: 409 });
  }
  installInProgress = true;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      function send(data: string) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      function sendEvent(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      const isWindows = process.platform === "win32";
      const npmCmd = isWindows ? "npm.cmd" : "npm";

      // Step 1: Reinstall the SDK with optional deps (gets the native binary)
      send("Step 1/2: Reinstalling Claude Agent SDK with native binaries...");
      send("> npm install @anthropic-ai/claude-agent-sdk");

      const step1 = spawn(npmCmd, ["install", "@anthropic-ai/claude-agent-sdk"], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: isWindows,
        cwd: process.cwd(),
      });

      step1.stdout.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n").filter(Boolean)) send(line);
      });
      step1.stderr.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n").filter(Boolean)) send(line);
      });

      step1.on("close", (code1) => {
        if (code1 !== 0) {
          send(`SDK reinstall failed (exit ${code1}). Trying global install...`);
        } else {
          send("SDK reinstalled successfully.");
        }

        // Step 2: Install Claude Code CLI globally
        send("Step 2/2: Installing Claude Code CLI globally...");
        send("> npm install -g @anthropic-ai/claude-code");

        const step2 = spawn(npmCmd, ["install", "-g", "@anthropic-ai/claude-code"], {
          stdio: ["ignore", "pipe", "pipe"],
          shell: isWindows,
        });

        step2.stdout.on("data", (chunk: Buffer) => {
          for (const line of chunk.toString().split("\n").filter(Boolean)) send(line);
        });
        step2.stderr.on("data", (chunk: Buffer) => {
          for (const line of chunk.toString().split("\n").filter(Boolean)) send(line);
        });

        step2.on("close", (code2) => {
          installInProgress = false;
          if (code1 === 0 || code2 === 0) {
            send("Installation complete. Please restart the dev server (npm run dev).");
            sendEvent("done", { success: true });
          } else {
            send(`Installation failed (SDK: ${code1}, CLI: ${code2})`);
            sendEvent("done", { success: false });
          }
          controller.close();
        });

        step2.on("error", (err) => {
          installInProgress = false;
          send(`Error: ${err.message}`);
          sendEvent("done", { success: false, error: err.message });
          controller.close();
        });
      });

      step1.on("error", (err) => {
        installInProgress = false;
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
