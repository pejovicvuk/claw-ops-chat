"use client";

import { useEffect, useRef } from "react";
import { useUrlState } from "@/lib/use-url-state";

/**
 * Tells the service worker which chat the user is currently viewing
 * so the SW's `focusBehavior: "smartChat"` decision can suppress
 * notifications only when the focused tab is on the same chat as the
 * incoming push (and surface a system notification for any other chat).
 *
 * The SW persists its `clientId → chatId` map in IndexedDB so it
 * survives idle eviction. We re-broadcast in three more places besides
 * URL changes to make sure a freshly-woken SW gets the truth from at
 * least one live tab:
 *
 *  - `visibilitychange → visible`: user came back; SW may have
 *    forgotten while we were away.
 *  - `controllerchange`: the SW activated a new version; `controller`
 *    can swap out from under us — re-post immediately.
 *  - `serviceWorker.ready`: first-load belt-and-braces, also covers
 *    the case where `controller` is null until activation finishes.
 *
 * On unmount we send `chatId: null` so the SW prunes us — keeps the
 * IDB store from accumulating dead clients.
 */
export function ActiveChatBroadcaster(): null {
  const { params } = useUrlState();
  const chatId = params.get("chat");
  const lastSentRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Send to whichever worker controls this page right now. If
    // `controller` is null (first registration not yet activated),
    // `serviceWorker.ready` below will catch the next update.
    const post = (id: string | null) => {
      const ctrl = navigator.serviceWorker.controller;
      if (!ctrl) return;
      try {
        ctrl.postMessage({ kind: "set-active-chat", chatId: id });
        lastSentRef.current = id;
      } catch {
        /* ignore */
      }
    };

    post(chatId);

    const onVisible = () => {
      if (document.visibilityState === "visible") post(chatId);
    };
    const onControllerChange = () => post(chatId);
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // First-load + post-activation: ready resolves once a worker is
    // active for this scope; harmless to repost the same chatId.
    void navigator.serviceWorker.ready.then(() => post(chatId)).catch(() => {});

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, [chatId]);

  // Distinct effect so the unmount cleanup only fires when the
  // component itself goes away, not on every chatId change. A null
  // post is the SW's signal to drop the entry from IndexedDB.
  useEffect(() => {
    return () => {
      if (typeof navigator === "undefined") return;
      if (!("serviceWorker" in navigator)) return;
      const ctrl = navigator.serviceWorker.controller;
      if (!ctrl) return;
      try {
        ctrl.postMessage({ kind: "set-active-chat", chatId: null });
      } catch {
        /* ignore */
      }
    };
  }, []);

  return null;
}
