import { readFile, stat, writeFile } from "fs/promises";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { safePath, SafePathError } from "@/lib/safe-path";

/**
 * Tolerate sub-millisecond mtime drift between successive stat() calls on
 * filesystems that don't update the timestamp on every flush (some FUSE
 * mounts, stale NFS attribute caches). Anything beyond this counts as a
 * real out-of-band change.
 */
const MTIME_TOLERANCE_MS = 1;

async function postHandler(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const body = await request.json();
  const rawPath = body?.path;
  const content = body?.content;
  const expectedMtimeMs =
    typeof body?.expectedMtimeMs === "number" && Number.isFinite(body.expectedMtimeMs)
      ? body.expectedMtimeMs
      : null;

  if (!rawPath || typeof content !== "string") {
    return Response.json({ error: "path and content required" }, { status: 400 });
  }

  let filePath: string;
  try {
    filePath = await safePath(rawPath);
  } catch (err) {
    if (err instanceof SafePathError) {
      return Response.json({ error: "Access denied", code: "safe_path" }, { status: 403 });
    }
    return Response.json({ error: "Invalid path", code: "invalid_path" }, { status: 400 });
  }

  try {
    if (expectedMtimeMs !== null) {
      let current: { mtimeMs: number } | null = null;
      try {
        current = await stat(filePath);
      } catch {
        // File doesn't exist yet — caller's expectedMtimeMs only applies
        // when the file is supposed to be there, so a missing file with
        // any expected mtime is itself a conflict.
      }
      if (current && Math.abs(current.mtimeMs - expectedMtimeMs) > MTIME_TOLERANCE_MS) {
        const currentContent = await readFile(filePath, "utf-8");
        return Response.json(
          {
            error: "File changed on disk since you opened it",
            code: "stale_mtime",
            currentMtimeMs: current.mtimeMs,
            currentContent,
          },
          { status: 409 },
        );
      }
      if (!current) {
        return Response.json(
          {
            error: "File was deleted since you opened it",
            code: "stale_mtime",
            currentMtimeMs: null,
            currentContent: null,
          },
          { status: 409 },
        );
      }
    }

    await writeFile(filePath, content, "utf-8");
    const after = await stat(filePath);
    return Response.json({ ok: true, mtimeMs: after.mtimeMs });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to write file" },
      { status: 500 },
    );
  }
}

export const POST = withAudit(
  {
    route: "/api/files/write",
    subjectFrom: async (req) => {
      try {
        const body = (await req.clone().json()) as { path?: unknown };
        return typeof body.path === "string" ? body.path : null;
      } catch {
        return null;
      }
    },
  },
  postHandler,
);
