import { afterEach, describe, expect, it } from "vitest";
import {
  clearSessionStatus,
  getAllSessionStatuses,
  getSessionStatus,
  setSessionStatus,
} from "./session-status-store";

function clearAll(): void {
  for (const id of Object.keys(getAllSessionStatuses())) {
    clearSessionStatus(id);
  }
}

afterEach(() => {
  clearAll();
});

describe("setSessionStatus / getSessionStatus", () => {
  it("round-trips the latest status", () => {
    setSessionStatus("abc", "thinking");
    const entry = getSessionStatus("abc");
    expect(entry?.status).toBe("thinking");
    expect(entry?.lastActivityAt).toBeTypeOf("number");
  });

  it("overwrites on subsequent writes", () => {
    setSessionStatus("abc", "thinking");
    setSessionStatus("abc", "awaiting_permission");
    expect(getSessionStatus("abc")?.status).toBe("awaiting_permission");
  });

  it("returns undefined for unknown ids", () => {
    expect(getSessionStatus("never-set")).toBeUndefined();
  });
});

describe("clearSessionStatus", () => {
  it("removes the entry", () => {
    setSessionStatus("abc", "thinking");
    clearSessionStatus("abc");
    expect(getSessionStatus("abc")).toBeUndefined();
  });
});

describe("getAllSessionStatuses", () => {
  it("returns a snapshot keyed by session id", () => {
    setSessionStatus("a", "idle");
    setSessionStatus("b", "tool_running");
    const snap = getAllSessionStatuses();
    expect(Object.keys(snap).sort()).toEqual(["a", "b"]);
    expect(snap.a.status).toBe("idle");
    expect(snap.b.status).toBe("tool_running");
  });
});

describe("globalThis singleton", () => {
  it("anchors the backing Map on globalThis so duplicate module loads share state", () => {
    // Regression guard: before this fix, server.ts (tsc-compiled) and the
    // Next.js App Router route (webpack-bundled) each got their own
    // module instance with their own Map — so every status write
    // disappeared before the sidebar poll could see it. Pinning the Map
    // on globalThis makes the second load discover the same instance.
    setSessionStatus("anchor-check", "tool_running");
    const anchored = (globalThis as unknown as {
      __clawSessionStatusStore?: Map<string, { status: string }>;
    }).__clawSessionStatusStore;
    expect(anchored).toBeDefined();
    expect(anchored!.get("anchor-check")?.status).toBe("tool_running");

    // Simulate a second module evaluation by reading through the anchor
    // directly and confirming the snapshot reflects the write.
    expect(getAllSessionStatuses()["anchor-check"].status).toBe("tool_running");
  });
});
