import { afterEach, describe, it, expect } from "vitest";
import { clearDiagnostics, recentSends, recordSend, type DiagnosticsEntry } from "./diagnostics";

function entry(over: Partial<DiagnosticsEntry> = {}): DiagnosticsEntry {
  return {
    ts: Date.now(),
    email: "user@example.com",
    device: "Chrome on macOS",
    kind: "permissionRequest",
    outcome: "sent",
    ...over,
  };
}

afterEach(() => {
  clearDiagnostics();
});

describe("push diagnostics ring buffer", () => {
  it("returns recently recorded sends newest-first", () => {
    recordSend(entry({ kind: "turnComplete", ts: 1 }));
    recordSend(entry({ kind: "permissionRequest", ts: 2 }));
    recordSend(entry({ kind: "error", ts: 3 }));

    const out = recentSends();
    expect(out.map((e) => e.kind)).toEqual(["error", "permissionRequest", "turnComplete"]);
  });

  it("filters by user email so a multi-user deployment doesn't leak", () => {
    recordSend(entry({ email: "alice@example.com", kind: "turnComplete" }));
    recordSend(entry({ email: "bob@example.com", kind: "permissionRequest" }));
    recordSend(entry({ email: "alice@example.com", kind: "error" }));

    const aliceOnly = recentSends("alice@example.com");
    expect(aliceOnly.map((e) => e.email)).toEqual(["alice@example.com", "alice@example.com"]);
  });

  it("caps at 50 entries (oldest dropped first)", () => {
    for (let i = 0; i < 60; i++) {
      recordSend(entry({ ts: i }));
    }
    const out = recentSends(undefined, 60);
    // 50 retained, newest first → ts should run from 59 down to 10
    expect(out).toHaveLength(50);
    expect(out[0].ts).toBe(59);
    expect(out[out.length - 1].ts).toBe(10);
  });

  it("respects the per-call limit", () => {
    for (let i = 0; i < 10; i++) {
      recordSend(entry({ ts: i }));
    }
    const out = recentSends(undefined, 3);
    expect(out).toHaveLength(3);
    expect(out[0].ts).toBe(9);
  });
});
