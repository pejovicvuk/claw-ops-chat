// Bumped to v2 when the push handler was rewritten so older clients
// re-install with the new logic (the activate handler below cleans up
// stale caches).
const CACHE_NAME = "claw-chat-v2";

const PRECACHE_URLS = ["/chat", "/chat/login"];

self.addEventListener("install", (event) => {
  // Resilient install: a single failed precache URL must not abort the
  // install (which would leave the worker `redundant` and break Push
  // forever — `serviceWorker.ready` then never resolves). Use
  // Promise.allSettled so per-URL failures are swallowed, wrap the
  // cache-open itself in try/catch, and run skipWaiting INSIDE the
  // waitUntil promise so it doesn't race with install.
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        await Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)));
      } catch {
        /* cache subsystem unavailable — push still works without it */
      }
      try {
        await self.skipWaiting();
      } catch {
        /* skipWaiting can reject in some Safari versions — non-fatal */
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests, API calls, and WebSocket upgrades
  if (
    event.request.method !== "GET" ||
    url.pathname.includes("/api/") ||
    url.pathname.includes("/ws/")
  ) {
    return;
  }

  // Network-first for navigation and static assets
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses for static assets
        if (
          response.ok &&
          (url.pathname.startsWith("/chat/_next/static/") ||
            url.pathname.match(/\.(js|css|png|jpg|svg|ico|woff2?)$/))
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

/**
 * Build a stable per-event tag so independent permission requests /
 * report completions don't collapse onto the same on-screen toast.
 * Falls back to the kind alone (legacy behaviour) when no key is
 * carried in the payload.
 */
function tagFor(data) {
  const kind = data && data.kind ? String(data.kind) : "claw-chat";
  const key = data && (data.tagKey || data.sessionId || data.reportSlug);
  return key ? `${kind}:${key}` : kind;
}

/* ───────────────────────── Web Push ─────────────────────────
 * Handle a push payload from the server. If any window is
 * already focused on the chat, suppress the system notification
 * and forward the data to the page so it can show an in-app
 * toast instead — the user is already looking at the app.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Claw Chat", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      const tag = tagFor(data);

      // closeOnly: the server tells us a previously fired notification
      // is now stale (e.g. the user approved from another tab). Find
      // any matching system notification and dismiss it. Never show a
      // new one for closeOnly payloads.
      if (data && data.closeOnly) {
        try {
          const open = await self.registration.getNotifications({ tag });
          for (const n of open) {
            try {
              n.close();
            } catch {
              /* ignore */
            }
          }
          // Mirror the close to any open client so the in-app toast
          // (if any) also disappears.
          const wins = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true,
          });
          for (const w of wins) {
            try {
              w.postMessage({ kind: "push-closed", tag, data });
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore */
        }
        return;
      }

      const wins = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const focused = wins.some((w) => w.visibilityState === "visible" && w.focused);
      if (focused) {
        for (const w of wins) {
          try {
            w.postMessage({ kind: "push-suppressed", data });
          } catch {
            /* ignore */
          }
        }
        return;
      }
      const title = data.title || "Claw Chat";
      const body = data.body || "";
      await self.registration.showNotification(title, {
        body,
        icon: "/chat/icons/icon-192.png",
        badge: "/chat/icons/icon-192.png",
        tag,
        renotify: true,
        data: { url: data.url || "/chat", kind: data.kind || null, tagKey: data.tagKey || null },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = data.url || "/chat";
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = wins.find((w) => w.url.includes("/chat"));
      if (existing) {
        try {
          await existing.focus();
        } catch {
          /* ignore */
        }
        // Prefer postMessage so the SPA can route in-app via
        // `useUrlState` (no full page reload, no remount of state).
        // The NotificationListener handles `notification-click`.
        try {
          existing.postMessage({ kind: "notification-click", url: target, data });
          return;
        } catch {
          /* fall through to navigate */
        }
        try {
          if ("navigate" in existing) await existing.navigate(target);
        } catch {
          /* ignore */
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
