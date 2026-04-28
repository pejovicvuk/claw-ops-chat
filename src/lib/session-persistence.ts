import { existsSync } from "fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

/**
 * Disk persistence for chat sessions so a container restart doesn't wipe
 * every in-flight conversation. Writes one JSON file per session to
 * ~/.claude/chat-sessions/<id>.json; reads them all back on boot.
 *
 * Only the "replayable" slice of each session is persisted — the live
 * client set, pending request resolvers, rate-limit timestamps, and
 * the active AbortController all reset on restart. Everything a
 * reconnecting UI needs to reconstruct state (status, eventHistory,
 * claudeSessionId, permissionMode, resolved tool list) survives.
 */

const SESSIONS_DIR = join(homedir(), ".claude", "chat-sessions");

export interface PersistedSession {
  id: string;
  status: string;
  permissionMode: string;
  effort: string | null;
  claudeSessionId: string | null;
  sessionCwd: string | null;
  /**
   * Last known git branch of `sessionCwd`. Optional so older session
   * files load without a migration; absent means "not yet detected".
   */
  branchName?: string | null;
  eventHistory: Record<string, unknown>[];
  sessionAllowedTools: string[];
  accumulatedText: string;
  lastActivity: number;
  /**
   * True if this session was in the middle of something (thinking,
   * tool running, awaiting input) when the server died. The reconnect
   * handler surfaces this to the client so the user knows the previous
   * turn was interrupted and can re-send their last message if needed.
   */
  wasInterrupted?: boolean;
  /**
   * Last user message sent to this session, stored separately from
   * eventHistory (which only tracks server-side events). The client
   * uses this to pre-fill a "Resume" action when wasInterrupted is
   * true.
   */
  lastUserMessage?: string;
}

async function ensureDir(): Promise<void> {
  if (!existsSync(SESSIONS_DIR)) {
    await mkdir(SESSIONS_DIR, { recursive: true });
  }
}

function fileFor(id: string): string {
  // Sanity-filter the id — reject anything that couldn't be a valid
  // filename. The server generates UUIDs or "new-<ts>" strings today;
  // both pass through this regex.
  if (!/^[\w.-]{1,128}$/.test(id)) {
    throw new Error(`invalid session id for persistence: ${id}`);
  }
  return join(SESSIONS_DIR, `${id}.json`);
}

export async function persistSession(data: PersistedSession): Promise<void> {
  await ensureDir();
  const path = fileFor(data.id);
  // Atomic-ish write: write to .tmp then rename. Avoids corrupt JSON
  // if the process dies mid-write.
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data), "utf-8");
  const { rename } = await import("fs/promises");
  await rename(tmp, path);
}

export async function loadAllSessions(): Promise<PersistedSession[]> {
  if (!existsSync(SESSIONS_DIR)) return [];
  const out: PersistedSession[] = [];
  try {
    const entries = await readdir(SESSIONS_DIR);
    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(SESSIONS_DIR, name), "utf-8");
        const parsed = JSON.parse(raw) as PersistedSession;
        if (parsed && typeof parsed.id === "string") {
          out.push(parsed);
        }
      } catch {
        // Skip corrupt / partial files — don't let one bad session take
        // the whole server down.
      }
    }
  } catch {
    // Directory read errors are non-fatal.
  }
  return out;
}

export async function deleteSessionFile(id: string): Promise<void> {
  try {
    const path = fileFor(id);
    if (existsSync(path)) await unlink(path);
  } catch {
    // Ignore — file may be gone already or the id was invalid.
  }
}
