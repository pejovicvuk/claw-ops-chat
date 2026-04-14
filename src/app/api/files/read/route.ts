import { readFile, stat } from "fs/promises";
import { resolve } from "path";
import { homedir } from "os";
import { extractBearerToken, validateToken, unauthorized } from "@/lib/auth-server";

const MAX_SIZE = 1024 * 1024; // 1MB

export async function GET(request: Request) {
  const token = extractBearerToken(request);
  if (!token || !validateToken(token)) return unauthorized();

  const url = new URL(request.url);
  let filePath = url.searchParams.get("path");
  if (!filePath) {
    return Response.json({ error: "path parameter required" }, { status: 400 });
  }
  if (filePath.startsWith("~")) filePath = filePath.replace("~", homedir());
  filePath = resolve(filePath);

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
