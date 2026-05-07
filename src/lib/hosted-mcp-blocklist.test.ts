import { describe, it, expect } from "vitest";
import {
  getDisallowedHostedGoogleMcpTools,
  HOSTED_CLAUDEAI_GOOGLE_MCP_SERVERS,
} from "./hosted-mcp-blocklist";

describe("getDisallowedHostedGoogleMcpTools", () => {
  it("blocks the Gmail / Drive / Calendar hosted servers at the prefix level", () => {
    const blocked = getDisallowedHostedGoogleMcpTools();
    expect(blocked).toContain("mcp__claude_ai_Gmail");
    expect(blocked).toContain("mcp__claude_ai_Google_Drive");
    expect(blocked).toContain("mcp__claude_ai_Google_Calendar");
  });

  it("also lists the explicit auth-flow tool names for SDKs that match by exact name", () => {
    const blocked = getDisallowedHostedGoogleMcpTools();
    expect(blocked).toContain("mcp__claude_ai_Gmail__authenticate");
    expect(blocked).toContain("mcp__claude_ai_Gmail__complete_authentication");
    expect(blocked).toContain("mcp__claude_ai_Google_Drive__authenticate");
    expect(blocked).toContain("mcp__claude_ai_Google_Calendar__complete_authentication");
  });

  it("does not include the user's connected google-workspace-custom server", () => {
    const blocked = getDisallowedHostedGoogleMcpTools();
    expect(blocked.some((name) => name.includes("google-workspace-custom"))).toBe(false);
    expect(blocked.some((name) => name.includes("workspace_mcp"))).toBe(false);
  });

  it("returns 9 patterns: 3 servers × (1 prefix + 2 auth tools)", () => {
    const blocked = getDisallowedHostedGoogleMcpTools();
    expect(blocked).toHaveLength(9);
  });

  it("returns a fresh array each call so callers can mutate safely", () => {
    const a = getDisallowedHostedGoogleMcpTools();
    const b = getDisallowedHostedGoogleMcpTools();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("HOSTED_CLAUDEAI_GOOGLE_MCP_SERVERS", () => {
  it("exposes the three hosted Google MCP server names", () => {
    expect(HOSTED_CLAUDEAI_GOOGLE_MCP_SERVERS).toEqual([
      "claude_ai_Gmail",
      "claude_ai_Google_Calendar",
      "claude_ai_Google_Drive",
    ]);
  });
});
