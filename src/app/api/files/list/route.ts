import { readdir, stat } from "fs/promises";
import { join, resolve } from "path";
import { homedir } from "os";
import { extractBearerToken, validateToken, unauthorized } from "@/lib/auth-server";

export async function GET(request: Request) {
  const token = extractBearerToken(request);
  if (!token || !validateToken(token)) return unauthorized();

  const url = new URL(request.url);
  let dirPath = url.searchParams.get("path") || "~";
  if (dirPath === "~") dirPath = homedir();
  dirPath = resolve(dirPath);

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
