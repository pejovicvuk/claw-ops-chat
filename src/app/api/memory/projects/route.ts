import { extractSession, unauthorized } from "@/lib/auth-server";
import { sdkMemoryDirForProjectSlug } from "@/lib/memory/paths";
import { totalMemoryBytes } from "@/lib/memory/store";
import { listProjects } from "@/lib/projects/store";

/**
 * GET /api/memory/projects — list every project plus the byte total of
 * the SDK auto-memory directory the Claude Agent SDK maintains for it.
 */
export async function GET(request: Request): Promise<Response> {
  if (!extractSession(request)) return unauthorized();
  const projects = await listProjects();
  const rows = await Promise.all(
    projects.map(async (project) => {
      const dir = sdkMemoryDirForProjectSlug(project.slug);
      const totalBytes = await totalMemoryBytes(dir);
      return {
        slug: project.slug,
        displayName: project.displayName,
        createdAt: project.createdAt,
        memoryBytes: totalBytes,
        memoryDir: dir,
      };
    }),
  );
  return Response.json({ projects: rows });
}
