import { mkdir } from "fs/promises";

import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { sdkMemoryDirForProjectSlug } from "@/lib/memory/paths";
import { listMemoryFiles, totalMemoryBytes, writeMemoryFile } from "@/lib/memory/store";
import { MemoryValidationError } from "@/lib/memory/validation";
import { PROJECT_SLUG_RE } from "@/lib/projects/validation";
import { projectExists } from "@/lib/projects/store";

type Params = { params: Promise<{ slug: string }> };

/**
 * GET /api/memory/projects/[slug] — list memory files for one project.
 * The SDK owns the directory and may not have created it yet; we return
 * an empty list rather than 404 so the UI renders cleanly for a brand
 * new project. Mirrors the `items` projection used by the shared editor.
 *
 * POST /api/memory/projects/[slug] — create a memory file under that
 * project, lazily creating the SDK directory if needed.
 */
export async function GET(request: Request, ctx: Params): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const { slug } = await ctx.params;
  if (!PROJECT_SLUG_RE.test(slug)) {
    return Response.json({ error: "Invalid project slug" }, { status: 400 });
  }
  if (!(await projectExists(slug))) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  const dir = sdkMemoryDirForProjectSlug(slug);
  const [files, totalBytes] = await Promise.all([listMemoryFiles(dir), totalMemoryBytes(dir)]);
  const items = files.map((f) => ({
    name: f.path,
    preview: f.preview,
    size: f.size,
    updatedAt: f.updatedAt,
  }));
  return Response.json({ slug, files, items, totalBytes, memoryDir: dir });
}

async function postHandler(request: Request, ctx: Params): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const { slug } = await ctx.params;
  if (!PROJECT_SLUG_RE.test(slug)) {
    return Response.json({ error: "Invalid project slug" }, { status: 400 });
  }
  if (!(await projectExists(slug))) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  let body: { name?: unknown; content?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; content?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.name !== "string" || typeof body.content !== "string") {
    return Response.json({ error: "name and content are required" }, { status: 400 });
  }
  const dir = sdkMemoryDirForProjectSlug(slug);
  await mkdir(dir, { recursive: true });
  try {
    const record = await writeMemoryFile(dir, body.name, body.content);
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
    route: "/api/memory/projects/[slug]",
    label: "Create project memory",
    subjectFrom: async (req) => {
      try {
        const body = (await req.clone().json()) as { name?: unknown };
        const last = new URL(req.url).pathname.split("/projects/").pop() ?? null;
        return typeof body.name === "string" ? `${last}/${body.name}` : last;
      } catch {
        return null;
      }
    },
  },
  postHandler,
);
