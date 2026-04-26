import { existsSync } from "fs";
import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import { AUDIT_CATEGORIES, RETENTION_DAYS, categoryDir, parseDailyFileName } from "./paths";
import { readAuditMeta } from "./writer";
import type {
  AuditCategory,
  AuditEvent,
  AuditEventPage,
  AuditFilter,
  AuditSeverity,
  AuditStats,
} from "./types";

/**
 * Read / list / stat audit events. Files are frozen the moment the UTC
 * date rolls over (writer only appends to *today's* file), so descending
 * iteration is stable under concurrent writes for anything except the
 * current day — and for the current day we snapshot a per-file size up
 * front and only read up to that byte count.
 */

const EVENT_ID_RE = /^(\d{4}-\d{2}-\d{2}):(\d+)$/;

/** List daily files for a category, newest first, with size snapshots. */
async function listDailyFiles(
  category: AuditCategory,
): Promise<Array<{ name: string; date: number; size: number }>> {
  const dir = categoryDir(category);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir).catch(() => [] as string[]);
  const out: Array<{ name: string; date: number; size: number }> = [];
  for (const name of entries) {
    const date = parseDailyFileName(name);
    if (date === null) continue;
    try {
      const s = await stat(join(dir, name));
      out.push({ name, date, size: s.size });
    } catch {
      /* race: purge ran, skip */
    }
  }
  out.sort((a, b) => b.date - a.date);
  return out;
}

function parseLine(line: string): AuditEvent | null {
  try {
    const obj = JSON.parse(line) as AuditEvent;
    if (!obj || typeof obj !== "object") return null;
    if (
      obj.category !== "api" &&
      obj.category !== "cron" &&
      obj.category !== "session" &&
      obj.category !== "alert"
    )
      return null;
    return obj;
  } catch {
    return null;
  }
}

function matches(event: AuditEvent, filter: AuditFilter): boolean {
  if (filter.category && filter.category.length > 0 && !filter.category.includes(event.category)) {
    return false;
  }
  if (filter.severity && filter.severity.length > 0 && !filter.severity.includes(event.severity)) {
    return false;
  }
  if (typeof filter.from === "number" && event.at < filter.from) return false;
  if (typeof filter.to === "number" && event.at > filter.to) return false;
  if (filter.q) {
    const needle = filter.q.toLowerCase();
    const haystack = [
      event.subject,
      event.actor,
      (event as { route?: string }).route ?? "",
      (event as { toolName?: string }).toolName ?? "",
      (event as { slug?: string }).slug ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/** Enumerate events in a category from newest to oldest, yielding `{ event, id }`. */
async function* iterateCategoryEvents(
  category: AuditCategory,
  startCursor?: { date: string; offset: number },
): AsyncGenerator<{ event: AuditEvent; id: string; date: string; offset: number }> {
  const files = await listDailyFiles(category);
  for (const file of files) {
    if (startCursor && file.name.slice(0, 10) > startCursor.date) continue;
    let raw: string;
    try {
      raw = await readFile(join(categoryDir(category), file.name), "utf-8");
    } catch {
      continue;
    }
    // Build a list of { offset, line } pairs with byte offsets so the id is stable.
    const lines: Array<{ offset: number; line: string }> = [];
    let pos = 0;
    for (const line of raw.split("\n")) {
      const offset = pos;
      pos += Buffer.byteLength(line, "utf-8") + 1; // +1 for the "\n"
      if (line.length === 0) continue;
      lines.push({ offset, line });
    }
    // Newest first within a single file.
    lines.reverse();
    for (const { offset, line } of lines) {
      const date = file.name.slice(0, 10);
      if (startCursor && date === startCursor.date && offset >= startCursor.offset) continue;
      const event = parseLine(line);
      if (!event) continue;
      const id = `${date}:${offset}`;
      yield { event: { ...event, id }, id, date, offset };
    }
  }
}

/**
 * Cursor-paginated event list. Cursor is opaque: "YYYY-MM-DD:<offset>".
 * Newest first. Cross-category merge is done by interleaving on `at` in
 * memory per page — scale is fine (< 500 events per page).
 */
export async function listEvents(filter: AuditFilter, cursor?: string): Promise<AuditEventPage> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const parsedCursor = cursor ? parseCursor(cursor) : null;
  const categories =
    filter.category && filter.category.length > 0 ? filter.category : [...AUDIT_CATEGORIES];

  // Collect up to `limit * 2` candidates from each category and merge.
  // Over-fetch lets us drop filter misses without starving the page.
  const maxPerCategory = limit * 3;
  const perCategory: AuditEvent[] = [];
  for (const cat of categories) {
    let n = 0;
    for await (const { event } of iterateCategoryEvents(cat, parsedCursor ?? undefined)) {
      if (!matches(event, filter)) continue;
      perCategory.push(event);
      n += 1;
      if (n >= maxPerCategory) break;
    }
  }
  perCategory.sort((a, b) => b.at - a.at);

  const page = perCategory.slice(0, limit);
  const nextCursor =
    page.length === limit && perCategory.length > limit
      ? makeCursorFromEvent(page[page.length - 1])
      : null;
  return { events: page, nextCursor };
}

function parseCursor(cursor: string): { date: string; offset: number } | null {
  const match = EVENT_ID_RE.exec(cursor);
  if (!match) return null;
  return { date: match[1], offset: Number.parseInt(match[2], 10) };
}

function makeCursorFromEvent(event: AuditEvent): string | null {
  return event.id ?? null;
}

/** Look up one event by its assigned id. */
export async function readEventById(id: string): Promise<AuditEvent | null> {
  const match = EVENT_ID_RE.exec(id);
  if (!match) return null;
  const [, date, offsetStr] = match;
  const offset = Number.parseInt(offsetStr, 10);
  for (const category of AUDIT_CATEGORIES) {
    const path = join(categoryDir(category), `${date}.jsonl`);
    if (!existsSync(path)) continue;
    let raw: string;
    try {
      raw = await readFile(path, "utf-8");
    } catch {
      continue;
    }
    // Walk lines to find one whose byte offset matches.
    let pos = 0;
    for (const line of raw.split("\n")) {
      if (pos === offset) {
        const event = parseLine(line);
        if (event) return { ...event, id };
      }
      pos += Buffer.byteLength(line, "utf-8") + 1;
    }
  }
  return null;
}

/** Summary stats for the dashboard tiles + maintenance UI. */
export async function getStats(range?: { from?: number; to?: number }): Promise<AuditStats> {
  const meta = await readAuditMeta();
  const stats: AuditStats = {
    totalCount: 0,
    byCategory: { api: 0, cron: 0, session: 0, alert: 0 },
    bySeverity: { info: 0, warn: 0, error: 0 },
    firstEventAt: null,
    lastEventAt: null,
    diskUsageBytes: 0,
    oldestFileDate: null,
    newestFileDate: null,
    retentionDays: RETENTION_DAYS,
    lastWriteError: meta.lastWriteError,
    lastPurgeAt: meta.lastPurgeAt,
  };

  for (const category of AUDIT_CATEGORIES) {
    const files = await listDailyFiles(category);
    for (const file of files) {
      stats.diskUsageBytes += file.size;
      if (!stats.oldestFileDate || file.name < stats.oldestFileDate)
        stats.oldestFileDate = file.name.slice(0, 10);
      if (!stats.newestFileDate || file.name > stats.newestFileDate)
        stats.newestFileDate = file.name.slice(0, 10);
    }
  }

  // For count + event-range stats, iterate in-range events only.
  const filter: AuditFilter = { from: range?.from, to: range?.to };
  for (const category of AUDIT_CATEGORIES) {
    for await (const { event } of iterateCategoryEvents(category)) {
      if (!matches(event, filter)) continue;
      stats.totalCount += 1;
      stats.byCategory[category] = (stats.byCategory[category] ?? 0) + 1;
      const severity: AuditSeverity = event.severity;
      stats.bySeverity[severity] += 1;
      if (stats.firstEventAt === null || event.at < stats.firstEventAt)
        stats.firstEventAt = event.at;
      if (stats.lastEventAt === null || event.at > stats.lastEventAt) stats.lastEventAt = event.at;
    }
  }

  return stats;
}

/** Stream-serialize a filter range as NDJSON for export downloads. */
export async function* exportEvents(filter: AuditFilter): AsyncGenerator<string> {
  const categories =
    filter.category && filter.category.length > 0 ? filter.category : [...AUDIT_CATEGORIES];
  for (const cat of categories) {
    for await (const { event } of iterateCategoryEvents(cat)) {
      if (!matches(event, filter)) continue;
      const { id: _id, ...rest } = event;
      void _id;
      yield `${JSON.stringify(rest)}\n`;
    }
  }
}
