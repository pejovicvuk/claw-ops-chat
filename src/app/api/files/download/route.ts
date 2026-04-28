import { readFile, stat } from "fs/promises";
import { basename } from "path";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { safePath, SafePathError } from "@/lib/safe-path";
import { withAudit } from "@/lib/audit/api-wrap";

/**
 * Encode a filename for Content-Disposition header per RFC 5987.
 * Uses both filename= (ASCII fallback) and filename*= (UTF-8 encoded).
 */
function contentDisposition(name: string): string {
  // Strip control characters and quotes for the ASCII fallback
  const asciiSafe = name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, '\\"');
  // RFC 5987 percent-encode for filename*
  const encoded = encodeURIComponent(name).replace(/'/g, "%27");
  return `attachment; filename="${asciiSafe}"; filename*=UTF-8''${encoded}`;
}

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
    await stat(filePath); // verify exists
    const content = await readFile(filePath);
    const name = basename(filePath);

    return new Response(content, {
      headers: {
        "Content-Disposition": contentDisposition(name),
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

export const GET = withAudit(
  {
    route: "/api/files/download",
    auditSuccessGets: true,
    subjectFrom: (req) => new URL(req.url).searchParams.get("path"),
  },
  getHandler,
);
