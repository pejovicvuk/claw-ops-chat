import type { FocusBehavior } from "./types";

/**
 * Subset of the SW `Client` interface this module needs. Defined inline
 * so the test file can build fixtures without pulling the lib.dom.d.ts
 * `Client` (which carries unrelated members and varies by TS version).
 */
export interface SuppressClient {
  id: string;
  visibilityState: "hidden" | "visible" | "prerender" | "unloaded";
  focused: boolean;
}

/**
 * Decide whether the service worker should suppress the system
 * notification given the focused/visible windows and the per-device
 * focus behaviour.
 *
 *  - `alwaysShow` — never suppress.
 *  - `suppress`   — suppress only when a window has true OS focus.
 *                   Matches the previous default; useful for users who
 *                   want notifications to disappear the moment the app
 *                   gets attention.
 *  - `smartChat`  — suppress when at least one **visible** window is
 *                   viewing the same chat the push is for. Visibility
 *                   alone is the gate: `Document.hasFocus()` is unreliable
 *                   on iOS PWAs and on desktop browsers when another OS
 *                   window has input focus, even though the chat is in
 *                   plain sight. The user's intent for "smart" is "if I
 *                   can see this conversation, don't bother me."
 *
 * Falls open to `false` (show the notification) whenever:
 *  - no client window exists at all (push received with PWA closed)
 *  - the chatId is unknown (cron / monitoring events)
 *  - no visible client has reported its active chat yet
 *
 * Pure function — unit-tested without a service worker. Mirrored in
 * `public/sw.js`; if you change the algorithm here, update the SW too
 * and bump the cache name (`CACHE_NAME` in `sw.js`) so existing tabs
 * pick up the new worker.
 */
export function shouldSuppress(
  focusBehavior: FocusBehavior,
  clients: readonly SuppressClient[],
  chatId: string | null,
  activeChatByClientId: ReadonlyMap<string, string>,
): boolean {
  if (focusBehavior === "alwaysShow") return false;

  const visible = clients.filter((c) => c.visibilityState === "visible");
  if (visible.length === 0) return false;

  if (focusBehavior === "suppress") {
    return visible.some((c) => c.focused);
  }

  // smartChat (default): visibility — not OS focus — is the gate.
  if (!chatId) return false;
  return visible.some((c) => activeChatByClientId.get(c.id) === chatId);
}
