import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import type { AuditCategory } from "./types";

/**
 * Canonical paths for the Audit feature. Everything lives under
 * /root/.audit (hidden dot-dir — kept out of the file browser, mirrors
 * the /root/reports/.runs idiom). The /root:/root bind mount in
 * docker-compose.yml ensures these files survive container restarts.
 */

export const AUDIT_ROOT = "/root/.audit";

export const AUDIT_CATEGORIES: readonly AuditCategory[] = ["api", "cron", "session"] as const;

export const META_PATH = join(AUDIT_ROOT, ".meta.json");

export const README_PATH = join(AUDIT_ROOT, "README.md");

/** Fixed retention window. Surfaced as a constant so UI and retention share it. */
export const RETENTION_DAYS = 30;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Directory for one category's daily files. */
export function categoryDir(category: AuditCategory): string {
  return join(AUDIT_ROOT, category);
}

/** Filename format: "YYYY-MM-DD.jsonl" (UTC date of `at`). */
export function dailyFileName(atMs: number): string {
  return `${new Date(atMs).toISOString().slice(0, 10)}.jsonl`;
}

/** Full path to the daily file for a category + timestamp. */
export function dailyFilePath(category: AuditCategory, atMs: number): string {
  return join(categoryDir(category), dailyFileName(atMs));
}

const README_BODY = `# Audit log

This directory holds append-only audit events for:

- \`api/\`     — state-changing API calls and auth events
- \`cron/\`    — scheduled report job lifecycle and run events
- \`session/\` — Claude chat session lifecycle and tool usage

Files are rotated daily (\`YYYY-MM-DD.jsonl\`, UTC). Anything older than
${RETENTION_DAYS} days is auto-purged every 6 hours.

The UI at **Settings → Audit Log** reads these files and lets you:

- filter / search events
- manually delete older ranges to reclaim disk
- export a date range as NDJSON

See \`.meta.json\` for the timestamp of the most recent purge and the
timestamp of the most recent write error (if any).
`;

/**
 * Create /root/.audit and its subdirectories if missing. Idempotent —
 * safe to call on every server start. Also writes the README.md on
 * first run so an operator tailing the container filesystem understands
 * the layout.
 */
export async function ensureAuditTree(): Promise<void> {
  if (!existsSync(AUDIT_ROOT)) {
    await mkdir(AUDIT_ROOT, { recursive: true });
  }
  for (const cat of AUDIT_CATEGORIES) {
    const dir = categoryDir(cat);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }
  if (!existsSync(README_PATH)) {
    await writeFile(README_PATH, README_BODY, "utf-8");
  }
}

/** Parse a filename like "2026-04-24.jsonl" back to a ms epoch (start of day UTC). */
export function parseDailyFileName(name: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/.exec(name);
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
