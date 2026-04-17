import type { ChildProcess } from "child_process";

/**
 * Server-side store of in-flight `claude mcp add` child processes used to
 * authorize Anthropic-hosted MCP connectors (Gmail, Drive, Calendar) on
 * behalf of the signed-in user. Keyed by `${email}:${serviceId}` so multiple
 * services can authorize in parallel without colliding.
 */

const TIMEOUT_MS = 10 * 60 * 1000;

export type McpAuthServiceId = "gmail" | "google-drive" | "google-calendar";

export interface McpAuthSession {
  process: ChildProcess;
  serviceId: McpAuthServiceId;
  startedAt: number;
  subscribers: Set<(event: string) => void>;
  timeout: NodeJS.Timeout;
}

const sessions = new Map<string, McpAuthSession>();

function key(email: string, serviceId: McpAuthServiceId): string {
  return `${email}:${serviceId}`;
}

export function setMcpAuthSession(
  email: string,
  serviceId: McpAuthServiceId,
  process: ChildProcess,
): McpAuthSession {
  clearMcpAuthSession(email, serviceId);

  const k = key(email, serviceId);
  const timeout = setTimeout(() => {
    const existing = sessions.get(k);
    if (existing && !existing.process.killed) existing.process.kill();
    sessions.delete(k);
  }, TIMEOUT_MS);

  const session: McpAuthSession = {
    process,
    serviceId,
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

export function getMcpAuthSession(
  email: string,
  serviceId: McpAuthServiceId,
): McpAuthSession | undefined {
  return sessions.get(key(email, serviceId));
}

export function clearMcpAuthSession(email: string, serviceId: McpAuthServiceId): boolean {
  const k = key(email, serviceId);
  const existing = sessions.get(k);
  if (!existing) return false;
  clearTimeout(existing.timeout);
  if (!existing.process.killed) existing.process.kill();
  sessions.delete(k);
  return true;
}

export function broadcastToMcpAuthSession(
  email: string,
  serviceId: McpAuthServiceId,
  type: string,
  data: unknown,
): void {
  const session = sessions.get(key(email, serviceId));
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
