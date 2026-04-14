import { writeFile, mkdir } from "fs/promises";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import { extractBearerToken, validateToken, unauthorized } from "@/lib/auth-server";

export async function POST(request: Request) {
  const token = extractBearerToken(request);
  if (!token || !validateToken(token)) return unauthorized();

  const url = new URL(request.url);
  let dirPath = url.searchParams.get("path") || "~";
  if (dirPath === "~") dirPath = homedir();
  dirPath = resolve(dirPath);

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    const destPath = join(dirPath, file.name);
    await mkdir(dirname(destPath), { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(destPath, buffer);

    return Response.json({ ok: true, path: destPath });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to upload file" },
      { status: 500 },
    );
  }
}
