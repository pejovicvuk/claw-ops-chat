import { rm, stat } from "fs/promises";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { safePath, SafePathError } from "@/lib/safe-path";

/** Maximum number of entries in a directory before recursive delete is refused. */
const MAX_RECURSIVE_ENTRIES = 100;

export async function DELETE(request: Request) {
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

    if (s.isDirectory()) {
      // Guard: require explicit ?recursive=true query param for directories
      const recursive = url.searchParams.get("recursive") === "true";
      if (!recursive) {
        return Response.json(
          { error: "Cannot delete directory without ?recursive=true" },
          { status: 400 },
        );
      }

      // Guard: refuse to delete large directory trees
      const { readdir } = await import("fs/promises");
      const entries = await readdir(filePath);
      if (entries.length > MAX_RECURSIVE_ENTRIES) {
        return Response.json(
          {
            error: `Directory has ${entries.length} entries (max ${MAX_RECURSIVE_ENTRIES}). Refusing recursive delete for safety.`,
          },
          { status: 400 },
        );
      }
    }

    await rm(filePath, { recursive: s.isDirectory() });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to delete" },
      { status: 500 },
    );
  }
}
