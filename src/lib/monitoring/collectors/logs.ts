import { createHash } from "crypto";
import type { LogErrorGroup, LogLevel, LogLine, LogsSnapshot } from "../types";

const MAX_LINES = 5000;
const MAX_GROUPS = 100;

export interface LogsCollector {
  /** Ring buffer of log lines (oldest first). */
  ring: LogLine[];
  /** Error fingerprint → group. */
  errorGroups: Map<string, LogErrorGroup>;
  dispose?: () => void;
}

export function createLogsCollector(): LogsCollector {
  return {
    ring: [],
    errorGroups: new Map(),
  };
}

export function recordLog(c: LogsCollector, line: LogLine): void {
  c.ring.push(line);
  if (c.ring.length > MAX_LINES) {
    c.ring.shift();
  }
  if (line.level === "error") {
    const fp = fingerprint(line.message);
    let group = c.errorGroups.get(fp);
    if (!group) {
      group = {
        fingerprint: fp,
        sample: line,
        count: 0,
        firstSeen: line.t,
        lastSeen: line.t,
      };
      c.errorGroups.set(fp, group);
      // Bound group size.
      if (c.errorGroups.size > MAX_GROUPS) {
        // Evict oldest.
        const oldest = [...c.errorGroups.values()].sort((a, b) => a.lastSeen - b.lastSeen)[0];
        if (oldest) c.errorGroups.delete(oldest.fingerprint);
      }
    }
    group.count += 1;
    group.lastSeen = line.t;
  }
}

export async function collectLogs(c: LogsCollector): Promise<LogsSnapshot> {
  const now = Date.now();
  const cutoff5m = now - 5 * 60 * 1000;
  const cutoff1h = now - 60 * 60 * 1000;
  const cutoff24h = now - 24 * 60 * 60 * 1000;
  const cutoff10s = now - 10_000;

  let errorsLast5m = 0;
  let errorsLast1h = 0;
  let errorsLast24h = 0;
  let recentCount = 0;

  for (const line of c.ring) {
    if (line.level !== "error") continue;
    if (line.t >= cutoff5m) errorsLast5m += 1;
    if (line.t >= cutoff1h) errorsLast1h += 1;
    if (line.t >= cutoff24h) errorsLast24h += 1;
  }
  for (const line of c.ring) {
    if (line.t >= cutoff10s) recentCount += 1;
  }
  const tailRatePerSec = recentCount / 10;

  const groups = [...c.errorGroups.values()].sort((a, b) => b.count - a.count).slice(0, 25);

  return {
    counts: { errorsLast5m, errorsLast1h, errorsLast24h, tailRatePerSec },
    errorGroups: groups,
    recent: c.ring.slice(-500),
  };
}

/**
 * Stable identity for an error message. Strips numbers, hex, paths, then
 * SHA-256 prefixes. Matches the shape Sentry uses for "issue" grouping.
 */
function fingerprint(msg: string): string {
  const normalized = msg
    .replace(/\d+/g, "N")
    .replace(/0x[0-9a-fA-F]+/g, "HEX")
    .replace(/\/[\w./-]+/g, "/PATH")
    .slice(0, 500);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/** Wire stdout/stderr capture to the collector. Idempotent. */
export function attachStdoutCapture(c: LogsCollector): void {
  attachStream(c, "stdout", process.stdout);
  attachStream(c, "stderr", process.stderr);
  attachConsoleHooks(c);
}

const ATTACHED = new WeakSet<object>();

function attachStream(
  c: LogsCollector,
  source: "stdout" | "stderr",
  stream: NodeJS.WriteStream,
): void {
  if (ATTACHED.has(stream)) return;
  ATTACHED.add(stream);
  const original = stream.write.bind(stream) as (...args: unknown[]) => boolean;
  const patched = function patchedWrite(...args: unknown[]): boolean {
    try {
      const chunk = args[0];
      if (typeof chunk === "string" || Buffer.isBuffer(chunk)) {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          recordLog(c, {
            t: Date.now(),
            level: source === "stderr" ? "error" : detectLevel(line),
            source,
            message: line.slice(0, 1000),
          });
        }
      }
    } catch {
      /* never break stdio */
    }
    return original(...args);
  } as unknown as NodeJS.WriteStream["write"];
  stream.write = patched;
}

function attachConsoleHooks(c: LogsCollector): void {
  const targets: Array<{ method: "warn" | "error"; level: LogLevel }> = [
    { method: "warn", level: "warn" },
    { method: "error", level: "error" },
  ];
  for (const t of targets) {
    const orig = console[t.method].bind(console) as (...args: unknown[]) => void;
    const patched = function patchedConsole(...args: unknown[]): void {
      try {
        const message = args
          .map((a) =>
            a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : safe(a),
          )
          .join(" ");
        recordLog(c, {
          t: Date.now(),
          level: t.level,
          source: t.level === "error" ? "stderr" : "stdout",
          message: message.slice(0, 1000),
        });
      } catch {
        /* never break logging */
      }
      orig(...args);
    };
    console[t.method] = patched as (typeof console)[typeof t.method];
  }
}

function safe(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function detectLevel(line: string): LogLevel {
  if (/\[(error|err)\]/i.test(line)) return "error";
  if (/\[(warn|warning)\]/i.test(line)) return "warn";
  if (/\[debug\]/i.test(line)) return "debug";
  return "info";
}
