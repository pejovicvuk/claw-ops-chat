import { describe, expect, it } from "vitest";

import { shouldShowStoppedPill } from "./chat-result-dedupe";

describe("shouldShowStoppedPill", () => {
  it("suppresses when result text is empty / nullish", () => {
    expect(shouldShowStoppedPill("", "anything")).toBe(false);
    expect(shouldShowStoppedPill(null, "anything")).toBe(false);
    expect(shouldShowStoppedPill(undefined, "anything")).toBe(false);
    expect(shouldShowStoppedPill("   ", "anything")).toBe(false);
  });

  it("suppresses when result text equals just-streamed assistant content (the duplicate-message bug)", () => {
    const streamed = "Here's your latest email:\n\n**Subject:** ...\n\nWant me to open the thread?";
    expect(shouldShowStoppedPill(streamed, streamed)).toBe(false);
  });

  it("ignores trailing whitespace differences when comparing", () => {
    const streamed = "Reply body";
    expect(shouldShowStoppedPill(streamed + "\n", streamed)).toBe(false);
    expect(shouldShowStoppedPill(streamed, streamed + "  \n\n")).toBe(false);
  });

  it("shows the pill when no streamed content preceded the result (e.g. tool-only turn)", () => {
    expect(shouldShowStoppedPill("Stopped by user", "")).toBe(true);
    expect(shouldShowStoppedPill("Stopped by user", null)).toBe(true);
    expect(shouldShowStoppedPill("Stopped by user", undefined)).toBe(true);
  });

  it("shows the pill when the result text is genuinely different (e.g. explicit interrupt)", () => {
    const streamed = "I'll go ahead and refactor that for you.";
    expect(shouldShowStoppedPill("Stopped by user", streamed)).toBe(true);
  });

  it("shows the pill when the result is a session-end marker even with similar streamed content", () => {
    // Defensive: even if a marker happens to be a substring of the streamed
    // output, it's still meaningfully different and should surface.
    const streamed = "Long assistant reply that ends mentioning a stop somewhere.";
    expect(shouldShowStoppedPill("Stopped by user", streamed)).toBe(true);
  });
});
