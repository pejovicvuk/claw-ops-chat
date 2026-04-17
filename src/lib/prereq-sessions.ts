import type { ChildProcess } from "child_process";

/**
 * Server-side store of in-flight prerequisite install child processes
 * (e.g. `uv` installer). Keyed by `${email}:${prereqId}` so multiple
 * prereqs can install in parallel without colliding.
 *
 * One install per user per prereq at a time — starting a new one replaces
 * the existing.
 */

const TIMEOUT_MS = 15 * 60 * 1000;

export type PrereqId = "uv";

export interface PrereqSession {
  process: ChildProcess;
  prereqId: PrereqId;
  startedAt: number;
  subscribers: Set<(event: string) => void>;
  timeout: NodeJS.Timeout;
}

const sessions = new Map<string, PrereqSession>();

function key(email: string, prereqId: PrereqId): string {
  return `${email}:${prereqId}`;
}

export function setPrereqSession(
  email: string,
  prereqId: PrereqId,
  process: ChildProcess,
): PrereqSession {
  clearPrereqSession(email, prereqId);

  const k = key(email, prereqId);
  const timeout = setTimeout(() => {
    const existing = sessions.get(k);
    if (existing && !existing.process.killed) existing.process.kill();
    sessions.delete(k);
  }, TIMEOUT_MS);

  const session: PrereqSession = {
    process,
    prereqId,
    startedAt: Date.now(),
    subscribers: new Set(),
    timeout,
  };
  sessions.set(k, session);

  process.on("close", () => {
    const current = sessions.get(k);
    if (current === session) {
      clearTimeout(session.timeout);
      sessions.delete(k);
    }
  });

  return session;
}

export function getPrereqSession(email: string, prereqId: PrereqId): PrereqSession | undefined {
  return sessions.get(key(email, prereqId));
}

export function clearPrereqSession(email: string, prereqId: PrereqId): boolean {
  const k = key(email, prereqId);
  const existing = sessions.get(k);
  if (!existing) return false;
  clearTimeout(existing.timeout);
  if (!existing.process.killed) existing.process.kill();
  sessions.delete(k);
  return true;
}

export function broadcastToPrereqSession(
  email: string,
  prereqId: PrereqId,
  type: string,
  data: unknown,
): void {
  const session = sessions.get(key(email, prereqId));
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
