import { listEvents } from "../../audit/reader";
import type { AuditCategory, AuditSeverity } from "../../audit/types";

/**
 * Resolves the special metric form `audit.count(category=X,severity=Y,window=Ns)`
 * by counting matching audit events in the trailing window. The result
 * is cached per-key for the duration of `window` to avoid re-reading
 * JSONL on every alert tick.
 */

interface AuditCountSpec {
  category?: AuditCategory[];
  severity?: AuditSeverity[];
  windowMs: number;
  query?: string;
}

const cache = new Map<string, { value: number; expiresAt: number }>();

export function auditCountLookup(): (path: string) => number | null {
  return (path: string) => {
    const spec = parse(path);
    if (!spec) return null;
    const cached = cache.get(path);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.value;
    // Evaluate synchronously — we kick off the read and cache the
    // promise's eventual value via `then`. First call returns 0 (warm
    // up); subsequent calls within the cache window return the cached
    // value. Since the alert evaluator only fires after sustained
    // breach (`forMs`), one tick of warmup latency is fine.
    const ttlMs = Math.max(2000, Math.min(spec.windowMs / 5, 30_000));
    void resolve(spec).then((value) => {
      cache.set(path, { value, expiresAt: Date.now() + ttlMs });
    });
    return cached?.value ?? 0;
  };
}

function parse(path: string): AuditCountSpec | null {
  const m = /^audit\.count\((.*)\)$/.exec(path);
  if (!m) return null;
  const args = m[1];
  const parts: Record<string, string> = {};
  for (const piece of args.split(",")) {
    const eq = piece.indexOf("=");
    if (eq === -1) continue;
    const key = piece.slice(0, eq).trim();
    const val = piece.slice(eq + 1).trim();
    parts[key] = val;
  }
  const windowStr = parts.window ?? "60s";
  const windowMs = parseDuration(windowStr);
  if (windowMs === null) return null;
  return {
    category: parts.category
      ? (parts.category.split("|").filter(Boolean) as AuditCategory[])
      : undefined,
    severity: parts.severity
      ? (parts.severity.split("|").filter(Boolean) as AuditSeverity[])
      : undefined,
    windowMs,
    query: parts.q,
  };
}

function parseDuration(s: string): number | null {
  const m = /^(\d+)(s|m|h)$/.exec(s);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n)) return null;
  switch (m[2]) {
    case "s":
      return n * 1000;
    case "m":
      return n * 60 * 1000;
    case "h":
      return n * 60 * 60 * 1000;
  }
  return null;
}

async function resolve(spec: AuditCountSpec): Promise<number> {
  const now = Date.now();
  const from = now - spec.windowMs;
  const page = await listEvents({
    category: spec.category,
    severity: spec.severity,
    q: spec.query,
    from,
    to: now,
    limit: 500,
  });
  return page.events.length;
}
