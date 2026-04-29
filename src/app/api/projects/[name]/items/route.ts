import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { GitExecError } from "@/lib/git/exec";
import { CloneAuthMissingError, scrubCloneStderr } from "@/lib/projects/clone";
import {
  createFolderItem,
  createRepoItem,
  listItems,
  type ItemKind,
} from "@/lib/projects/items-store";
import { projectExists } from "@/lib/projects/store";
import {
  PROJECT_SLUG_RE,
  type RepoKind,
  validateDisplayName,
  validateRepoUrl,
} from "@/lib/projects/validation";

/**
 * GET  /api/projects/[name]/items   — list items inside a project
 * POST /api/projects/[name]/items   — create folder OR clone github/bitbucket repo
 *
 * Single-user auth model: every handler does `extractSession` first.
 * State-changing methods are wrapped with `withAudit` per .claude/rules/api-routes.md.
 *
 * `safePath` is not required: the project + item slugs are gated by
 * `PROJECT_SLUG_RE` BEFORE being joined with `PROJECTS_ROOT`. The regex
 * rejects `..`, `/`, `\`, and null bytes — same rationale documented in
 * `assertProjectSlug`.
 */

type Ctx = { params: Promise<{ name: string }> };

async function resolveProjectSlug(ctx: Ctx): Promise<string | null> {
  const { name } = await ctx.params;
  return PROJECT_SLUG_RE.test(name) ? name : null;
}

export async function GET(request: Request, ctx: Ctx) {
  if (!extractSession(request)) return unauthorized();
  const projectSlug = await resolveProjectSlug(ctx);
  if (!projectSlug) return Response.json({ error: "Invalid project name" }, { status: 400 });
  if (!(await projectExists(projectSlug))) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  const items = await listItems(projectSlug);
  return Response.json({ items });
}

interface FolderBody {
  kind: "folder";
  displayName?: unknown;
}
interface RepoBody {
  kind: RepoKind;
  repoUrl?: unknown;
}
type CreateItemBody = FolderBody | RepoBody;

function isItemKind(value: unknown): value is ItemKind {
  return value === "folder" || value === "github" || value === "bitbucket";
}

async function postHandler(request: Request, ctx: Ctx) {
  if (!extractSession(request)) return unauthorized();
  const projectSlug = await resolveProjectSlug(ctx);
  if (!projectSlug) return Response.json({ error: "Invalid project name" }, { status: 400 });
  if (!(await projectExists(projectSlug))) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const kind = (body as Partial<CreateItemBody>)?.kind;
  if (!isItemKind(kind)) {
    return Response.json({ error: "kind must be folder, github, or bitbucket" }, { status: 400 });
  }

  try {
    if (kind === "folder") {
      const validation = validateDisplayName((body as FolderBody).displayName);
      if (!validation.ok) {
        return Response.json({ error: validation.error }, { status: 400 });
      }
      const item = await createFolderItem(projectSlug, (body as FolderBody).displayName as string);
      return Response.json({ item }, { status: 201 });
    }
    const validation = validateRepoUrl(kind, (body as RepoBody).repoUrl);
    if (!validation.ok) {
      return Response.json({ error: validation.error }, { status: 400 });
    }
    const item = await createRepoItem(
      projectSlug,
      kind,
      validation.repo!,
      validation.normalizedUrl!,
    );
    return Response.json({ item }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "EEXISTS") {
      return Response.json({ error: "Item with that name already exists" }, { status: 409 });
    }
    if (err instanceof CloneAuthMissingError) {
      const label = err.kind === "github" ? "GitHub" : "Bitbucket";
      return Response.json({ error: `${label} is not connected` }, { status: 412 });
    }
    if (err instanceof GitExecError) {
      const message = scrubCloneStderr(err.stderr || err.message);
      return Response.json(
        { error: message ? `Clone failed: ${message}` : "Clone failed" },
        { status: 502 },
      );
    }
    throw err;
  }
}

export const POST = withAudit(
  {
    route: "/api/projects/[name]/items",
    label: "Create project item",
    subjectFrom: async (req) => {
      try {
        const url = new URL(req.url);
        const projectSegment = url.pathname.split("/").filter(Boolean).at(-2) ?? null;
        const body = (await req.clone().json()) as Partial<CreateItemBody>;
        const kind = isItemKind(body.kind) ? body.kind : "?";
        return projectSegment ? `${projectSegment} (${kind})` : null;
      } catch {
        return null;
      }
    },
  },
  postHandler,
);
