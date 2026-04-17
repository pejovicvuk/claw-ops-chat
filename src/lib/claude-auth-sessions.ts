import type { ChildProcess } from "child_process";

/**
 * Server-side store of in-flight Claude auth login child processes.
 * Keyed by user email (from the signed session cookie).
 *
 * One login flow per user at a time — starting a new one replaces the old.
 */

const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export interface LoginSession {
  process: ChildProcess;
  method: "claudeai" | "console" | "token";
  startedAt: number;
  /** SSE writers subscribed to this process's events. */
  subscribers: Set<(event: string) => void>;
  /** Cleanup timer — kills the process if no activity. */
  timeout: NodeJS.Timeout;
}

const sessions = new Map<string, LoginSession>();

/** Start a new login session, replacing any existing one for this user. */
export function setLoginSession(
  email: string,
  process: ChildProcess,
  method: LoginSession["method"],
): LoginSession {
  // Kill any existing session for this user.
  clearLoginSession(email);

  const timeout = setTimeout(() => {
    const existing = sessions.get(email);
    if (existing && !existing.process.killed) {
      existing.process.kill();
    }
    sessions.delete(email);
  }, TIMEOUT_MS);

  const session: LoginSession = {
    process,
    method,
    startedAt: Date.now(),
    subscribers: new Set(),
    timeout,
  };
  sessions.set(email, session);

  // Auto-cleanup on process exit.
  process.on("close", () => {
    const current = sessions.get(email);
    if (current === session) {
      clearTimeout(session.timeout);
      sessions.delete(email);
    }
  });

  return session;
}

export function getLoginSession(email: string): LoginSession | undefined {
  return sessions.get(email);
}

/** Kill the process and remove the session. */
export function clearLoginSession(email: string): boolean {
  const existing = sessions.get(email);
  if (!existing) return false;
  clearTimeout(existing.timeout);
  if (!existing.process.killed) {
    existing.process.kill();
  }
  sessions.delete(email);
  return true;
}

/** Broadcast an SSE-formatted event to all subscribers of this user's session. */
export function broadcastToSession(email: string, type: string, data: unknown): void {
  const session = sessions.get(email);
  if (!session) return;
  const payload = `data: ${JSON.stringify({ type, ...(data as object) })}\n\n`;
  for (const write of session.subscribers) {
    try {
      write(payload);
    } catch {
      /* subscriber closed */
    }
  }
}
