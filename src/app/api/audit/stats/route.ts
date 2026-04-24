import { extractSession, unauthorized } from "@/lib/auth-server";
import { getStats } from "@/lib/audit/reader";

export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  const url = new URL(request.url);
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const range: { from?: number; to?: number } = {};
  if (fromRaw) {
    const n = Number.parseInt(fromRaw, 10);
    if (Number.isFinite(n)) range.from = n;
  }
  if (toRaw) {
    const n = Number.parseInt(toRaw, 10);
    if (Number.isFinite(n)) range.to = n;
  }
  try {
    const stats = await getStats(range);
    return Response.json(stats);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load stats" },
      { status: 500 },
    );
  }
}
