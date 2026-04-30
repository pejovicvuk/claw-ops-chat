/**
 * Integration tests for the Claude Agent SDK.
 * Verifies the exact code path server.js uses to send messages.
 *
 * Run: npx vitest run src/lib/sdk-query.test.ts
 */
import { describe, it, expect } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { join, dirname, sep } from "path";

/* eslint-disable @typescript-eslint/no-require-imports */
const sdk = require("../../sdk-loader.js");
const { query } = sdk;

const SDK_CLI_PATH = join(dirname(require.resolve("@anthropic-ai/claude-agent-sdk")), "cli.js")
  .split(sep)
  .join("/");

function spawnClaude(opts: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
}): ChildProcess {
  const cmd = opts.command.split(sep).join("/");
  const args = opts.args.map((a) => a.split(sep).join("/"));
  return spawn(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ["pipe", "pipe", "pipe"],
    signal: opts.signal,
    windowsHide: true,
  });
}

describe("Claude Agent SDK Integration", () => {
  it("SDK loads and query is a function", () => {
    expect(typeof query).toBe("function");
  });

  it("CLI path has forward slashes and ends with cli.js", () => {
    expect(SDK_CLI_PATH).not.toContain("\\");
    expect(SDK_CLI_PATH).toMatch(/cli\.js$/);
  });

  // Real-network/subprocess test: spawns the actual `claude` CLI which
  // hits the live Claude API. Skipped by default (per
  // .claude/rules/testing.md: "no test should depend on external
  // services or network calls"). Opt in with RUN_INTEGRATION_TESTS=1
  // when you want to verify the SDK end-to-end locally. Long-term this
  // test should mock the SDK rather than spawning a real subprocess.
  const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";
  it.skipIf(!runIntegration)(
    "sends Hello and gets assistant response with text",
    async () => {
      const abortController = new AbortController();
      let gotInit = false;
      let gotAssistant = false;
      let responseText = "";

      const stream = query({
        prompt: "Respond with exactly one word: hello",
        options: {
          cwd: process.cwd(),
          maxTurns: 1,
          abortController,
          pathToClaudeCodeExecutable: SDK_CLI_PATH,
          spawnClaudeCodeProcess: spawnClaude,
        },
      });

      for await (const raw of stream) {
        const m = raw as Record<string, unknown>;

        if (m.type === "system" && m.subtype === "init") {
          gotInit = true;
          console.log("  [test] init OK, session:", m.session_id);
        }

        // The SDK sends the response as an "assistant" message (not "result").
        // This matches what claude --output-format stream-json produces.
        if (m.type === "assistant") {
          const msg = m.message as Record<string, unknown>;
          const content = msg?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text" && block.text) {
                responseText += block.text;
              }
            }
          }
          if (responseText) {
            gotAssistant = true;
            console.log("  [test] response:", responseText);
            // Close stream — no "result" event will come
            stream.close?.();
            break;
          }
        }

        // Also handle "result" in case the SDK does send it
        if (m.type === "result") {
          gotAssistant = true;
          responseText = (m.result as string) || responseText;
          console.log("  [test] result:", responseText);
          break;
        }
      }

      expect(gotInit).toBe(true);
      expect(gotAssistant).toBe(true);
      expect(responseText.length).toBeGreaterThan(0);
    },
    15_000,
  );
});
