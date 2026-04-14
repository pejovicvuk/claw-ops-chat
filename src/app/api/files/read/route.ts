import { readFile, stat } from "fs/promises";
import { extractToken, validateToken, unauthorized } from "@/lib/auth-server";
import { safePath, SafePathError } from "@/lib/safe-path";

const MAX_SIZE = 1024 * 1024; // 1MB

export async function GET(request: Request) {
  const token = extractToken(request);
  if (!token || !validateToken(token)) return unauthorized();

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
      return Response.json({ error: "Access denied" }, { status: 403 });
    }
    return Response.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const s = await stat(filePath);
    if (s.size > MAX_SIZE) {
      return Response.json({ error: "File too large (max 1MB)" }, { status: 413 });
    }

    const content = await readFile(filePath, "utf-8");
    return Response.json({ content, size: s.size });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to read file" },
      { status: 500 },
    );
  }
}
