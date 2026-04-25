import { describe, it, expect } from "vitest";
import { buildResolverMaps, resolveCandidate } from "./resolve-path";
import type { WorkspaceIndexEntry } from "./use-workspace-index";

function file(path: string): WorkspaceIndexEntry {
  const name = path.split("/").pop() ?? path;
  return { name, path, directory: false };
}
function dir(path: string): WorkspaceIndexEntry {
  const name = path.split("/").pop() ?? path;
  return { name, path, directory: true };
}

describe("buildResolverMaps", () => {
  it("indexes files by lowercase basename", () => {
    const maps = buildResolverMaps([file("/root/Report.PDF"), file("/root/sub/report.pdf")]);
    const bucket = maps.byBasename.get("report.pdf");
    expect(bucket?.map((e) => e.path)).toEqual(["/root/Report.PDF", "/root/sub/report.pdf"]);
  });

  it("ignores directory entries", () => {
    const maps = buildResolverMaps([dir("/root/notes"), file("/root/notes.md")]);
    expect(maps.byBasename.get("notes")).toBeUndefined();
    expect(maps.byBasename.get("notes.md")?.map((e) => e.path)).toEqual(["/root/notes.md"]);
  });
});

describe("resolveCandidate", () => {
  const entries = [
    file("/root/report.pdf"),
    file("/root/archive/report.pdf"),
    file("/root/projects/foo/notes/draft.md"),
    file("/root/notes/draft.md"),
    file("/root/unique.pptx"),
  ];
  const maps = buildResolverMaps(entries);

  it("returns null when no entry matches the basename", () => {
    expect(resolveCandidate("missing.pdf", maps)).toBeNull();
  });

  it("returns the unique match for an unambiguous basename", () => {
    expect(resolveCandidate("unique.pptx", maps)).toBe("/root/unique.pptx");
  });

  it("prefers the sessionCwd-relative match over other entries", () => {
    expect(resolveCandidate("report.pdf", maps, { sessionCwd: "/root/archive" })).toBe(
      "/root/archive/report.pdf",
    );
  });

  it("falls back to single global match when sessionCwd doesn't contain it", () => {
    expect(resolveCandidate("unique.pptx", maps, { sessionCwd: "/root/elsewhere" })).toBe(
      "/root/unique.pptx",
    );
  });

  it("handles trailing slash in sessionCwd", () => {
    expect(resolveCandidate("report.pdf", maps, { sessionCwd: "/root/archive/" })).toBe(
      "/root/archive/report.pdf",
    );
  });

  it("uses sessionCwd to disambiguate a relative candidate", () => {
    expect(resolveCandidate("notes/draft.md", maps, { sessionCwd: "/root" })).toBe(
      "/root/notes/draft.md",
    );
    expect(resolveCandidate("notes/draft.md", maps, { sessionCwd: "/root/projects/foo" })).toBe(
      "/root/projects/foo/notes/draft.md",
    );
  });

  it("returns null for empty candidate", () => {
    expect(resolveCandidate("", maps)).toBeNull();
  });

  it("returns null when no qualifying suffix match exists", () => {
    expect(resolveCandidate("missing/draft.md", maps)).toBeNull();
  });
});

describe("resolveCandidate (best-pick on ambiguity)", () => {
  it("picks the shortest-path tiebreaker when the chat has no context", () => {
    const maps = buildResolverMaps([
      file("/root/report.pdf"),
      file("/root/archive/report.pdf"),
      file("/root/projects/foo/report.pdf"),
    ]);
    // Top-level wins on length tiebreaker.
    expect(resolveCandidate("report.pdf", maps)).toBe("/root/report.pdf");
  });

  it("uses referencedPaths to prefer directory-affine matches", () => {
    const maps = buildResolverMaps([
      file("/root/projects/foo/helper.tsx"),
      file("/root/archive/helper.tsx"),
    ]);
    expect(
      resolveCandidate("helper.tsx", maps, {
        referencedPaths: ["/root/projects/foo/main.tsx"],
      }),
    ).toBe("/root/projects/foo/helper.tsx");
  });

  it("scores against the deepest shared prefix across multiple referenced paths", () => {
    const maps = buildResolverMaps([
      file("/root/projects/foo/bar/util.ts"),
      file("/root/archive/util.ts"),
    ]);
    // First reference shares 4 dir segments with the foo/bar match;
    // second reference shares 0 with either. Max wins → foo/bar/util.ts.
    expect(
      resolveCandidate("util.ts", maps, {
        referencedPaths: ["/root/projects/foo/bar/main.ts", "/root/archive/unrelated.md"],
      }),
    ).toBe("/root/projects/foo/bar/util.ts");
  });

  it("penalises node_modules / .git matches when the chat lacks context", () => {
    const maps = buildResolverMaps([
      file("/root/node_modules/some-lib/index.ts"),
      file("/root/projects/myapp/index.ts"),
    ]);
    expect(resolveCandidate("index.ts", maps)).toBe("/root/projects/myapp/index.ts");
  });

  it("alphabetical tiebreaker when length and score are equal", () => {
    const maps = buildResolverMaps([file("/a/foo.ts"), file("/b/foo.ts")]);
    // Same length, same score — alphabetical wins deterministically.
    expect(resolveCandidate("foo.ts", maps)).toBe("/a/foo.ts");
  });

  it("sessionCwd hit beats any referencedPaths affinity score", () => {
    const maps = buildResolverMaps([
      file("/root/archive/report.pdf"),
      file("/root/projects/foo/report.pdf"),
    ]);
    // referencedPaths point to /root/projects/foo/, but sessionCwd
    // overrides because the cwd-exact target exists in the index.
    expect(
      resolveCandidate("report.pdf", maps, {
        sessionCwd: "/root/archive",
        referencedPaths: ["/root/projects/foo/main.tsx"],
      }),
    ).toBe("/root/archive/report.pdf");
  });

  it("disambiguates relative candidates by referencedPaths after suffix narrowing", () => {
    const maps = buildResolverMaps([
      file("/root/projects/foo/notes/draft.md"),
      file("/root/notes/draft.md"),
    ]);
    expect(
      resolveCandidate("notes/draft.md", maps, {
        referencedPaths: ["/root/projects/foo/main.tsx"],
      }),
    ).toBe("/root/projects/foo/notes/draft.md");
  });
});
