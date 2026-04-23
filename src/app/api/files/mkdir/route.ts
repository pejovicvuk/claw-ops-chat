import { mkdir } from "fs/promises";
import { join } from "path";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { safePath, SafePathError } from "@/lib/safe-path";

/**
 * Create a directory.
 *
 * Body: `{ path: string, name?: string, recursive?: boolean }`
 * - If `name` is present, the new directory is created as `<path>/<name>`.
 * - If `name` is absent, `path` itself is created.
 * - `recursive: true` (default: false) mkdirs all missing parents — used by
 *   the folder-upload orchestrator so it can ensure a deeply-nested target
 *   exists in one call.
 *
 * Returns 201 on success, 409 if the directory already exists (non-recursive
 * mode only — recursive mkdir treats existing dirs as a no-op).
 */
export async function POST(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as {
    path?: unknown;
    name?: unknown;
    recursive?: unknown;
  };
  const rawPath = typeof body.path === "string" ? body.path : "";
  const name = typeof body.name === "string" ? body.name : "";
  const recursive = body.recursive === true;

  if (!rawPath) {
    return Response.json({ error: "path is required" }, { status: 400 });
  }
  if (name && (name.includes("/") || name.includes("\\") || name === "." || name === "..")) {
    return Response.json({ error: "Invalid folder name" }, { status: 400 });
  }

  const target = name ? join(rawPath, name) : rawPath;

  let dirPath: string;
  try {
    dirPath = await safePath(target);
  } catch (err) {
    if (err instanceof SafePathError) {
      return Response.json({ error: "Access denied", code: "safe_path" }, { status: 403 });
    }
    return Response.json({ error: "Invalid path", code: "invalid_path" }, { status: 400 });
  }

  try {
    await mkdir(dirPath, { recursive });
    return Response.json({ ok: true, path: dirPath }, { status: 201 });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      return Response.json({ error: "Already exists" }, { status: 409 });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to create directory" },
      { status: 500 },
    );
  }
}
