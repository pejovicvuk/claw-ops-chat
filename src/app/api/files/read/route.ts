import { readFile, stat } from "fs/promises";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { safePath, SafePathError } from "@/lib/safe-path";
import { withAudit } from "@/lib/audit/api-wrap";

const MAX_SIZE = 1024 * 1024; // 1MB

async function getHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();

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
      return Response.json({ error: "Access denied", code: "safe_path" }, { status: 403 });
    }
    return Response.json({ error: "Invalid path", code: "invalid_path" }, { status: 400 });
  }

  try {
    const s = await stat(filePath);
    if (s.size > MAX_SIZE) {
      return Response.json(
        { error: "File too large (max 1MB)", code: "too_large" },
        { status: 413 },
      );
    }

    const content = await readFile(filePath, "utf-8");
    return Response.json({ content, size: s.size, mtimeMs: s.mtimeMs, path: filePath });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to read file" },
      { status: 500 },
    );
  }
}

export const GET = withAudit(
  {
    route: "/api/files/read",
    auditSuccessGets: true,
    subjectFrom: (req) => new URL(req.url).searchParams.get("path"),
  },
  getHandler,
);
