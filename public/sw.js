// Bumped to v5: smartChat suppression now keys off `visibilityState`
// alone instead of `visibilityState && focused`. `Document.hasFocus()`
// (the source of `Client.focused`) is unreliable on iOS PWAs and on
// desktop browsers when another OS window has input focus, even though
// the chat is in plain sight — that meant pushes were firing for the
// chat the user was actively watching. The new gate: if a window is
// visible and on the same chat, suppress. Source of truth for the
// algorithm + tests: `src/lib/push/should-suppress.ts` — keep the
// inline `shouldSuppress` below in sync with that module. The
// activate handler cleans up stale caches on every bump.
const CACHE_NAME = "claw-chat-v5";

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

/* ───────────────────────── Active-chat tracking ─────────────────────────
 *
 * The push handler needs to know which chat each focused tab is viewing
 * so `focusBehavior: "smartChat"` can suppress only when the focused tab
 * is on the same chat as the push. Clients post their current chat via
 * `postMessage({kind:"set-active-chat", chatId})`.
 *
 * Service-worker module scope is wiped on idle eviction (Chrome ~30 s),
 * so the map is mirrored to IndexedDB. On push wake, we lazy-load from
 * IDB and prune entries whose client.id is no longer alive (closed tab).
 * If no client has reported its chat yet (cold push before any tab
 * reconnected), `smartChat` falls open to "show" — better than silently
 * suppressing.
 */

const IDB_NAME = "claw-chat-sw";
const IDB_STORE = "activeChats";
const IDB_PENDING_CLICKS = "pendingClicks";
const activeChatByClientId = new Map();
let activeChatLoaded = false;

function openIdb() {
  return new Promise((resolve, reject) => {
    let req;
    try {
      // Version 2 adds the pendingClicks store for reliable notification
      // click navigation when the page wasn't open at click time.
      req = indexedDB.open(IDB_NAME, 2);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = (event) => {
      const db = req.result;
      try {
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      } catch {
        /* ignore — already exists */
      }
      // Added in v2: queue a pending notification click so the page can
      // process it on mount even when it wasn't open at tap/click time.
      if (event.oldVersion < 2) {
        try {
          db.createObjectStore(IDB_PENDING_CLICKS);
        } catch {
          /* ignore */
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbReadAll() {
  let db;
  try {
    db = await openIdb();
  } catch {
    return new Map();
  }
  return new Promise((resolve) => {
    const out = new Map();
    let tx;
    try {
      tx = db.transaction(IDB_STORE, "readonly");
    } catch {
      resolve(out);
      return;
    }
    const store = tx.objectStore(IDB_STORE);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        out.set(String(cursor.key), cursor.value);
        cursor.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => resolve(out);
  });
}

async function idbWrite(clientId, chatId) {
  let db;
  try {
    db = await openIdb();
  } catch {
    return;
  }
  await new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(IDB_STORE, "readwrite");
    } catch {
      resolve();
      return;
    }
    const store = tx.objectStore(IDB_STORE);
    if (chatId === null || chatId === undefined) {
      store.delete(clientId);
    } else {
      store.put(chatId, clientId);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

/**
 * Write a pending notification click to IDB so the page can process it on
 * mount even when the browser was closed at the time of the click. The entry
 * has a short TTL (30 s) enforced on the read side in NotificationListener.
 */
async function idbWritePendingClick(url, data) {
  let db;
  try {
    db = await openIdb();
  } catch {
    return;
  }
  await new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(IDB_PENDING_CLICKS, "readwrite");
    } catch {
      resolve();
      return;
    }
    tx.objectStore(IDB_PENDING_CLICKS).put({ url, data, ts: Date.now() }, "latest");
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

async function idbDeleteMany(clientIds) {
  if (!clientIds.length) return;
  let db;
  try {
    db = await openIdb();
  } catch {
    return;
  }
  await new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(IDB_STORE, "readwrite");
    } catch {
      resolve();
      return;
    }
    const store = tx.objectStore(IDB_STORE);
    for (const id of clientIds) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

async function ensureActiveChatLoaded() {
  if (activeChatLoaded) return;
  const fromIdb = await idbReadAll();
  for (const [k, v] of fromIdb) {
    if (!activeChatByClientId.has(k)) activeChatByClientId.set(k, v);
  }
  activeChatLoaded = true;
}

/**
 * Drop entries whose clientId is no longer in the live window list.
 * Called inside the push handler after `clients.matchAll()` so stale
 * tabs (closed without sending a chatId:null) can't keep suppressing
 * forever.
 */
async function pruneActiveChats(liveWins) {
  const live = new Set(liveWins.map((w) => w.id));
  const dead = [];
  for (const id of activeChatByClientId.keys()) {
    if (!live.has(id)) dead.push(id);
  }
  for (const id of dead) activeChatByClientId.delete(id);
  if (dead.length) await idbDeleteMany(dead);
}

self.addEventListener("message", (event) => {
  const data = event && event.data;
  if (!data || typeof data.kind !== "string") return;
  if (data.kind === "set-active-chat") {
    const sourceId = event.source && event.source.id;
    if (!sourceId) return;
    const chatId = data.chatId;
    event.waitUntil(
      (async () => {
        await ensureActiveChatLoaded();
        if (chatId === null || chatId === undefined || chatId === "") {
          activeChatByClientId.delete(sourceId);
          await idbWrite(sourceId, null);
        } else {
          activeChatByClientId.set(sourceId, String(chatId));
          await idbWrite(sourceId, String(chatId));
        }
      })(),
    );
  }
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

/**
 * Decide whether the SW should suppress the system notification given
 * the visible/focused windows and the requested focus behaviour.
 *
 *  - alwaysShow → never suppress.
 *  - suppress   → suppress only when a window is visible AND focused.
 *                 (Stricter mode: nuke notifications only when the user
 *                 is right there with input focus on the app.)
 *  - smartChat  → suppress when at least one **visible** window is on
 *                 the same chatId the push is for. Visibility alone is
 *                 the gate — `Client.focused` is unreliable on iOS PWAs
 *                 and on desktop when another window has OS focus, and
 *                 the user's intent for "smart" is "if I can see the
 *                 conversation, don't bother me." Falls open to "show"
 *                 when no chatId is supplied (e.g. cron) or when no
 *                 visible tab has reported its active chat.
 *
 * Source of truth + unit tests: `src/lib/push/should-suppress.ts`. Keep
 * this inline copy in sync with that module — the SW can't import TS,
 * so the algorithm is duplicated and the test file covers it.
 *
 * Returns true to suppress (in-app toast), false to show.
 */
function shouldSuppress(focusBehavior, wins, chatId) {
  if (focusBehavior === "alwaysShow") return false;
  const visible = wins.filter((w) => w.visibilityState === "visible");
  if (visible.length === 0) return false;
  if (focusBehavior === "suppress") {
    return visible.some((w) => w.focused);
  }
  // smartChat (default)
  if (!chatId) return false;
  return visible.some((w) => activeChatByClientId.get(w.id) === chatId);
}

/* ───────────────────────── Web Push ─────────────────────────
 * Handle a push payload from the server. Decision tree:
 *   1. closeOnly → dismiss matching notification, never show.
 *   2. forceShow → bypass suppression (used by test endpoint).
 *   3. focusBehavior → alwaysShow / smartChat / suppress.
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
      await ensureActiveChatLoaded();
      await pruneActiveChats(wins);

      const focusBehavior =
        typeof data.focusBehavior === "string" ? data.focusBehavior : "smartChat";

      // forceShow bypasses the focused-tab suppression entirely. Used by
      // the test endpoint so a user clicking "Send test" while looking
      // at the settings page actually sees a system notification —
      // otherwise the test path silently degrades to an in-app toast and
      // the user can't tell whether their OS-level notifications work.
      const suppress =
        !data.forceShow &&
        shouldSuppress(focusBehavior, wins, data.chatId ? String(data.chatId) : null);

      if (suppress) {
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
        // Tests come with `requireInteraction: true` so the user has
        // time to look — auto-dismiss on real notifications still works
        // (they don't carry forceShow).
        requireInteraction: !!data.forceShow,
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
      // Always persist the pending click to IDB first. The page checks this
      // on mount so that clicks work even when the browser was closed — the
      // postMessage path below is a best-effort fast path for already-open
      // tabs; it silently drops when the page hasn't attached its listener
      // yet (e.g. initial load after cold-open).
      await idbWritePendingClick(target, data);

      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = wins.find((w) => w.url.includes("/chat"));
      if (existing) {
        try {
          await existing.focus();
        } catch {
          /* ignore */
        }
        // Attempt in-app SPA routing via postMessage (no full reload).
        // NotificationListener handles `notification-click` and clears
        // the IDB entry so the page doesn't double-navigate on mount.
        try {
          existing.postMessage({ kind: "notification-click", url: target, data });
        } catch {
          /* ignore — IDB fallback handles it */
        }
        // Also navigate if the window is on a different chat, so that
        // page-loading races are covered even without the IDB check.
        try {
          const existingChat = new URL(existing.url).searchParams.get("chat");
          const targetChat = new URL(target, self.location.origin).searchParams.get("chat");
          if (existingChat !== targetChat && "navigate" in existing) {
            await existing.navigate(target);
          }
        } catch {
          /* ignore */
        }
        return;
      }
      // No existing window — open a new one. The IDB entry will be
      // picked up by NotificationListener once the page loads.
      await self.clients.openWindow(target);
    })(),
  );
});
