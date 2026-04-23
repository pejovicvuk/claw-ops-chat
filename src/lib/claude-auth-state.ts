import { randomBytes } from "crypto";

/**
 * Per-user in-flight state for Claude's direct-OAuth login flow.
 *
 * Holds the PKCE verifier + random `state` across the two-step
 * handshake: `POST /api/claude-auth/login` mints the state and hands
 * the browser an authorize URL carrying the derived `code_challenge`;
 * the user signs in at claude.com and pastes the returned code into
 * `POST /api/claude-auth/submit-code`, which looks up the original
 * verifier here to complete the token exchange.
 *
 * Keyed by user email (the chat server is single-user per email —
 * same pattern as the existing claude-auth-sessions.ts). Process-local
 * memory is appropriate here: state lifetime is bounded to ~10 min
 * (Anthropic's OAuth code TTL is less than that), and a server
 * restart mid-handshake just means the user clicks Sign in again.
 *
 * This is deliberately separate from `claude-auth-sessions.ts`
 * (which tracks running LoginSubprocess children for the REPL / spawn
 * fallbacks) — the direct-OAuth path has no child process, so
 * coupling them would require dead fields on both sides.
 */

const TTL_MS = 10 * 60 * 1000;

export type ClaudeAuthMethod = "claudeai" | "console" | "token";

export interface ClaudeAuthState {
  state: string;
  codeVerifier: string;
  method: ClaudeAuthMethod;
  createdAt: number;
}

const states = new Map<string, ClaudeAuthState>();

function sweep(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [key, entry] of states) {
    if (entry.createdAt < cutoff) states.delete(key);
  }
}

/**
 * Mint fresh `state` + `code_verifier`, associate with the user's
 * email, return the record so the caller can build the authorize URL.
 * Replaces any previous in-flight state for the same user (starting
 * a second sign-in invalidates the first — same UX as clicking Sign
 * in twice in the browser).
 */
export function issueAuthState(email: string, method: ClaudeAuthMethod): ClaudeAuthState {
  sweep();
  const entry: ClaudeAuthState = {
    state: randomBytes(32).toString("base64url"),
    // RFC 7636 §4.1: the verifier is a cryptographically random string
    // of 43–128 chars from the unreserved charset. 32 bytes → 43 chars
    // once base64url-encoded without padding, which is the minimum.
    codeVerifier: randomBytes(32).toString("base64url"),
    method,
    createdAt: Date.now(),
  };
  states.set(email, entry);
  return entry;
}

/**
 * Look up and consume an in-flight state by the user's email. Returns
 * null when nothing pending or the TTL has expired. One-shot: a
 * replayed submit-code with the same state falls through to null so
 * the same authorization code can't be exchanged twice.
 */
export function consumeAuthState(email: string): ClaudeAuthState | null {
  sweep();
  const entry = states.get(email);
  if (!entry) return null;
  states.delete(email);
  if (Date.now() - entry.createdAt > TTL_MS) return null;
  return entry;
}

/**
 * Peek without consuming — used by the logout path to decide whether
 * to also cancel a pending login.
 */
export function clearAuthState(email: string): void {
  states.delete(email);
}
