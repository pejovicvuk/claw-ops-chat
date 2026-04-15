import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { safePath, safeFilename, SafePathError } from "@/lib/safe-path";

/** Maximum upload file size: 10MB */
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

export async function POST(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const url = new URL(request.url);
  const rawDirPath = url.searchParams.get("path") || "~";

  let dirPath: string;
  try {
    dirPath = await safePath(rawDirPath);
  } catch (err) {
    if (err instanceof SafePathError) {
      return Response.json({ error: "Access denied" }, { status: 403 });
    }
    return Response.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_SIZE) {
      return Response.json(
        { error: `File too large (max ${MAX_UPLOAD_SIZE / 1024 / 1024}MB)` },
        { status: 413 },
      );
    }

    // Sanitize filename to prevent path traversal via file.name
    const sanitizedName = safeFilename(file.name);
    if (!sanitizedName || sanitizedName === "." || sanitizedName === "..") {
      return Response.json({ error: "Invalid filename" }, { status: 400 });
    }

    const destPath = join(dirPath, sanitizedName);

    // Validate the final destination path as well
    try {
      await safePath(destPath);
    } catch {
      return Response.json({ error: "Access denied" }, { status: 403 });
    }

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
