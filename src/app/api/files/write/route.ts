import { writeFile } from "fs/promises";
import { extractToken, validateToken, unauthorized } from "@/lib/auth-server";
import { safePath, SafePathError } from "@/lib/safe-path";

export async function POST(request: Request) {
  const token = extractToken(request);
  if (!token || !validateToken(token)) return unauthorized();

  const body = await request.json();
  const rawPath = body?.path;
  const content = body?.content;

  if (!rawPath || typeof content !== "string") {
    return Response.json({ error: "path and content required" }, { status: 400 });
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
    await writeFile(filePath, content, "utf-8");
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to write file" },
      { status: 500 },
    );
  }
}
