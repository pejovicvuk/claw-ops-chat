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
