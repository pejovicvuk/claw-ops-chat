import { access, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { safePath, safeFilename, SafePathError } from "@/lib/safe-path";

/**
 * Maximum upload file size. Configurable via MAX_UPLOAD_MB (default 100 MB).
 * Node/Next multipart parser handles files up to ~512 MB on a typical host,
 * but this cap protects disk and surfaces a clear error early.
 */
const MAX_UPLOAD_SIZE = (() => {
  const raw = process.env.MAX_UPLOAD_MB;
  const mb = raw ? Number.parseInt(raw, 10) : NaN;
  const resolved = Number.isFinite(mb) && mb > 0 ? mb : 100;
  return resolved * 1024 * 1024;
})();

export async function POST(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const url = new URL(request.url);
  const rawDirPath = url.searchParams.get("path") || "~";

  let dirPath: string;
  try {
    dirPath = await safePath(rawDirPath);
  } catch (err) {
    if (err instanceof SafePathError) {
      return Response.json({ error: "Access denied", code: "safe_path" }, { status: 403 });
    }
    return Response.json({ error: "Invalid path", code: "invalid_path" }, { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return Response.json({ error: "No file provided", code: "no_file" }, { status: 400 });
    }

    // Belt-and-braces folder reject. Browsers represent a dragged folder as
    // a File-ish entry with size 0 and empty MIME type; genuine empty files
    // keep their extension so the combined check is a reliable rule of
    // thumb. The primary defense is the client-side webkitGetAsEntry check.
    if (file.size === 0 && file.type === "" && !file.name.includes(".")) {
      return Response.json(
        { error: "Folders cannot be uploaded — drag individual files", code: "folder_reject" },
        { status: 400 },
      );
    }

    if (file.size > MAX_UPLOAD_SIZE) {
      return Response.json(
        {
          error: `File too large (max ${Math.floor(MAX_UPLOAD_SIZE / 1024 / 1024)} MB)`,
          code: "too_large",
        },
        { status: 413 },
      );
    }

    // Sanitize filename to prevent path traversal via file.name
    const sanitizedName = safeFilename(file.name);
    if (!sanitizedName || sanitizedName === "." || sanitizedName === "..") {
      return Response.json(
        { error: "Invalid filename", code: "invalid_filename" },
        { status: 400 },
      );
    }

    const destPath = join(dirPath, sanitizedName);

    // Validate the final destination path as well
    try {
      await safePath(destPath);
    } catch {
      return Response.json({ error: "Access denied", code: "safe_path" }, { status: 403 });
    }

    // Detect an existing file for the overwritten flag in the response.
    let overwritten = false;
    try {
      await access(destPath);
      overwritten = true;
    } catch {
      /* destination does not exist — not an overwrite */
    }

    await mkdir(dirname(destPath), { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(destPath, buffer);

    return Response.json({ ok: true, path: destPath, overwritten });
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Failed to upload file",
        code: "upload_failed",
      },
      { status: 500 },
    );
  }
}
