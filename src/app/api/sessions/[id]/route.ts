import { readdir, stat, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { consolidatorProjectDirName } from "@/lib/memory/paths";
import { deleteSessionFile } from "@/lib/session-persistence";
import { clearSessionStatus } from "@/lib/session-status-store";

/**
 * DELETE /chat/api/sessions/:id
 *
 * Removes a chat session end-to-end:
 *   1. Claude SDK's own JSONL transcript at
 *      ~/.claude/projects/<encoded-cwd>/<id>.jsonl — this is what
 *      /api/sessions GET walks to build the sidebar list, so
 *      removing the file is what actually makes the chat disappear.
 *   2. Our per-session persistence file at
 *      ~/.claude/chat-sessions/<id>.json (status, event history,
 *      permission mode, etc.) so a container restart doesn't
 *      resurrect the deleted chat.
 *   3. The shared session-status-store entry that drives the
 *      sidebar's live status dot.
 *
 * The in-memory ChatSession map inside server.ts's ChatServer is
 * intentionally not touched from here — that class is private to
 * server.ts and already has a 30-minute idle-reaper. If a client
 * has the deleted chat open, the client-side delete handler moves
 * them to a new chat immediately; the orphan in-memory session
 * will get reaped naturally once its WS closes.
 */

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

// Mirror of the sanitizer used by session-persistence.ts so we reject
// path-traversal attempts before touching the disk.
const VALID_ID = /^[\w.-]{1,128}$/;

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!extractSession(request)) return unauthorized();

  const { id } = await params;
  if (!VALID_ID.test(id)) {
    return Response.json({ error: "Invalid session id" }, { status: 400 });
  }

  // 1. Claude SDK JSONL. A given session id is unique across project
  //    dirs, but we scan all of them rather than computing the
  //    encoded-cwd ourselves — that encoding lives in the SDK and isn't
  //    public API.
  let removedJsonl = 0;
  // Skip the consolidator's stub project dir — its JSONLs are
  // owned by the auto-memory subsystem, not by user chats.
  const skipDir = consolidatorProjectDirName();
  try {
    const projDirs = await readdir(PROJECTS_DIR).catch(() => [] as string[]);
    for (const projDir of projDirs) {
      if (projDir === skipDir) continue;
      const projPath = join(PROJECTS_DIR, projDir);
      const s = await stat(projPath).catch(() => null);
      if (!s?.isDirectory()) continue;
      const target = join(projPath, `${id}.jsonl`);
      try {
        await unlink(target);
        removedJsonl++;
      } catch {
        /* not in this project dir — normal, keep scanning. */
      }
    }
  } catch {
    /* PROJECTS_DIR missing or unreadable — fall through, nothing to do. */
  }

  // 2 & 3 — tolerant of missing files / unknown ids.
  await deleteSessionFile(id);
  clearSessionStatus(id);

  return Response.json({ ok: true, removedJsonl });
}
