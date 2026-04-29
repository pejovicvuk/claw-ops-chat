import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { createProject, listProjects } from "@/lib/projects/store";
import { validateDisplayName } from "@/lib/projects/validation";

/**
 * GET  /api/projects        — list every project (folders containing .project.json)
 * POST /api/projects        — create a project from a free-form display name
 *
 * Single-user auth model: every handler does `extractSession` first.
 * State-changing methods are wrapped with `withAudit` per .claude/rules/api-routes.md.
 */

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  const projects = await listProjects();
  return Response.json({ projects });
}

async function postHandler(request: Request) {
  if (!extractSession(request)) return unauthorized();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const displayName = (body as { displayName?: unknown })?.displayName;
  const validation = validateDisplayName(displayName);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }
  try {
    const project = await createProject(displayName as string);
    return Response.json({ project }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "EEXISTS") {
      return Response.json(
        { error: `Project '${validation.slug}' already exists` },
        { status: 409 },
      );
    }
    throw err;
  }
}

export const POST = withAudit(
  {
    route: "/api/projects",
    label: "Create project",
    subjectFrom: async (req) => {
      try {
        const body = (await req.clone().json()) as { displayName?: unknown };
        return typeof body.displayName === "string" ? body.displayName : null;
      } catch {
        return null;
      }
    },
  },
  postHandler,
);
