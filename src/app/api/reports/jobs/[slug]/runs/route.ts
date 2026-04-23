import { extractSession, unauthorized } from "@/lib/auth-server";
import { listRunsForJob } from "@/lib/reports/run-store";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

type Params = { params: Promise<{ slug: string }> };

export async function GET(request: Request, ctx: Params) {
  if (!extractSession(request)) return unauthorized();
  const { slug } = await ctx.params;
  if (!SLUG_RE.test(slug)) {
    return Response.json({ error: "Invalid slug" }, { status: 400 });
  }
  const runs = await listRunsForJob(slug);
  return Response.json({ runs });
}
