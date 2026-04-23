"use client";

import { useMemo } from "react";

/**
 * Detect the in-progress `@…` mention at the textarea's caret and parse
 * it into a directory + filter prefix for the file-autocomplete popover.
 *
 * Shape of the token we look for:
 *   `@<path>/<name-prefix>`
 *
 * Rules:
 * - The `@` must be either at position 0 or preceded by whitespace /
 *   newline. Otherwise it's part of a word (e.g. an email address) and
 *   we don't trigger.
 * - The token ends at the caret — we only care about what's to the
 *   left of where the user is typing.
 * - If the token contains any whitespace between `@` and the caret,
 *   it's not a live mention; returns `open: false`.
 * - We split on the LAST `/` to separate the directory part (to list)
 *   from the name-prefix (to filter). No `/` → directory is `~`,
 *   prefix is everything after `@`.
 */

export interface MentionState {
  /** True when the caret is sitting inside a live `@…` token. */
  open: boolean;
  /** Directory to list (e.g. "~", "~/src", "/root/project"). */
  dirPart: string;
  /** Filter prefix applied to entries in that directory. */
  prefixPart: string;
  /** Absolute character offsets of the `@` and the caret. */
  rangeStart: number;
  rangeEnd: number;
  /** True when the query has any `/` — toggles global vs scoped search. */
  hasSlash: boolean;
}

const CLOSED: MentionState = {
  open: false,
  dirPart: "",
  prefixPart: "",
  rangeStart: 0,
  rangeEnd: 0,
  hasSlash: false,
};

/**
 * Normalize what the user typed into a listable path.
 * - `""`    → `"~"`    (they just typed `@`)
 * - `src`   → `"~/src"` (no leading `/` and no `~`)
 * - `~`     → `"~"`
 * - `~/src` → `"~/src"`
 * - `/abs`  → `"/abs"` (absolute path is passed as-is; server `safePath`
 *                        decides whether it's allowed)
 */
function normalizeDir(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "~";
  if (trimmed === "~") return "~";
  if (trimmed.startsWith("~/") || trimmed.startsWith("/")) return trimmed;
  return `~/${trimmed}`;
}

function computeState(value: string, caret: number): MentionState {
  if (caret <= 0) return CLOSED;
  // Walk backwards from caret looking for `@`. Bail on whitespace / newline
  // — those cut off the live token.
  let at = -1;
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === "@") {
      at = i;
      break;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") return CLOSED;
  }
  if (at === -1) return CLOSED;
  // `@` must be at start or after whitespace. Otherwise it's mid-word
  // (email address, python decorator, etc.) — don't trigger.
  if (at > 0) {
    const before = value[at - 1];
    if (before !== " " && before !== "\t" && before !== "\n" && before !== "\r") return CLOSED;
  }

  const query = value.slice(at + 1, caret);
  // A trailing space or newline inside the query would have been caught
  // above; the query is whitespace-free here.
  const lastSlash = query.lastIndexOf("/");
  let dirPart: string;
  let prefixPart: string;
  if (lastSlash === -1) {
    dirPart = "~";
    prefixPart = query;
  } else {
    dirPart = normalizeDir(query.slice(0, lastSlash));
    prefixPart = query.slice(lastSlash + 1);
  }
  return {
    open: true,
    dirPart,
    prefixPart,
    rangeStart: at,
    rangeEnd: caret,
    hasSlash: lastSlash !== -1,
  };
}

/**
 * Reactive mention state. Recomputes on every value/caret change via
 * `useMemo`. Callers are responsible for keeping `caret` in sync with the
 * textarea's `selectionStart` (via `onSelect` / `onKeyUp` / `onClick`).
 */
export function useMentions(value: string, caret: number): MentionState {
  return useMemo(() => computeState(value, caret), [value, caret]);
}
