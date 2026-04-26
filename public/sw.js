const CACHE_NAME = "claw-chat-v1";

const PRECACHE_URLS = ["/chat", "/chat/login"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
  self.skipWaiting();
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
  } catch (_e) {
    data = { title: "Claw Chat", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const focused = wins.some((w) => w.visibilityState === "visible" && w.focused);
      if (focused) {
        for (const w of wins) {
          try {
            w.postMessage({ kind: "push-suppressed", data });
          } catch (_e) {
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
        tag: data.kind || "claw-chat",
        renotify: true,
        data: { url: data.url || "/chat", kind: data.kind || null },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/chat";
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = wins.find((w) => w.url.includes("/chat"));
      if (existing) {
        try {
          await existing.focus();
        } catch (_e) {
          /* ignore */
        }
        try {
          if ("navigate" in existing) await existing.navigate(target);
        } catch (_e) {
          /* ignore */
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
