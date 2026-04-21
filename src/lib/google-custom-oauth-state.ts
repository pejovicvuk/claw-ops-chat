import { randomBytes } from "crypto";

/**
 * In-memory short-TTL store for OAuth `state` parameters used by the
 * server-side web-redirect flow.
 *
 * When the wizard kicks off `/web-authorize-start` we mint a fresh random
 * `state`, stash it here, and put it into Google's auth URL. On the
 * callback (`/oauth-callback`) we look it up to prove the request came
 * from us (not a CSRF attempt) and to short-circuit the legacy
 * "proxy-to-workspace-mcp" path for known-good states.
 *
 * A process-local Map is fine here — this chat server runs as a single
 * instance for a single user, and the state's only job is to survive
 * the round-trip from "click Sign in" to "Google redirects back", which
 * completes within a few seconds. Restart of the Node process during
 * that window just means the user clicks Sign in again.
 */

const TTL_MS = 10 * 60 * 1000; // 10 minutes — same as Google's code TTL.
const states = new Map<string, { createdAt: number }>();

function sweep(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [key, v] of states) {
    if (v.createdAt < cutoff) states.delete(key);
  }
}

/** Mint a fresh state value and remember it. */
export function issueOauthState(): string {
  sweep();
  const state = randomBytes(32).toString("base64url");
  states.set(state, { createdAt: Date.now() });
  return state;
}

/**
 * Look up a state; returns true if it was present AND still valid. The
 * state is consumed on use (one-shot), so a replayed callback with the
 * same state falls through to `false`.
 */
export function consumeOauthState(state: string | null): boolean {
  if (!state) return false;
  sweep();
  const entry = states.get(state);
  if (!entry) return false;
  states.delete(state);
  return Date.now() - entry.createdAt <= TTL_MS;
}
