"use client";

import { useEffect, useRef } from "react";
import { parseNavUrl } from "@/lib/nav-urls";
import { toast } from "@/lib/use-toast";
import { useUrlState } from "@/lib/use-url-state";
import type { PushPayload } from "./types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";
const MAX_BACKOFF_MS = 30_000;

/**
 * Connects to the server's /ws/notifications channel and shows in-app
 * toasts for notification events that target a different chat than the
 * one the user is currently viewing.
 *
 * This is the fallback path for when the OS silently drops a system
 * notification (DND, Focus mode, OS-level permission revoked). The
 * service worker's `push-suppressed` path already handles the case where
 * the user is ON the same chat; this hook covers cross-session events
 * that would otherwise be invisible if the push service is unreachable
 * or the OS swallows the notification.
 *
 * One persistent connection per app mount. URL changes update a ref so
 * the socket never reconnects on navigation — only on unmount/remount.
 */
export function useNotificationsChannel(): void {
  const { params, setParam } = useUrlState();
  const chatIdRef = useRef<string | null>(null);
  const setParamRef = useRef(setParam);

  chatIdRef.current = params.get("chat");
  setParamRef.current = setParam;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("WebSocket" in window)) return;

    let ws: WebSocket | null = null;
    let closed = false;
    let attempt = 0;

    function connect(): void {
      if (closed) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}${BASE}/ws/notifications`;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }

      ws.onmessage = (event: MessageEvent) => {
        let msg: { type?: string; payload?: PushPayload };
        try {
          msg = JSON.parse(event.data as string) as { type?: string; payload?: PushPayload };
        } catch {
          return;
        }
        if (msg.type !== "notification" || !msg.payload) return;
        const payload = msg.payload;

        // The SW + push already handle same-chat events (suppress → toast or
        // system notification). Skip here to avoid duplicating the toast.
        if (payload.chatId && payload.chatId === chatIdRef.current) return;

        const title = payload.title || "New notification";
        const body = payload.body || "";
        const message = body ? `${title} — ${body}` : title;
        const url = payload.url;
        toast.info(message, {
          onClick: url
            ? () => {
                const parsed = parseNavUrl(url);
                if (parsed) {
                  setParamRef.current(parsed.key, parsed.value);
                  return;
                }
                try {
                  window.location.assign(url);
                } catch {
                  /* ignore */
                }
              }
            : undefined,
        });
      };

      ws.onopen = () => {
        attempt = 0;
      };

      ws.onclose = () => {
        ws = null;
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    function scheduleReconnect(): void {
      if (closed) return;
      const delay = Math.min(1_000 * 2 ** attempt, MAX_BACKOFF_MS);
      attempt++;
      setTimeout(connect, delay);
    }

    connect();

    return () => {
      closed = true;
      ws?.close();
    };
  }, []);
}
