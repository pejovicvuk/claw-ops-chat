import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Redirect HOME so the helper's `~/.claude.json` lands in a temp dir —
// crucial because the module resolves the path once at import time via
// `os.homedir()`. Any change to HOME after the import would be ignored.
const tmpHome = mkdtempSync(join(tmpdir(), "mcp-register-"));
process.env.HOME = tmpHome;
const claudeJson = join(tmpHome, ".claude.json");

const mod = await import("./mcp-register");
const { registerMcpServer, unregisterMcpServer, isMcpServerRegistered, readMcpServer } = mod;

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
  it("creates claude.json with the server block when the file doesn't exist", async () => {
    await registerMcpServer("github", {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_test" },
    });
    const data = readClaudeJson();
    expect(data.mcpServers).toBeDefined();
    const servers = data.mcpServers as Record<string, unknown>;
    expect(servers.github).toMatchObject({
      type: "stdio",
      command: "npx",
    });
  });

  it("preserves unrelated top-level keys in claude.json", async () => {
    writeFileSync(
      claudeJson,
      JSON.stringify({ someOtherConfig: { a: 1 }, mcpServers: { existing: { type: "stdio" } } }),
    );
    await registerMcpServer("github", {
      type: "stdio",
      command: "npx",
      args: [],
    });
    const data = readClaudeJson();
    expect(data.someOtherConfig).toEqual({ a: 1 });
    const servers = data.mcpServers as Record<string, unknown>;
    expect(servers.existing).toBeDefined();
    expect(servers.github).toBeDefined();
  });

  it("overwrites an existing entry with the same id", async () => {
    await registerMcpServer("linear", {
      type: "stdio",
      command: "node",
      args: ["old.js"],
      env: { LINEAR_API_KEY: "old" },
    });
    await registerMcpServer("linear", {
      type: "stdio",
      command: "node",
      args: ["new.js"],
      env: { LINEAR_API_KEY: "new" },
    });
    const def = await readMcpServer("linear");
    expect(def).toMatchObject({
      command: "node",
      args: ["new.js"],
      env: { LINEAR_API_KEY: "new" },
    });
  });

  it("supports http transport definitions", async () => {
    await registerMcpServer("slack", {
      type: "http",
      url: "https://mcp.example.com/slack",
      headers: { Authorization: "Bearer xyz" },
    });
    const def = await readMcpServer("slack");
    expect(def).toMatchObject({ type: "http", url: "https://mcp.example.com/slack" });
  });
});

describe("unregisterMcpServer", () => {
  it("removes only the target entry", async () => {
    await registerMcpServer("a", { type: "stdio", command: "cmd-a", args: [] });
    await registerMcpServer("b", { type: "stdio", command: "cmd-b", args: [] });
    await unregisterMcpServer("a");
    expect(await isMcpServerRegistered("a")).toBe(false);
    expect(await isMcpServerRegistered("b")).toBe(true);
  });

  it("is a no-op when the server is absent", async () => {
    await registerMcpServer("a", { type: "stdio", command: "cmd-a", args: [] });
    await unregisterMcpServer("does-not-exist");
    expect(await isMcpServerRegistered("a")).toBe(true);
  });

  it("is a no-op when claude.json is missing entirely", async () => {
    // beforeEach already deleted the file
    await expect(unregisterMcpServer("anything")).resolves.toBeUndefined();
  });
});

describe("isMcpServerRegistered", () => {
  it("returns false for a missing file", async () => {
    expect(await isMcpServerRegistered("github")).toBe(false);
  });

  it("returns true after register and false after unregister", async () => {
    await registerMcpServer("github", { type: "stdio", command: "npx", args: [] });
    expect(await isMcpServerRegistered("github")).toBe(true);
    await unregisterMcpServer("github");
    expect(await isMcpServerRegistered("github")).toBe(false);
  });
});

describe("readMcpServer", () => {
  it("returns null for a missing entry", async () => {
    expect(await readMcpServer("nope")).toBeNull();
  });

  it("returns the stored definition", async () => {
    await registerMcpServer("notion", {
      type: "stdio",
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server"],
      env: { NOTION_API_KEY: "secret" },
    });
    const def = await readMcpServer("notion");
    expect(def).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server"],
      env: { NOTION_API_KEY: "secret" },
    });
  });
});

describe("corrupt claude.json handling", () => {
  it("treats unreadable JSON as empty and overwrites on next write", async () => {
    writeFileSync(claudeJson, "{not valid json");
    await registerMcpServer("github", { type: "stdio", command: "npx", args: [] });
    const data = readClaudeJson();
    expect(data.mcpServers).toBeDefined();
    const servers = data.mcpServers as Record<string, unknown>;
    expect(servers.github).toBeDefined();
  });
});
