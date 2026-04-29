import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { PROJECT_SLUG_RE } from "@/lib/projects/validation";
import { deleteProject, projectExists, readProjectMeta } from "@/lib/projects/store";

/**
 * GET    /api/projects/[name]  — fetch metadata for one project
 * DELETE /api/projects/[name]  — recursively remove the project folder
 */

type Params = { params: Promise<{ name: string }> };

async function resolveSlug(ctx: Params): Promise<string | null> {
  const { name } = await ctx.params;
  return PROJECT_SLUG_RE.test(name) ? name : null;
}

export async function GET(request: Request, ctx: Params) {
  if (!extractSession(request)) return unauthorized();
  const slug = await resolveSlug(ctx);
  if (!slug) return Response.json({ error: "Invalid name" }, { status: 400 });
  const project = await readProjectMeta(slug);
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ project });
}

async function deleteHandler(request: Request, ctx: Params) {
  if (!extractSession(request)) return unauthorized();
  const slug = await resolveSlug(ctx);
  if (!slug) return Response.json({ error: "Invalid name" }, { status: 400 });
  if (!(await projectExists(slug))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  await deleteProject(slug);
  return new Response(null, { status: 204 });
}

export const DELETE = withAudit(
  {
    route: "/api/projects/[name]",
    label: "Delete project",
    subjectFrom: async (req) => {
      try {
        const last = new URL(req.url).pathname.split("/").pop();
        return last ? decodeURIComponent(last) : null;
      } catch {
        return null;
      }
    },
  },
  deleteHandler,
);
