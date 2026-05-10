import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { ensureMemoryTree, globalMemoryDir } from "@/lib/memory/paths";
import { listMemoryFiles, totalMemoryBytes, writeMemoryFile } from "@/lib/memory/store";
import { MemoryValidationError } from "@/lib/memory/validation";

/**
 * GET /api/memory/global — list every global memory file plus total
 * byte count for the cap progress UI. Returns both `files` (the rich
 * shape used by the Memory page) and `items` (a `MarkdownItem`-shaped
 * projection consumed by the shared `MarkdownFileEditor`).
 *
 * POST /api/memory/global — create a memory file from `{name, content}`.
 */
export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const dir = globalMemoryDir();
  const [files, totalBytes] = await Promise.all([listMemoryFiles(dir), totalMemoryBytes(dir)]);
  const items = files.map((f) => ({
    name: f.path,
    preview: f.preview,
    size: f.size,
    updatedAt: f.updatedAt,
  }));
  return Response.json({ files, items, totalBytes });
}

async function postHandler(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  let body: { name?: unknown; content?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; content?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.name !== "string" || typeof body.content !== "string") {
    return Response.json({ error: "name and content are required" }, { status: 400 });
  }
  await ensureMemoryTree();
  try {
    const record = await writeMemoryFile(globalMemoryDir(), body.name, body.content);
    return Response.json(record, { status: 201 });
  } catch (err) {
    if (err instanceof MemoryValidationError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json({ error: "Failed to create memory file" }, { status: 500 });
  }
}

export const POST = withAudit(
  {
    route: "/api/memory/global",
    label: "Create global memory",
    subjectFrom: async (req) => {
      try {
        const body = (await req.clone().json()) as { name?: unknown };
        return typeof body.name === "string" ? body.name : null;
      } catch {
        return null;
      }
    },
  },
  postHandler,
);
