import { stat } from "fs/promises";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { mimeFor } from "@/lib/mime";
import { safePath, SafePathError } from "@/lib/safe-path";

/**
 * Lightweight stat endpoint for file cards — returns size + mtime +
 * mime without reading file contents. Used by the <FileCard> component
 * to show "PowerPoint · 2.4 MB · modified 3h ago" under the filename.
 *
 * Returns 200 with { exists: false } when the file is missing rather
 * than 404 so cards can render a "missing file" state without the
 * caller having to distinguish 404 from other errors.
 */

interface StatResponse {
  exists: boolean;
  size: number;
  /** ms epoch */
  mtime: number;
  mime: string;
}

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path");
  if (!rawPath) {
    return Response.json({ error: "path parameter required" }, { status: 400 });
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
    const s = await stat(filePath);
    const res: StatResponse = {
      exists: true,
      size: s.size,
      mtime: s.mtimeMs,
      mime: mimeFor(filePath),
    };
    return Response.json(res, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      const res: StatResponse = { exists: false, size: 0, mtime: 0, mime: "" };
      return Response.json(res, {
        headers: { "Cache-Control": "private, max-age=10" },
      });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to stat file" },
      { status: 500 },
    );
  }
}
