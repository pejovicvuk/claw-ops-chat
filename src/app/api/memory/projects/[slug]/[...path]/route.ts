import { mkdir } from "fs/promises";

import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { sdkMemoryDirForProjectSlug } from "@/lib/memory/paths";
import { deleteMemoryFile, readMemoryFile, writeMemoryFile } from "@/lib/memory/store";
import { MemoryValidationError } from "@/lib/memory/validation";
import { PROJECT_SLUG_RE } from "@/lib/projects/validation";
import { projectExists } from "@/lib/projects/store";

type Params = { params: Promise<{ slug: string; path: string[] }> };

function joinSegments(segments: string[]): string {
  return segments.join("/");
}

function jsonError(err: unknown): Response {
  if (err instanceof MemoryValidationError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return Response.json({ error: "Memory operation failed" }, { status: 500 });
}

async function resolveDir(slug: string): Promise<string | Response> {
  if (!PROJECT_SLUG_RE.test(slug)) {
    return Response.json({ error: "Invalid project slug" }, { status: 400 });
  }
  if (!(await projectExists(slug))) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  return sdkMemoryDirForProjectSlug(slug);
}

export async function GET(request: Request, ctx: Params): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const { slug, path } = await ctx.params;
  const dir = await resolveDir(slug);
  if (typeof dir !== "string") return dir;
  try {
    const record = await readMemoryFile(dir, joinSegments(path));
    return Response.json(record);
  } catch (err) {
    return jsonError(err);
  }
}

async function putHandler(request: Request, ctx: Params): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const { slug, path } = await ctx.params;
  const dir = await resolveDir(slug);
  if (typeof dir !== "string") return dir;
  let body: { content?: unknown };
  try {
    body = (await request.json()) as { content?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return Response.json({ error: "content must be a string" }, { status: 400 });
  }
  // Per-project memory dirs are SDK-owned and may not exist on the user's
  // first manual edit. Create them lazily here so the write succeeds.
  await mkdir(dir, { recursive: true });
  try {
    const record = await writeMemoryFile(dir, joinSegments(path), body.content);
    return Response.json(record);
  } catch (err) {
    return jsonError(err);
  }
}

async function deleteHandler(request: Request, ctx: Params): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const { slug, path } = await ctx.params;
  const dir = await resolveDir(slug);
  if (typeof dir !== "string") return dir;
  try {
    await deleteMemoryFile(dir, joinSegments(path));
    return new Response(null, { status: 204 });
  } catch (err) {
    return jsonError(err);
  }
}

export const PUT = withAudit(
  {
    route: "/api/memory/projects/[slug]/[...path]",
    label: "Update project memory",
    subjectFrom: async (req) => {
      try {
        return new URL(req.url).pathname.split("/projects/").pop() ?? null;
      } catch {
        return null;
      }
    },
  },
  putHandler,
);

export const DELETE = withAudit(
  {
    route: "/api/memory/projects/[slug]/[...path]",
    label: "Delete project memory",
    subjectFrom: async (req) => {
      try {
        return new URL(req.url).pathname.split("/projects/").pop() ?? null;
      } catch {
        return null;
      }
    },
  },
  deleteHandler,
);
