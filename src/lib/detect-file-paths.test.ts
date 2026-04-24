import { describe, it, expect } from "vitest";
import { detectFilePaths, isLikelyLocalPath, isLonePathLine } from "./detect-file-paths";

describe("detectFilePaths", () => {
  it("returns the whole text as one text segment when no path present", () => {
    const out = detectFilePaths("Just some words without paths.");
    expect(out).toEqual([{ kind: "text", text: "Just some words without paths." }]);
  });

  it("extracts absolute and tilde-anchored paths", () => {
    const out = detectFilePaths("see /root/reports/foo.md and ~/uploads/pic.png today");
    expect(out).toEqual([
      { kind: "text", text: "see " },
      { kind: "path", path: "/root/reports/foo.md" },
      { kind: "text", text: " and " },
      { kind: "path", path: "~/uploads/pic.png" },
      { kind: "text", text: " today" },
    ]);
  });

  it("strips trailing punctuation from the match", () => {
    const out = detectFilePaths("open /root/notes.md.");
    expect(out[1]).toEqual({ kind: "path", path: "/root/notes.md" });
  });

  it("skips bare word-dot-word that lacks a path anchor (e.g. 'next.js')", () => {
    const out = detectFilePaths("Running on next.js and tailwind.css only.");
    expect(out.every((s) => s.kind === "text")).toBe(true);
  });

  it("keeps ./relative paths", () => {
    const out = detectFilePaths("check ./src/app.tsx now");
    expect(out.find((s) => s.kind === "path")).toEqual({
      kind: "path",
      path: "./src/app.tsx",
    });
  });

  it("handles multiple paths on one line", () => {
    const out = detectFilePaths("diff /a/b.ts vs /c/d.ts");
    const paths = out.filter((s) => s.kind === "path").map((s) => (s as { path: string }).path);
    expect(paths).toEqual(["/a/b.ts", "/c/d.ts"]);
  });
});

describe("detectFilePaths (extended extensions)", () => {
  it("detects office, archive, and media formats", () => {
    const out = detectFilePaths(
      "see /root/a.pptx and /root/b.docx also /root/c.mp4 /root/d.mp3 /root/e.zip",
    );
    const paths = out.filter((s) => s.kind === "path").map((s) => (s as { path: string }).path);
    expect(paths).toEqual([
      "/root/a.pptx",
      "/root/b.docx",
      "/root/c.mp4",
      "/root/d.mp3",
      "/root/e.zip",
    ]);
  });
});

describe("isLonePathLine", () => {
  it("returns the path for a bare path line with whitespace padding", () => {
    expect(isLonePathLine("  /root/foo.pptx  ")).toBe("/root/foo.pptx");
  });

  it("strips bullet markers", () => {
    expect(isLonePathLine("- /root/foo.pptx")).toBe("/root/foo.pptx");
    expect(isLonePathLine("* /root/foo.pptx")).toBe("/root/foo.pptx");
    expect(isLonePathLine("• /root/foo.pptx")).toBe("/root/foo.pptx");
    expect(isLonePathLine("  - /root/foo.pptx")).toBe("/root/foo.pptx");
  });

  it("accepts trailing punctuation", () => {
    expect(isLonePathLine("/root/foo.pptx.")).toBe("/root/foo.pptx");
    expect(isLonePathLine("/root/foo.pptx,")).toBe("/root/foo.pptx");
  });

  it("accepts tilde-prefixed paths", () => {
    expect(isLonePathLine("~/uploads/pic.png")).toBe("~/uploads/pic.png");
  });

  it("rejects lines that are not just a path", () => {
    expect(isLonePathLine("see /root/foo.pptx for details")).toBe(null);
    expect(isLonePathLine("and /root/a.pptx /root/b.docx")).toBe(null);
    expect(isLonePathLine("not a path")).toBe(null);
    expect(isLonePathLine("")).toBe(null);
    expect(isLonePathLine("   ")).toBe(null);
  });

  it("rejects bare filename without path anchor", () => {
    expect(isLonePathLine("next.js")).toBe(null);
    expect(isLonePathLine("README.md")).toBe(null);
  });
});

describe("isLikelyLocalPath", () => {
  it("flags tilde, slash, ./ paths as local", () => {
    expect(isLikelyLocalPath("~/foo.png")).toBe(true);
    expect(isLikelyLocalPath("/root/foo.png")).toBe(true);
    expect(isLikelyLocalPath("./foo.png")).toBe(true);
    expect(isLikelyLocalPath("../foo.png")).toBe(true);
    expect(isLikelyLocalPath("C:\\Users\\x\\foo.png")).toBe(true);
  });

  it("rejects http/blob/data URIs", () => {
    expect(isLikelyLocalPath("https://example.com/foo.png")).toBe(false);
    expect(isLikelyLocalPath("blob:abc")).toBe(false);
    expect(isLikelyLocalPath("data:image/png;base64,xxx")).toBe(false);
  });

  it("handles empty input", () => {
    expect(isLikelyLocalPath("")).toBe(false);
  });
});
