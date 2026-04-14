import { rm, stat } from "fs/promises";
import { resolve } from "path";
import { homedir } from "os";
import { extractBearerToken, validateToken, unauthorized } from "@/lib/auth-server";

export async function DELETE(request: Request) {
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
    await rm(filePath, { recursive: s.isDirectory() });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to delete" },
      { status: 500 },
    );
  }
}
