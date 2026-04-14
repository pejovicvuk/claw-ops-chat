import { writeFile } from "fs/promises";
import { resolve } from "path";
import { homedir } from "os";
import { extractBearerToken, validateToken, unauthorized } from "@/lib/auth-server";

export async function POST(request: Request) {
  const token = extractBearerToken(request);
  if (!token || !validateToken(token)) return unauthorized();

  const body = await request.json();
  let filePath = body?.path;
  const content = body?.content;

  if (!filePath || typeof content !== "string") {
    return Response.json({ error: "path and content required" }, { status: 400 });
  }

  if (filePath.startsWith("~")) filePath = filePath.replace("~", homedir());
  filePath = resolve(filePath);

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
