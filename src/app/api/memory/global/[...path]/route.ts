import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { globalMemoryDir } from "@/lib/memory/paths";
import { deleteMemoryFile, readMemoryFile, writeMemoryFile } from "@/lib/memory/store";
import { MemoryValidationError } from "@/lib/memory/validation";

type Params = { params: Promise<{ path: string[] }> };

function joinSegments(segments: string[]): string {
  // Catch-all params arrive as URL-decoded segments. Re-join with '/'
  // so the value matches MEMORY_PATH_RE exactly.
  return segments.join("/");
}

function jsonError(err: unknown): Response {
  if (err instanceof MemoryValidationError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return Response.json({ error: "Memory operation failed" }, { status: 500 });
}

export async function GET(request: Request, ctx: Params): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const { path } = await ctx.params;
  try {
    const record = await readMemoryFile(globalMemoryDir(), joinSegments(path));
    return Response.json(record);
  } catch (err) {
    return jsonError(err);
  }
}

async function putHandler(request: Request, ctx: Params): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const { path } = await ctx.params;
  let body: { content?: unknown };
  try {
    body = (await request.json()) as { content?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return Response.json({ error: "content must be a string" }, { status: 400 });
  }
  try {
    const record = await writeMemoryFile(globalMemoryDir(), joinSegments(path), body.content);
    return Response.json(record);
  } catch (err) {
    return jsonError(err);
  }
}

async function deleteHandler(request: Request, ctx: Params): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const { path } = await ctx.params;
  try {
    await deleteMemoryFile(globalMemoryDir(), joinSegments(path));
    return new Response(null, { status: 204 });
  } catch (err) {
    return jsonError(err);
  }
}

export const PUT = withAudit(
  {
    route: "/api/memory/global/[...path]",
    label: "Update global memory",
    subjectFrom: async (req) => {
      try {
        return new URL(req.url).pathname.split("/global/").pop() ?? null;
      } catch {
        return null;
      }
    },
  },
  putHandler,
);

export const DELETE = withAudit(
  {
    route: "/api/memory/global/[...path]",
    label: "Delete global memory",
    subjectFrom: async (req) => {
      try {
        return new URL(req.url).pathname.split("/global/").pop() ?? null;
      } catch {
        return null;
      }
    },
  },
  deleteHandler,
);
