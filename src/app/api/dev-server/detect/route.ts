import { extractSession, unauthorized } from "@/lib/auth-server";
import { detectFramework } from "@/lib/dev-server/detect-framework";
import { itemDir } from "@/lib/projects/paths";
import { PROJECT_SLUG_RE } from "@/lib/projects/validation";

/**
 * GET /api/dev-server/detect?projectSlug=...&itemSlug=...
 *
 * Inspects the item folder's `package.json` and returns
 * `{ framework, defaultPort, runSpec }`. Used by the PreviewWindow
 * to populate the framework chip + pre-fill the port input on first
 * render. Read-only; no audit by default.
 */

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const url = new URL(request.url);
  const projectSlug = url.searchParams.get("projectSlug") ?? "";
  const itemSlug = url.searchParams.get("itemSlug") ?? "";
  if (!PROJECT_SLUG_RE.test(projectSlug) || !PROJECT_SLUG_RE.test(itemSlug)) {
    return Response.json({ error: "Invalid projectSlug or itemSlug" }, { status: 400 });
  }

  const result = await detectFramework(itemDir(projectSlug, itemSlug));
  return Response.json(result);
}
