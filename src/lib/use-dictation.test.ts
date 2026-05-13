import { describe, it, expect } from "vitest";
import { reconcileChunk } from "./use-dictation";

describe("reconcileChunk", () => {
  it("returns incoming when current is empty", () => {
    expect(reconcileChunk("", "Danas")).toBe("Danas");
  });

  it("returns current when incoming is empty", () => {
    expect(reconcileChunk("Danas", "")).toBe("Danas");
  });

  it("returns current when chunks are identical", () => {
    expect(reconcileChunk("Danas", "Danas")).toBe("Danas");
  });

  it("replaces with incoming when incoming is a cumulative superset", () => {
    expect(reconcileChunk("Danas", "Danas sam")).toBe("Danas sam");
    expect(reconcileChunk("Danas sam", "Danas sam bio")).toBe("Danas sam bio");
  });

  it("keeps current when incoming is a stale substring (re-fire)", () => {
    expect(reconcileChunk("Danas sam bio", "Danas")).toBe("Danas sam bio");
    expect(reconcileChunk("Danas sam bio", "Danas sam")).toBe("Danas sam bio");
  });

  it("treats prefix relationship case-insensitively", () => {
    expect(reconcileChunk("danas", "Danas")).toBe("Danas");
    expect(reconcileChunk("Danas", "DANAS sam")).toBe("DANAS sam");
    // Case-insensitively identical — incoming wins so the recognizer's
    // latest casing pass takes effect.
    expect(reconcileChunk("Danas Sam", "DANAS sam")).toBe("DANAS sam");
  });

  it("appends with a single space when neither chunk is a prefix of the other", () => {
    expect(reconcileChunk("Hello", "world")).toBe("Hello world");
    expect(reconcileChunk("Zdravo", "kako si")).toBe("Zdravo kako si");
  });

  it("does not double-space when one side already carries a space", () => {
    expect(reconcileChunk("Hello", " world")).toBe("Hello world");
    expect(reconcileChunk("Hello ", "world")).toBe("Hello world");
    expect(reconcileChunk("Hello ", " world")).toBe("Hello  world");
    // ^ both bring a space — accept the double; recognizer outputs are
    //   normalized downstream when needed.
  });

  it("handles the full Android-replay sequence without duplication", () => {
    // Real-world sequence from Android Chrome:
    //   "danas" → "danas" → "Danas" → "Danas" → "Danas" → "Danas sam"
    //   → "Danas sam bio" (× many) → "Danas sam bio u"
    //   → "Danas sam bio u prodavnici" (× a few)
    let acc = "";
    for (const chunk of [
      "danas",
      "danas",
      "Danas",
      "Danas",
      "Danas",
      "Danas sam",
      "Danas sam bio",
      "Danas sam bio",
      "Danas sam bio",
      "Danas sam bio",
      "Danas sam bio u",
      "Danas sam bio u prodavnici",
      "Danas sam bio u prodavnici",
    ]) {
      acc = reconcileChunk(acc, chunk);
    }
    expect(acc).toBe("Danas sam bio u prodavnici");
  });
});
