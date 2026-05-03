import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetForTests, bump, snapshot } from "../webrtc-metrics";

beforeEach(() => {
  _resetForTests();
});
afterEach(() => {
  _resetForTests();
});

describe("webrtc-metrics", () => {
  it("starts at zero across all counters", () => {
    const s = snapshot();
    expect(s.paired).toBe(0);
    expect(s.pair_timeout).toBe(0);
    expect(s.capture_failed).toBe(0);
    expect(s.controller_spawn_failed).toBe(0);
    expect(s.rate_limited).toBe(0);
    expect(s.slot_taken).toBe(0);
    expect(s.fallback_to_mse).toBe(0);
    expect(s.ice_restart).toBe(0);
  });

  it("bump() increments the named counter only", () => {
    bump("paired");
    bump("paired");
    bump("rate_limited");
    const s = snapshot();
    expect(s.paired).toBe(2);
    expect(s.rate_limited).toBe(1);
    expect(s.pair_timeout).toBe(0);
  });

  it("snapshot() returns a defensive copy — mutations don't leak back", () => {
    bump("paired");
    const s = snapshot();
    s.paired = 999;
    expect(snapshot().paired).toBe(1);
  });
});
