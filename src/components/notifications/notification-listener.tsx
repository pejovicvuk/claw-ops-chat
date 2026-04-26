"use client";

import { useEffect } from "react";
import { parseNavUrl } from "@/lib/nav-urls";
import { toast } from "@/lib/use-toast";
import { useUrlState } from "@/lib/use-url-state";

/**
 * Bridge between the service worker's postMessage channel and the SPA.
 *
 * The SW dispatches three message kinds we care about:
 * - `push-suppressed`: a Web Push payload arrived while the tab was
 *   focused. The SW skipped the system notification — we render an
 *   in-app toast instead so the user still gets visual confirmation.
 * - `notification-click`: the user clicked a system notification while
 *   the tab was open elsewhere. Navigate via `useUrlState` (no full
 *   page reload) so the SPA's session/report state is preserved.
 * - `push-closed`: the SW closed a stale notification (closeOnly
 *   payload). We dismiss any matching open toast for symmetry.
 *
 * Mounts once at the app root (next to <ToastStack />). Renders nothing.
 */

interface PushData {
  title?: string;
  body?: string;
  url?: string;
  kind?: string;
  closeOnly?: boolean;
}

export function NotificationListener(): null {
  const { setParam } = useUrlState();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const handler = (event: MessageEvent) => {
      const msg = event.data as { kind?: string; data?: PushData; url?: string } | undefined;
      if (!msg || typeof msg.kind !== "string") return;

      if (msg.kind === "push-suppressed") {
        const data = msg.data ?? {};
        if (data.closeOnly) return;
        const title = data.title || "New notification";
        const body = data.body || "";
        const message = body ? `${title} — ${body}` : title;
        const url = data.url;
        toast.info(message, {
          onClick: url
            ? () => {
                const parsed = parseNavUrl(url);
                if (parsed) {
                  setParam(parsed.key, parsed.value);
                  return;
                }
                // Unknown shape — fall back to a hard navigation. Better
                // than silently dropping the click.
                try {
                  window.location.assign(url);
                } catch {
                  /* ignore */
                }
              }
            : undefined,
        });
        return;
      }

      if (msg.kind === "notification-click") {
        const url = msg.url;
        if (!url) return;
        const parsed = parseNavUrl(url);
        if (parsed) {
          setParam(parsed.key, parsed.value);
          return;
        }
        try {
          window.location.assign(url);
        } catch {
          /* ignore */
        }
        return;
      }

      // push-closed is informational — we don't track in-app toasts by
      // tag (the `useToast` store is keyed by sequential id), so there's
      // nothing to dismiss here. Reserved for future use.
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handler);
    };
  }, [setParam]);

  return null;
}
