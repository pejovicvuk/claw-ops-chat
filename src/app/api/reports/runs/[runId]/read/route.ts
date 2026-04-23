import { extractSession, unauthorized } from "@/lib/auth-server";
import { setIndexReadAt } from "@/lib/reports/run-store";

const RUN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z?$/;

type Params = { params: Promise<{ runId: string }> };

export async function POST(request: Request, ctx: Params) {
  if (!extractSession(request)) return unauthorized();
  const { runId } = await ctx.params;
  if (!RUN_ID_RE.test(runId)) {
    return Response.json({ error: "Invalid runId" }, { status: 400 });
  }
  // Body may specify { read: false } to mark as unread; default is read.
  let read = true;
  try {
    const body = (await request.json()) as { read?: boolean };
    if (typeof body?.read === "boolean") read = body.read;
  } catch {
    /* empty body is fine */
  }
  await setIndexReadAt(runId, read ? Date.now() : null);
  return Response.json({ ok: true, readAt: read ? Date.now() : null });
}
