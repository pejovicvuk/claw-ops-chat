import { describe, expect, it } from "vitest";
import { isInside } from "./path-scope";

describe("isInside", () => {
  it("returns true for an exact match", () => {
    expect(isInside("/a/b", "/a/b")).toBe(true);
  });

  it("returns true for a strict descendant", () => {
    expect(isInside("/a/b", "/a/b/c")).toBe(true);
    expect(isInside("/a/b", "/a/b/c/d/e")).toBe(true);
  });

  it("returns false for a sibling whose name only shares a prefix", () => {
    expect(isInside("/a/b", "/a/bc")).toBe(false);
    expect(isInside("/root/projects/foo", "/root/projects/foo-bar")).toBe(false);
  });

  it("returns false for a parent path", () => {
    expect(isInside("/a/b", "/a")).toBe(false);
    expect(isInside("/a/b", "/")).toBe(false);
  });

  it("returns true when no root is supplied (free roaming)", () => {
    expect(isInside(null, "/x")).toBe(true);
    expect(isInside(undefined, "/x")).toBe(true);
    expect(isInside("", "/x")).toBe(true);
  });

  it("normalizes a trailing slash on the root", () => {
    expect(isInside("/a/b/", "/a/b/c")).toBe(true);
    expect(isInside("/a/b/", "/a/b")).toBe(true);
    expect(isInside("/a/b/", "/a/bc")).toBe(false);
  });

  it("rejects empty / non-string paths", () => {
    expect(isInside("/a/b", "")).toBe(false);
  });

  it("treats the root '/' as accepting everything beneath it", () => {
    expect(isInside("/", "/anything")).toBe(true);
    expect(isInside("/", "/")).toBe(true);
  });
});
