import { describe, expect, it } from "vitest";
import { scrubCmdline } from "./scrub";

describe("scrubCmdline", () => {
  it("redacts --token= flag values", () => {
    const out = scrubCmdline("node app.js --token=abcdef123456 --port 3000");
    expect(out).toContain("--token=<redacted>");
    expect(out).toContain("--port 3000");
  });

  it("redacts --password value", () => {
    const out = scrubCmdline("psql --user admin --password secretvalue");
    expect(out).toContain("--password <redacted>");
    expect(out).not.toContain("secretvalue");
  });

  it("redacts ENV=value patterns", () => {
    const out = scrubCmdline("API_KEY=sk-something node server.js");
    expect(out).toContain("API_KEY=<redacted>");
    expect(out).not.toContain("sk-something");
  });

  it("passes through audit scrubber for Bearer", () => {
    const out = scrubCmdline('curl -H "Authorization: Bearer abc.def.ghi" http://localhost');
    expect(out).not.toContain("abc.def.ghi");
  });

  it("returns empty for null/undefined", () => {
    expect(scrubCmdline(null)).toBe("");
    expect(scrubCmdline(undefined)).toBe("");
  });

  it("preserves harmless cmdlines", () => {
    const out = scrubCmdline("nginx: master process /usr/sbin/nginx");
    expect(out).toContain("nginx");
  });
});
