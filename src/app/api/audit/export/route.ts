import { extractSession, unauthorized } from "@/lib/auth-server";
import { exportEvents } from "@/lib/audit/reader";
import type { AuditCategory, AuditFilter } from "@/lib/audit/types";

const VALID_CATEGORIES = new Set<AuditCategory>(["api", "cron", "session"]);

/**
 * Streams audit events in the requested range as NDJSON with a download
 * filename. Same filter vocabulary as `/api/audit/events` minus cursor/limit.
 */
export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();
  const url = new URL(request.url);
  const filter: AuditFilter = {};

  const categoryRaw = url.searchParams.get("category");
  if (categoryRaw) {
    const parts = categoryRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const parsed: AuditCategory[] = [];
    for (const p of parts) {
      if (VALID_CATEGORIES.has(p as AuditCategory)) parsed.push(p as AuditCategory);
    }
    if (parsed.length > 0) filter.category = parsed;
  }
  const from = url.searchParams.get("from");
  if (from) {
    const n = Number.parseInt(from, 10);
    if (Number.isFinite(n)) filter.from = n;
  }
  const to = url.searchParams.get("to");
  if (to) {
    const n = Number.parseInt(to, 10);
    if (Number.isFinite(n)) filter.to = n;
  }

  const stream = new ReadableStream({
    async pull(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const line of exportEvents(filter)) {
          controller.enqueue(encoder.encode(line));
        }
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
  });

  const date = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": `attachment; filename="audit-${date}.jsonl"`,
      "Cache-Control": "no-store",
    },
  });
}
