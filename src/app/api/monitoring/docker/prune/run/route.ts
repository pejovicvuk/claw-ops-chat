import { extractSession, unauthorized } from "@/lib/auth-server";
import { runDockerPrune } from "@/lib/monitoring/docker-prune";

export async function POST(request: Request): Promise<Response> {
  const session = extractSession(request);
  if (!session) return unauthorized();
  try {
    const result = await runDockerPrune(session.email);
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Prune failed" },
      { status: 500 },
    );
  }
}
