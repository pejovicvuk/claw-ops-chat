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

  it("matches when streamed content was built up across many small deltas", () => {
    // Simulates `streamedTurnTextRef.current` being mutated by every
    // text_delta. Final concatenation should equal `result.text`.
    const deltas = ["Hello", " — ", "this ", "is the ", "**streamed** ", "reply."];
    const accumulated = deltas.reduce((acc, d) => acc + d, "");
    expect(shouldShowStoppedPill(accumulated, accumulated)).toBe(false);
  });

  it("ignores internal whitespace differences (the leak that motivated this fix)", () => {
    // The SDK's `msg.result` may join multiple text content blocks with a
    // newline that the raw `text_delta` stream didn't emit, or normalize
    // paragraph breaks differently. As long as the non-whitespace
    // characters are identical in order, treat them as the same content
    // and suppress the duplicate pill.
    const streamed = "Here is the answer.\n\nLet me know if you want more.";
    const resultWithExtraNewline = "Here is the answer.\n\n\nLet me know if you want more.\n";
    expect(shouldShowStoppedPill(resultWithExtraNewline, streamed)).toBe(false);

    const streamedTabs = "Line one.\tLine two.";
    const resultSpaces = "Line one. Line two.";
    expect(shouldShowStoppedPill(resultSpaces, streamedTabs)).toBe(false);

    // Multi-block turn: SDK joins blocks with "\n\n" while the
    // `text_delta` stream concatenates raw with no inter-block separator.
    // Block boundaries are NOT broadcast to the client (server.ts only
    // forwards `content_block_delta` text events, not `content_block_start`
    // for text), so the stream legitimately has no whitespace where the
    // result has `\n\n`. Users perceive these as the same content; we
    // suppress the duplicate pill.
    const streamedRaw = "First block.Second block.";
    const resultJoined = "First block.\n\nSecond block.";
    expect(shouldShowStoppedPill(resultJoined, streamedRaw)).toBe(false);
  });

  it("suppresses the pill for a realistic multi-block markdown turn (regression)", () => {
    // Reproduces the exact symptom the user reported: a long markdown
    // response where the SDK split into multiple text content blocks. The
    // streamed concatenation has bold-asterisks running directly into a
    // heading hash because `text_delta` carried no inter-block separator;
    // the SDK's `result` text inserted `\n\n` between blocks. Token-level
    // dedup saw `**###` vs `** ###` as different and surfaced the pill;
    // whitespace-stripping dedup correctly recognises the duplicate.
    const streamed =
      "PR opened: **https://github.com/example/repo/pull/1**" +
      "### What's in it" +
      "Two fixes, one commit.";
    const result =
      "PR opened: **https://github.com/example/repo/pull/1**\n\n" +
      "### What's in it\n\n" +
      "Two fixes, one commit.";
    expect(shouldShowStoppedPill(result, streamed)).toBe(false);
  });

  it("still surfaces an explicit interrupt that shares no tokens with the stream", () => {
    const streamed = "I'll go ahead and refactor that for you.";
    expect(shouldShowStoppedPill("Stopped by user", streamed)).toBe(true);
  });
});
