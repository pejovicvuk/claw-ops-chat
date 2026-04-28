import { join } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync } from "fs";
import { extractSession, unauthorized } from "@/lib/auth-server";
import { getAuditWriter } from "@/lib/audit/writer";

export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();
  let v8: typeof import("v8");
  try {
    v8 = await import("v8");
  } catch {
    return Response.json({ error: "v8 module unavailable" }, { status: 500 });
  }
  const dir = join(homedir(), ".monitoring", "heap-snapshots");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filename = `heap-${Date.now()}.heapsnapshot`;
  const path = join(dir, filename);
  try {
    v8.writeHeapSnapshot(path);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "heap snapshot failed" },
      { status: 500 },
    );
  }
  await getAuditWriter()
    .api({
      type: "request_complete",
      severity: "info",
      actor: session.email,
      subject: `monitoring.heap_snapshot → ${filename}`,
      durationMs: null,
      route: "/api/monitoring/actions/heap-snapshot",
      method: "POST",
      statusCode: 200,
      details: { path },
    })
    .catch(() => {});
  return Response.json({ ok: true, path, filename });
}
