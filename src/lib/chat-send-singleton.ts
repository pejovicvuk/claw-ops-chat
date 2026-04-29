/**
 * Process-wide handle so the Next.js API route at /api/chat/send can
 * reach the SessionManager (which lives in server.ts and isn't directly
 * importable from inside `src/`).
 *
 * Pinned to `globalThis` for the same reason as the reports-session-manager
 * singleton: Next.js 16 standalone duplicates module instances between the
 * custom server entry and the bundled API routes, so a plain module-local
 * variable is never visible across the bundle boundary.
 */

export interface ChatSendHandle {
  enqueueUserMessage(args: {
    sessionId: string;
    text: string;
    clientMessageId: string;
    actorEmail: string;
    sessionCwd?: string | null;
  }): { ok: boolean; duplicate?: boolean; rateLimited?: boolean };
}

const KEY = "__claw_chat_send_handle__";

interface Global {
  [KEY]?: ChatSendHandle | null;
}

export function setChatSendHandle(h: ChatSendHandle): void {
  (globalThis as Global)[KEY] = h;
}

export function getChatSendHandle(): ChatSendHandle | null {
  return (globalThis as Global)[KEY] ?? null;
}
