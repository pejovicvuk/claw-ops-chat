"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Minimal desktop-notifications helper for the chat app. Fires a system
 * Notification when a session needs attention (awaiting_permission /
 * awaiting_input) AND the browser tab isn't focused. Uses the built-in
 * Web Notifications API — no push server, no VAPID keys, no service
 * worker registration required.
 *
 * Trade-off: notifications only fire while the tab is open somewhere
 * (even if unfocused / in another workspace). True background push
 * (browser closed, device locked) would need Web Push + VAPID, which
 * is a much bigger change. This is the 80% useful subset.
 */

type NotifyArgs = {
  title: string;
  body?: string;
  /** Used as the Notification `tag` so repeat prompts collapse onto the same toast. */
  tag?: string;
  /** Called when the user clicks the notification (e.g. focus the tab). */
  onClick?: () => void;
};

export function useDesktopNotifications() {
  const permissionRef = useRef<NotificationPermission>("default");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    permissionRef.current = Notification.permission;
    // Don't auto-prompt — that's an anti-pattern. `ensurePermission()`
    // below asks on first fire, which is always in response to a real
    // event, so the browser permission dialog shows up with context.
  }, []);

  const ensurePermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined" || !("Notification" in window)) return false;
    if (permissionRef.current === "granted") return true;
    if (permissionRef.current === "denied") return false;
    try {
      const result = await Notification.requestPermission();
      permissionRef.current = result;
      return result === "granted";
    } catch {
      return false;
    }
  }, []);

  const notify = useCallback(
    async ({ title, body, tag, onClick }: NotifyArgs): Promise<void> => {
      if (typeof document === "undefined") return;
      // Only fire when the tab is NOT visible — otherwise the UI itself
      // already tells the user what's happening and an extra toast is
      // just noise.
      if (!document.hidden) return;
      const ok = await ensurePermission();
      if (!ok) return;
      try {
        const n = new Notification(title, {
          body,
          tag,
          // Reuse the PWA icon that the chat app already ships in /public.
          icon: "/chat/icons/icon-192.png",
          silent: false,
        });
        n.onclick = () => {
          try {
            window.focus();
          } catch {
            /* ignore */
          }
          onClick?.();
          n.close();
        };
      } catch {
        /* old browsers without Notification constructor — skip */
      }
    },
    [ensurePermission],
  );

  return { notify, ensurePermission };
}
