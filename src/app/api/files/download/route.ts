import { readFile, stat } from "fs/promises";
import { resolve, basename } from "path";
import { homedir } from "os";
import { extractBearerToken, validateToken, unauthorized } from "@/lib/auth-server";

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
    await stat(filePath); // verify exists
    const content = await readFile(filePath);
    const name = basename(filePath);

    return new Response(content, {
      headers: {
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Type": "application/octet-stream",
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to download file" },
      { status: 500 },
    );
  }
}
