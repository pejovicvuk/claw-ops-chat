import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Redirect HOME so the helper's `~/.claude.json` lands in a temp dir —
// google-custom-config.ts resolves the path once at import time via
// `os.homedir()`, so HOME must be set before the dynamic import.
const tmpHome = mkdtempSync(join(tmpdir(), "google-custom-config-"));
process.env.HOME = tmpHome;
const claudeJson = join(tmpHome, ".claude.json");

const mod = await import("./google-custom-config");
const { registerMcpServer, migrateGoogleMcpTier, MCP_SERVER_ID, WORKSPACE_MCP_TOOL_TIER } = mod;

function readClaudeJson(): Record<string, unknown> {
  if (!existsSync(claudeJson)) return {};
  return JSON.parse(readFileSync(claudeJson, "utf-8")) as Record<string, unknown>;
}

beforeEach(() => {
  if (existsSync(claudeJson)) rmSync(claudeJson);
});

afterAll(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("registerMcpServer", () => {
  it("writes the current tool tier (regression guard against legacy 'core')", async () => {
    await registerMcpServer({ clientId: "id", clientSecret: "sec" });
    const data = readClaudeJson();
    const servers = data.mcpServers as Record<string, { args: unknown[] }>;
    const args = servers[MCP_SERVER_ID].args as string[];
    expect(args).toContain("--tool-tier");
    expect(args[args.indexOf("--tool-tier") + 1]).toBe(WORKSPACE_MCP_TOOL_TIER);
    expect(args).not.toContain("core");
  });

  it("includes the per-user email env when provided", async () => {
    await registerMcpServer({
      clientId: "id",
      clientSecret: "sec",
      accountEmail: "user@example.com",
    });
    const servers = readClaudeJson().mcpServers as Record<string, { env: Record<string, string> }>;
    expect(servers[MCP_SERVER_ID].env.USER_GOOGLE_EMAIL).toBe("user@example.com");
  });
});

describe("migrateGoogleMcpTier", () => {
  it("rewrites a legacy 'core' tier to the current tier in place", async () => {
    writeFileSync(
      claudeJson,
      JSON.stringify({
        mcpServers: {
          [MCP_SERVER_ID]: {
            type: "stdio",
            command: "uvx",
            args: ["workspace-mcp", "--single-user", "--tool-tier", "core"],
            env: {
              GOOGLE_OAUTH_CLIENT_ID: "id",
              GOOGLE_OAUTH_CLIENT_SECRET: "sec",
              WORKSPACE_MCP_CREDENTIALS_DIR: "/some/path",
              USER_GOOGLE_EMAIL: "user@example.com",
            },
          },
        },
      }),
    );
    const result = await migrateGoogleMcpTier();
    expect(result).toEqual({ migrated: true, oldTier: "core" });

    const entry = (readClaudeJson().mcpServers as Record<string, { args: string[]; env: unknown }>)[
      MCP_SERVER_ID
    ];
    expect(entry.args).toEqual([
      "workspace-mcp",
      "--single-user",
      "--tool-tier",
      WORKSPACE_MCP_TOOL_TIER,
    ]);
    expect(entry.env).toEqual({
      GOOGLE_OAUTH_CLIENT_ID: "id",
      GOOGLE_OAUTH_CLIENT_SECRET: "sec",
      WORKSPACE_MCP_CREDENTIALS_DIR: "/some/path",
      USER_GOOGLE_EMAIL: "user@example.com",
    });
  });

  it("is a no-op when the tier already matches", async () => {
    writeFileSync(
      claudeJson,
      JSON.stringify({
        mcpServers: {
          [MCP_SERVER_ID]: {
            type: "stdio",
            command: "uvx",
            args: ["workspace-mcp", "--single-user", "--tool-tier", WORKSPACE_MCP_TOOL_TIER],
            env: {},
          },
        },
      }),
    );
    expect(await migrateGoogleMcpTier()).toEqual({ migrated: false });
  });

  it("is a no-op when our entry is absent", async () => {
    writeFileSync(
      claudeJson,
      JSON.stringify({ mcpServers: { other: { type: "stdio", command: "x", args: [] } } }),
    );
    expect(await migrateGoogleMcpTier()).toEqual({ migrated: false });
  });

  it("is a no-op when ~/.claude.json is missing", async () => {
    expect(await migrateGoogleMcpTier()).toEqual({ migrated: false });
  });

  it("does not throw on corrupt JSON", async () => {
    writeFileSync(claudeJson, "{not valid json");
    await expect(migrateGoogleMcpTier()).resolves.toEqual({ migrated: false });
  });

  it("preserves unrelated top-level keys and other MCP servers", async () => {
    writeFileSync(
      claudeJson,
      JSON.stringify({
        someOtherConfig: { a: 1 },
        mcpServers: {
          [MCP_SERVER_ID]: {
            type: "stdio",
            command: "uvx",
            args: ["workspace-mcp", "--single-user", "--tool-tier", "core"],
            env: {},
          },
          unrelated: { type: "stdio", command: "node", args: ["x.js"] },
        },
      }),
    );
    await migrateGoogleMcpTier();
    const data = readClaudeJson();
    expect(data.someOtherConfig).toEqual({ a: 1 });
    const servers = data.mcpServers as Record<string, unknown>;
    expect(servers.unrelated).toEqual({ type: "stdio", command: "node", args: ["x.js"] });
  });

  it("rewrites whatever non-current tier is present (e.g. 'extended')", async () => {
    writeFileSync(
      claudeJson,
      JSON.stringify({
        mcpServers: {
          [MCP_SERVER_ID]: {
            type: "stdio",
            command: "uvx",
            args: ["workspace-mcp", "--single-user", "--tool-tier", "extended"],
            env: {},
          },
        },
      }),
    );
    const result = await migrateGoogleMcpTier();
    expect(result).toEqual({ migrated: true, oldTier: "extended" });
  });

  it("is a no-op when --tool-tier flag is absent from args", async () => {
    writeFileSync(
      claudeJson,
      JSON.stringify({
        mcpServers: {
          [MCP_SERVER_ID]: {
            type: "stdio",
            command: "uvx",
            args: ["workspace-mcp", "--single-user"],
            env: {},
          },
        },
      }),
    );
    expect(await migrateGoogleMcpTier()).toEqual({ migrated: false });
  });
});
