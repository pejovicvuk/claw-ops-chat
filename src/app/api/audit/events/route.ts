import { extractSession, unauthorized } from "@/lib/auth-server";
import { listEvents } from "@/lib/audit/reader";
import { purgeOldAuditFiles } from "@/lib/audit/retention";
import type { AuditCategory, AuditFilter, AuditSeverity } from "@/lib/audit/types";
import { getAuditWriter } from "@/lib/audit/writer";

const VALID_CATEGORIES = new Set<AuditCategory>(["api", "cron", "session"]);
const VALID_SEVERITIES = new Set<AuditSeverity>(["info", "warn", "error"]);

/**
 * Paginated audit event list. Newest first. Cursor is opaque.
 *
 * Query params:
 *   category  — comma-separated list of audit categories
 *   severity  — comma-separated list of severities
 *   from, to  — ms epoch bounds (inclusive)
 *   q         — substring search in subject/actor/route
 *   cursor    — opaque cursor from the previous page's nextCursor
 *   limit     — max per page (default 100, max 500)
 */
export async function GET(request: Request) {
  if (!extractSession(request)) return unauthorized();

  const url = new URL(request.url);
  const filter = parseFilter(url);
  const cursor = url.searchParams.get("cursor") ?? undefined;

  try {
    const page = await listEvents(filter, cursor);
    return Response.json(page);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to list audit events" },
      { status: 500 },
    );
  }
}

/**
 * Bulk delete.
 *   ?olderThan=<ms epoch> — delete files whose date is older than this
 *   ?category=<cat>       — restrict to one category
 *   (no params)           — deletes everything (requires typed-confirm UI)
 */
export async function DELETE(request: Request) {
  const session = extractSession(request);
  if (!session) return unauthorized();

  const url = new URL(request.url);
  const categoryParam = url.searchParams.get("category");
  const olderThanParam = url.searchParams.get("olderThan");

  const category = categoryParam ? parseCategory(categoryParam) : undefined;
  if (categoryParam && !category) {
    return Response.json({ error: "Invalid category" }, { status: 400 });
  }

  let maxAgeMs: number;
  if (olderThanParam === null) {
    // No olderThan → delete everything in the scoped category (or all).
    maxAgeMs = 0;
  } else {
    const olderThan = Number.parseInt(olderThanParam, 10);
    if (!Number.isFinite(olderThan) || olderThan < 0) {
      return Response.json({ error: "Invalid olderThan" }, { status: 400 });
    }
    // olderThan is a cutoff timestamp (events before this are deleted).
    // Convert to "max age in ms" relative to now.
    maxAgeMs = Math.max(0, Date.now() - olderThan);
  }

  try {
    const result = await purgeOldAuditFiles(maxAgeMs, category);
    // Record the deletion as its own audit event so the act of clearing
    // logs is itself auditable.
    await getAuditWriter()
      .api({
        type: "request_complete",
        severity: "warn",
        actor: session.email,
        subject: `DELETE /api/audit/events — purged ${result.deleted.length} file(s)`,
        durationMs: null,
        route: "/api/audit/events",
        method: "DELETE",
        statusCode: 200,
        target: category,
        details: { deleted: result.deleted.slice(0, 20), bytesFreed: result.bytesFreed },
      })
      .catch(() => {});
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to purge" },
      { status: 500 },
    );
  }
}

function parseFilter(url: URL): AuditFilter {
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
  const severityRaw = url.searchParams.get("severity");
  if (severityRaw) {
    const parts = severityRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const parsed: AuditSeverity[] = [];
    for (const p of parts) {
      if (VALID_SEVERITIES.has(p as AuditSeverity)) parsed.push(p as AuditSeverity);
    }
    if (parsed.length > 0) filter.severity = parsed;
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
  const q = url.searchParams.get("q");
  if (q && q.trim().length > 0) filter.q = q.trim();
  const limit = url.searchParams.get("limit");
  if (limit) {
    const n = Number.parseInt(limit, 10);
    if (Number.isFinite(n)) filter.limit = n;
  }
  return filter;
}

function parseCategory(raw: string): AuditCategory | null {
  return VALID_CATEGORIES.has(raw as AuditCategory) ? (raw as AuditCategory) : null;
}
