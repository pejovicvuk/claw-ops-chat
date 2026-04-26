import { extractSession, unauthorized } from "@/lib/auth-server";
import { getMetricsCollector } from "@/lib/monitoring/singleton";
import { getDockerodeClient } from "@/lib/monitoring/collectors/docker";

interface DockerodeLogContainer {
  logs(opts: {
    stdout: boolean;
    stderr: boolean;
    tail: number;
    timestamps: boolean;
    follow: false;
  }): Promise<Buffer | string>;
}

interface DockerLogClient {
  getContainer(id: string): DockerodeLogContainer;
}

const ID_RE = /^[a-zA-Z0-9_.-]{1,200}$/;

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!extractSession(request)) return unauthorized();
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) {
    return Response.json({ error: "Invalid container id" }, { status: 400 });
  }
  const url = new URL(request.url);
  const tail = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("tail") ?? "200", 10) || 200, 1),
    1000,
  );
  const collector = getMetricsCollector();
  const docker = collector?.getDocker();
  if (!collector || !docker?.available) {
    return Response.json({ error: "Docker not configured" }, { status: 400 });
  }
  // Reuse the cached collector connection.
  const dockerCollectorState = (
    collector as unknown as {
      docker: { client: DockerLogClient | null; available: boolean; reason?: string };
    }
  ).docker;
  const cli = await getDockerodeClient(dockerCollectorState as never);
  if (!cli) {
    return Response.json(
      { error: dockerCollectorState.reason ?? "Docker unavailable" },
      { status: 400 },
    );
  }
  let logs: Buffer | string;
  try {
    logs = await (cli as unknown as DockerLogClient).getContainer(id).logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
      follow: false,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "logs read failed" },
      { status: 500 },
    );
  }
  // Docker multiplexes stdout/stderr with an 8-byte header per chunk; strip them.
  const text = typeof logs === "string" ? logs : stripDockerLogHeaders(logs);
  return Response.json({ id, lines: text.split("\n").filter((l) => l.length > 0) });
}

function stripDockerLogHeaders(buf: Buffer): string {
  const out: string[] = [];
  let pos = 0;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos + 4);
    pos += 8;
    if (pos + len > buf.length) break;
    out.push(buf.slice(pos, pos + len).toString("utf-8"));
    pos += len;
  }
  return out.join("");
}
