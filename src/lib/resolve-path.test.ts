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

  it("returns null when basename is ambiguous and no sessionCwd", () => {
    expect(resolveCandidate("report.pdf", maps)).toBeNull();
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

  it("resolves a relative-with-slash candidate by suffix when unique", () => {
    expect(resolveCandidate("notes/draft.md", maps)).toBeNull(); // ambiguous (two paths end with notes/draft.md)
    expect(resolveCandidate("foo/notes/draft.md", maps)).toBe("/root/projects/foo/notes/draft.md");
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
});
