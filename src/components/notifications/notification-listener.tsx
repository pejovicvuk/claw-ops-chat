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
 * On mount we also check IndexedDB for a pending notification click that
 * was recorded by the SW when the browser was closed at click time. This
 * covers the gap where the postMessage fast-path silently drops because
 * the page's message handler wasn't attached yet during initial load.
 *
 * Mounts once at the app root (next to <ToastStack />). Renders nothing.
 */

const IDB_NAME = "claw-chat-sw";
const IDB_PENDING_CLICKS = "pendingClicks";
const PENDING_CLICK_TTL_MS = 30_000;

interface PendingClick {
  url: string;
  data: PushData;
  ts: number;
}

async function popPendingClick(): Promise<PendingClick | null> {
  if (typeof indexedDB === "undefined") return null;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 2);
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_PENDING_CLICKS)) {
          db.close();
          resolve(null);
          return;
        }
        try {
          const tx = db.transaction(IDB_PENDING_CLICKS, "readwrite");
          const store = tx.objectStore(IDB_PENDING_CLICKS);
          const getReq = store.get("latest");
          getReq.onsuccess = () => {
            const entry = getReq.result as PendingClick | undefined;
            store.delete("latest");
            tx.oncomplete = () => {
              db.close();
              resolve(entry ?? null);
            };
          };
          getReq.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          db.close();
          resolve(null);
        }
      };
    } catch {
      resolve(null);
    }
  });
}

interface PushData {
  title?: string;
  body?: string;
  url?: string;
  kind?: string;
  closeOnly?: boolean;
}

function navigateTo(url: string, setParam: (key: string, value: string) => void): void {
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
}

export function NotificationListener(): null {
  const { setParam } = useUrlState();

  // On mount: check IDB for a pending notification click that was stored
  // by the service worker when the browser was closed at click time. This
  // recovers the navigation that the postMessage fast-path would have
  // dropped because the listener wasn't attached yet during cold load.
  useEffect(() => {
    void popPendingClick().then((pending) => {
      if (!pending) return;
      if (Date.now() - pending.ts > PENDING_CLICK_TTL_MS) return;
      navigateTo(pending.url, setParam);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          onClick: url ? () => navigateTo(url, setParam) : undefined,
        });
        return;
      }

      if (msg.kind === "notification-click") {
        const url = msg.url;
        if (!url) return;
        // The SW already handled the click via postMessage, so clear any
        // pending IDB entry to prevent the mount-time check from double-
        // navigating if the page was still loading when the message arrived.
        void popPendingClick();
        navigateTo(url, setParam);
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
