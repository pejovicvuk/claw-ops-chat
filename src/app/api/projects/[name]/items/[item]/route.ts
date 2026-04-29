import { extractSession, unauthorized } from "@/lib/auth-server";
import { withAudit } from "@/lib/audit/api-wrap";
import { deleteItem, itemExists, readItemMeta } from "@/lib/projects/items-store";
import { projectExists } from "@/lib/projects/store";
import { PROJECT_SLUG_RE } from "@/lib/projects/validation";

/**
 * GET    /api/projects/[name]/items/[item]   — fetch one item's metadata
 * DELETE /api/projects/[name]/items/[item]   — recursively remove the item folder
 */

type Ctx = { params: Promise<{ name: string; item: string }> };

interface Resolved {
  projectSlug: string;
  itemSlug: string;
}

async function resolveSlugs(ctx: Ctx): Promise<Resolved | null> {
  const { name, item } = await ctx.params;
  if (!PROJECT_SLUG_RE.test(name) || !PROJECT_SLUG_RE.test(item)) return null;
  return { projectSlug: name, itemSlug: item };
}

export async function GET(request: Request, ctx: Ctx) {
  if (!extractSession(request)) return unauthorized();
  const resolved = await resolveSlugs(ctx);
  if (!resolved) return Response.json({ error: "Invalid name" }, { status: 400 });
  if (!(await projectExists(resolved.projectSlug))) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  const item = await readItemMeta(resolved.projectSlug, resolved.itemSlug);
  if (!item) return Response.json({ error: "Item not found" }, { status: 404 });
  return Response.json({ item });
}

async function deleteHandler(request: Request, ctx: Ctx) {
  if (!extractSession(request)) return unauthorized();
  const resolved = await resolveSlugs(ctx);
  if (!resolved) return Response.json({ error: "Invalid name" }, { status: 400 });
  if (!(await projectExists(resolved.projectSlug))) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  if (!(await itemExists(resolved.projectSlug, resolved.itemSlug))) {
    return Response.json({ error: "Item not found" }, { status: 404 });
  }
  await deleteItem(resolved.projectSlug, resolved.itemSlug);
  return new Response(null, { status: 204 });
}

export const DELETE = withAudit(
  {
    route: "/api/projects/[name]/items/[item]",
    label: "Delete project item",
    subjectFrom: async (req) => {
      try {
        const segments = new URL(req.url).pathname.split("/").filter(Boolean);
        const item = segments.at(-1);
        const project = segments.at(-3);
        if (!project || !item) return null;
        return `${decodeURIComponent(project)}/${decodeURIComponent(item)}`;
      } catch {
        return null;
      }
    },
  },
  deleteHandler,
);
