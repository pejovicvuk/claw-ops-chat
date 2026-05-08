/**
 * Decide whether the SDK's turn-end `result` event should produce a system
 * "stopped" pill, or be suppressed because it duplicates the assistant text
 * we already streamed.
 *
 * Background: the Claude Agent SDK emits a `result` message at the end of
 * every turn whose `result` (mapped to `evt.text` on the wire) is the FULL
 * assistant turn output for normal completions. The original handler in
 * `use-claude-chat.ts` always appended that text as a `type: "stopped"`
 * system message ("e.g. 'Stopped by user'"), causing the live chat to
 * render the assistant's reply twice — once formatted via the streamed
 * `text_delta` events, once as a flat gray pill from the result event.
 * The duplicate vanishes on refresh because it lives only in client state.
 *
 * The fix: surface the pill only when the result text is meaningfully
 * different from the just-streamed content (e.g. an explicit
 * "Stopped by user" interrupt fired by the server, or a session-end
 * marker the SDK emits when no streamed turn preceded it). Equality is
 * checked after collapsing all runs of whitespace to a single space, so
 * cosmetic differences between the SDK's joined `result` and the raw
 * concatenation of `text_delta` chunks (e.g. an extra newline between
 * content blocks, or paragraph breaks the SDK normalizes) don't defeat
 * the dedup. Two strings are considered "the same content" iff their
 * non-whitespace tokens are identical in order — which is exactly the
 * property a user perceives when they say "the pill is showing the same
 * message twice".
 */
function normalizeForCompare(s: string): string {
  // Collapse every run of ASCII / Unicode whitespace (spaces, tabs,
  // newlines, NBSP, etc.) to a single space, then trim. Markdown structure
  // is whitespace-sensitive at render time but not at identity time —
  // "Hello\n\nworld" and "Hello world" carry the same words.
  return s.replace(/\s+/g, " ").trim();
}

export function shouldShowStoppedPill(
  resultText: string | null | undefined,
  streamedAssistantContent: string | null | undefined,
): boolean {
  if (!resultText) return false;
  const result = normalizeForCompare(resultText);
  if (result.length === 0) return false;

  const streamed = normalizeForCompare(streamedAssistantContent ?? "");
  if (streamed.length === 0) {
    // No streamed content at all (e.g. tool-only turn, or interrupt before
    // the first text_delta). A pill with the result text is the right UX.
    return true;
  }

  // Suppress: the SDK is echoing back the full assistant turn we already
  // rendered as a regular bubble. Appending it again would duplicate.
  return result !== streamed;
}
