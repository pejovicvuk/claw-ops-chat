import { readFile, stat } from "fs/promises";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { mimeFor } from "@/lib/mime";
import { safePath, SafePathError } from "@/lib/safe-path";

/**
 * Serve a local file inline with the correct Content-Type so `<img src=>`,
 * `<video src=>`, `<iframe src=pdf>` etc. can embed it directly.
 *
 * Different from /api/files/download (which forces
 * application/octet-stream + Content-Disposition: attachment) — this
 * one is purpose-built for inline preview components.
 */

const MAX_SERVE_BYTES = 25 * 1024 * 1024; // 25 MB

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
    if (!s.isFile()) {
      return Response.json({ error: "Not a file" }, { status: 400 });
    }
    if (s.size > MAX_SERVE_BYTES) {
      return Response.json(
        { error: `File too large to serve inline (${s.size} > ${MAX_SERVE_BYTES})` },
        { status: 413 },
      );
    }
    const buf = await readFile(filePath);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": mimeFor(filePath),
        "Content-Disposition": "inline",
        "Content-Length": String(s.size),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return Response.json({ error: "File not found" }, { status: 404 });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to read file" },
      { status: 500 },
    );
  }
}
