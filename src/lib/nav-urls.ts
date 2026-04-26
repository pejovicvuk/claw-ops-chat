/**
 * Centralised URL builder for in-app deep links. Importable on both
 * client and server so the keys we encode here always match the keys the
 * page reads via `useUrlState` (`params.get("chat")`, `params.get("report")`).
 *
 * Background: notifications previously emitted `?session=<id>` from the
 * server while `src/app/page.tsx` reads `?chat=<id>` — clicking a
 * notification landed on the app but never selected the right chat. All
 * notification URLs now go through this module.
 */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";

export const navUrls = {
  /** Root of the chat app — used as a fallback when no specific target is known. */
  chatRoot: (): string => `${BASE}/`,
  /** Deep link to a specific chat session (matches `params.get("chat")`). */
  chat: (sessionId: string): string => `${BASE}/?chat=${encodeURIComponent(sessionId)}`,
  /** Deep link to a specific report (matches `params.get("report")`). */
  report: (slug: string): string => `${BASE}/?report=${encodeURIComponent(slug)}`,
  /** Open the notifications settings panel. */
  settingsNotifications: (): string => `${BASE}/?settings=notifications`,
};

/**
 * Parse a URL produced by `navUrls.*` and return `{ key, value }` so the
 * NotificationListener can call `setParam(key, value)` directly without
 * a hard reload. Returns null when the URL doesn't match a known shape.
 *
 * Accepts both absolute (`https://host/chat/?chat=…`) and relative
 * (`/chat/?chat=…`) forms — the SW emits the relative form.
 */
export function parseNavUrl(url: string): { key: "chat" | "report"; value: string } | null {
  let search: string;
  try {
    // URL constructor needs an origin for relative URLs — use a dummy one.
    const u = new URL(url, "http://dummy");
    search = u.search;
  } catch {
    return null;
  }
  const params = new URLSearchParams(search);
  const chat = params.get("chat");
  if (chat) return { key: "chat", value: chat };
  const report = params.get("report");
  if (report) return { key: "report", value: report };
  return null;
}
