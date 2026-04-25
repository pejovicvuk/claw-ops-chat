import { describe, it, expect } from "vitest";
import { isEditableKind, pickRenderer } from "./pick-renderer";

describe("pickRenderer", () => {
  it("classifies markdown by extension", () => {
    expect(pickRenderer("/r/README.md").kind).toBe("markdown");
    expect(pickRenderer("/r/notes.MDX").kind).toBe("markdown");
    expect(pickRenderer("/r/x.markdown").kind).toBe("markdown");
  });

  it("classifies code by extension and emits a language hint", () => {
    expect(pickRenderer("/r/foo.ts")).toEqual({ kind: "code", language: "typescript" });
    expect(pickRenderer("/r/foo.tsx")).toEqual({ kind: "code", language: "tsx" });
    expect(pickRenderer("/r/foo.py")).toEqual({ kind: "code", language: "python" });
    expect(pickRenderer("/r/foo.sh")).toEqual({ kind: "code", language: "bash" });
    expect(pickRenderer("/r/foo.YML")).toEqual({ kind: "code", language: "yaml" });
  });

  it("classifies plain text and friends", () => {
    expect(pickRenderer("/r/notes.txt").kind).toBe("text");
    expect(pickRenderer("/r/run.log").kind).toBe("text");
    expect(pickRenderer("/r/data.csv").kind).toBe("text");
    expect(pickRenderer("/r/.env").kind).toBe("text");
    expect(pickRenderer("/r/.gitignore").kind).toBe("text");
  });

  it("classifies media via mime", () => {
    expect(pickRenderer("/r/photo.png").kind).toBe("image");
    expect(pickRenderer("/r/photo.JPG").kind).toBe("image");
    expect(pickRenderer("/r/doc.pdf").kind).toBe("pdf");
    expect(pickRenderer("/r/clip.mp4").kind).toBe("video");
    expect(pickRenderer("/r/tone.mp3").kind).toBe("audio");
  });

  it("falls back to binary for unknown extensions", () => {
    expect(pickRenderer("/r/blob.xyz").kind).toBe("binary");
    expect(pickRenderer("/r/no-ext").kind).toBe("binary");
  });

  it("never throws on weird input", () => {
    expect(() => pickRenderer("")).not.toThrow();
    expect(() => pickRenderer("/")).not.toThrow();
    expect(() => pickRenderer(".")).not.toThrow();
  });
});

describe("isEditableKind", () => {
  it("considers markdown / text / code editable", () => {
    expect(isEditableKind("markdown")).toBe(true);
    expect(isEditableKind("text")).toBe(true);
    expect(isEditableKind("code")).toBe(true);
  });

  it("considers media + binary not editable", () => {
    expect(isEditableKind("image")).toBe(false);
    expect(isEditableKind("pdf")).toBe(false);
    expect(isEditableKind("video")).toBe(false);
    expect(isEditableKind("audio")).toBe(false);
    expect(isEditableKind("binary")).toBe(false);
  });
});
