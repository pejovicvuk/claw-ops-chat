import { extractSession, unauthorized } from "@/lib/auth-server";
import { getAuditWriter } from "@/lib/audit/writer";

export async function POST(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();
  let body: { pid?: unknown; signal?: unknown };
  try {
    body = (await request.json()) as { pid?: unknown; signal?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const pid = typeof body.pid === "number" ? body.pid : Number.parseInt(String(body.pid ?? ""), 10);
  if (!Number.isFinite(pid) || pid <= 1) {
    return Response.json({ error: "pid required (>1)" }, { status: 400 });
  }
  if (pid === process.pid) {
    return Response.json({ error: "Refusing to kill self" }, { status: 400 });
  }
  const signal = typeof body.signal === "string" ? body.signal : "SIGTERM";
  if (!/^SIG(TERM|INT|KILL|HUP|QUIT)$/.test(signal)) {
    return Response.json(
      { error: "signal must be SIGTERM/SIGINT/SIGKILL/SIGHUP/SIGQUIT" },
      { status: 400 },
    );
  }
  try {
    process.kill(pid, signal as NodeJS.Signals);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "kill failed" },
      { status: 500 },
    );
  }
  await getAuditWriter()
    .api({
      type: "request_complete",
      severity: "warn",
      actor: session.email,
      subject: `monitoring.kill_process pid=${pid} signal=${signal}`,
      durationMs: null,
      route: "/api/monitoring/actions/kill-process",
      method: "POST",
      statusCode: 200,
      details: { pid, signal },
    })
    .catch(() => {});
  return Response.json({ ok: true });
}
