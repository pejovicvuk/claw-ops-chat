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

  it("keeps ./relative paths as anchored paths", () => {
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

describe("detectFilePaths (candidates)", () => {
  it("emits a candidate for a bare basename", () => {
    const out = detectFilePaths("see report.pdf today");
    expect(out).toEqual([
      { kind: "text", text: "see " },
      { kind: "candidate", candidate: "report.pdf" },
      { kind: "text", text: " today" },
    ]);
  });

  it("emits a candidate for a relative-with-slash path", () => {
    const out = detectFilePaths("see notes/draft.md please");
    expect(out).toEqual([
      { kind: "text", text: "see " },
      { kind: "candidate", candidate: "notes/draft.md" },
      { kind: "text", text: " please" },
    ]);
  });

  it("treats anchored vs bare as different kinds in one message", () => {
    const out = detectFilePaths("compare /root/a.md with b.md and ./c.md");
    const kinds = out
      .filter((s) => s.kind !== "text")
      .map((s) => `${s.kind}:${"path" in s ? s.path : "candidate" in s ? s.candidate : ""}`);
    expect(kinds).toEqual(["path:/root/a.md", "candidate:b.md", "path:./c.md"]);
  });

  it("rejects prose that resembles a known framework name (denylist)", () => {
    const out = detectFilePaths("the next.js framework with vue.js plugins");
    expect(out.every((s) => s.kind === "text")).toBe(true);
  });

  it("does not match a token glued onto surrounding letters", () => {
    // Strict leading boundary: `abcreport.pdf` has no whitespace before — no match.
    const out = detectFilePaths("xyzreport.pdf rest");
    // Whole token `xyzreport.pdf` IS still a valid candidate (start of string).
    // The guard is against splitting *inside* a longer alphabetic run, e.g.
    // `frobreport.pdf` should NOT pull out `report.pdf` as a sub-candidate.
    expect(out).toEqual([
      { kind: "candidate", candidate: "xyzreport.pdf" },
      { kind: "text", text: " rest" },
    ]);
  });

  it("matches a bare candidate after open punctuation", () => {
    const out = detectFilePaths("(see report.pdf)");
    const candidates = out
      .filter((s) => s.kind === "candidate")
      .map((s) => (s as { candidate: string }).candidate);
    expect(candidates).toEqual(["report.pdf"]);
  });

  it("skips tokens whose tail isn't in the extension list", () => {
    // Version strings — `1.2.3` has no recognised extension.
    const out = detectFilePaths("version 1.2.3 release");
    expect(out.every((s) => s.kind === "text")).toBe(true);
    // Random.unknownext also doesn't match.
    const out2 = detectFilePaths("see thing.unknownext now");
    expect(out2.every((s) => s.kind === "text")).toBe(true);
  });
});

describe("isLonePathLine", () => {
  it("returns a path entry for a bare anchored path with whitespace padding", () => {
    expect(isLonePathLine("  /root/foo.pptx  ")).toEqual({
      kind: "path",
      value: "/root/foo.pptx",
    });
  });

  it("strips bullet markers", () => {
    expect(isLonePathLine("- /root/foo.pptx")).toEqual({
      kind: "path",
      value: "/root/foo.pptx",
    });
    expect(isLonePathLine("* /root/foo.pptx")).toEqual({
      kind: "path",
      value: "/root/foo.pptx",
    });
    expect(isLonePathLine("• /root/foo.pptx")).toEqual({
      kind: "path",
      value: "/root/foo.pptx",
    });
    expect(isLonePathLine("  - /root/foo.pptx")).toEqual({
      kind: "path",
      value: "/root/foo.pptx",
    });
  });

  it("accepts trailing punctuation", () => {
    expect(isLonePathLine("/root/foo.pptx.")).toEqual({
      kind: "path",
      value: "/root/foo.pptx",
    });
    expect(isLonePathLine("/root/foo.pptx,")).toEqual({
      kind: "path",
      value: "/root/foo.pptx",
    });
  });

  it("accepts tilde-prefixed paths", () => {
    expect(isLonePathLine("~/uploads/pic.png")).toEqual({
      kind: "path",
      value: "~/uploads/pic.png",
    });
  });

  it("rejects lines that are not just a path", () => {
    expect(isLonePathLine("see /root/foo.pptx for details")).toBe(null);
    expect(isLonePathLine("and /root/a.pptx /root/b.docx")).toBe(null);
    expect(isLonePathLine("not a path")).toBe(null);
    expect(isLonePathLine("")).toBe(null);
    expect(isLonePathLine("   ")).toBe(null);
  });

  it("returns a candidate entry for a lone bare basename", () => {
    expect(isLonePathLine("report.pdf")).toEqual({ kind: "candidate", value: "report.pdf" });
    expect(isLonePathLine("- presentation.pptx")).toEqual({
      kind: "candidate",
      value: "presentation.pptx",
    });
  });

  it("returns a candidate entry for a lone relative path", () => {
    expect(isLonePathLine("notes/draft.md")).toEqual({
      kind: "candidate",
      value: "notes/draft.md",
    });
  });

  it("rejects denylisted prose tokens even when alone on a line", () => {
    expect(isLonePathLine("next.js")).toBe(null);
    expect(isLonePathLine("- node.js")).toBe(null);
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
