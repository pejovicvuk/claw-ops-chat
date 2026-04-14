import { readdir, stat } from "fs/promises";
import { join } from "path";
import { extractToken, validateToken, unauthorized } from "@/lib/auth-server";
import { safePath, SafePathError } from "@/lib/safe-path";

export async function GET(request: Request) {
  const token = extractToken(request);
  if (!token || !validateToken(token)) return unauthorized();

  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path") || "~";

  let dirPath: string;
  try {
    dirPath = await safePath(rawPath);
  } catch (err) {
    if (err instanceof SafePathError) {
      return Response.json({ error: "Access denied" }, { status: 403 });
    }
    return Response.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const results = await Promise.all(
      entries
        .filter((e) => !e.name.startsWith("."))
        .map(async (entry) => {
          const fullPath = join(dirPath, entry.name);
          const isDir = entry.isDirectory();
          let size = 0;
          try {
            if (!isDir) {
              const s = await stat(fullPath);
              size = s.size;
            }
          } catch { /* skip */ }
          return { name: entry.name, path: fullPath, directory: isDir, size };
        }),
    );

    // Directories first, then alphabetical
    results.sort((a, b) => {
      if (a.directory !== b.directory) return a.directory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return Response.json(results);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to list directory" },
      { status: 500 },
    );
  }
}
