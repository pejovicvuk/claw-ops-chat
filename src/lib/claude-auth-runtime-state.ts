/**
 * In-process singleton that tracks whether the Claude SDK rejected credentials
 * at runtime. Shared between server.ts (SessionManager) and Next.js API routes
 * because both run in the same Node.js process (custom server).
 *
 * SessionManager sets/clears this when a 401 is detected or a turn succeeds.
 * The /api/claude-auth/status route reads it so the Settings page can show a
 * live warning even when the on-disk credentials file looks valid.
 */

let _failed = false;
let _reason: "token_expired" | "subscription_expired" = "token_expired";

export function setRuntimeAuthFailed(
  failed: boolean,
  reason: "token_expired" | "subscription_expired" = "token_expired",
): void {
  _failed = failed;
  _reason = reason;
}

export function getRuntimeAuthFailed(): {
  failed: boolean;
  reason: "token_expired" | "subscription_expired";
} {
  return { failed: _failed, reason: _reason };
}
