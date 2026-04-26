import { existsSync } from "fs";
import { appendFile, mkdir, readFile, writeFile, rename } from "fs/promises";
import { dirname } from "path";
import { AUDIT_CATEGORIES, META_PATH, dailyFilePath, ensureAuditTree } from "./paths";
import { scrubDetails, scrubErrorMessage, scrubSubject } from "./scrub";
import type {
  AlertAuditEvent,
  AlertAuditEventInput,
  ApiAuditEvent,
  ApiAuditEventInput,
  AuditCategory,
  AuditEvent,
  CronAuditEvent,
  CronAuditEventInput,
  SessionAuditEvent,
  SessionAuditEventInput,
} from "./types";

/**
 * Singleton that every audit producer routes through. Appends one JSONL
 * line per event to /root/.audit/<category>/YYYY-MM-DD.jsonl.
 *
 * Fire-and-forget: producers call `audit.api({...}).catch(() => {})` so a
 * disk error never surfaces in request handlers. Errors are captured into
 * .meta.json so the UI can show "writes failing" at the top of the page.
 *
 * fs.appendFile is a single syscall; Linux O_APPEND is atomic for
 * payloads under PIPE_BUF (~4 KB), matching our scrub hard-cap.
 */
class AuditWriter {
  private treeReady: Promise<void> | null = null;
  private lastEnospcLoggedAt = 0;

  async api(event: ApiAuditEventInput): Promise<void> {
    const full: ApiAuditEvent = {
      ...event,
      v: 1,
      category: "api",
      at: Date.now(),
      subject: scrubSubject(event.subject),
      details: scrubDetails(event.details),
    };
    await this.writeEvent(full);
  }

  async cron(event: CronAuditEventInput): Promise<void> {
    const full: CronAuditEvent = {
      ...event,
      v: 1,
      category: "cron",
      at: Date.now(),
      subject: scrubSubject(event.subject),
      details: scrubDetails(event.details),
    };
    await this.writeEvent(full);
  }

  async session(event: SessionAuditEventInput): Promise<void> {
    const full: SessionAuditEvent = {
      ...event,
      v: 1,
      category: "session",
      at: Date.now(),
      subject: scrubSubject(event.subject),
      details: scrubDetails(event.details),
    };
    await this.writeEvent(full);
  }

  async alert(event: AlertAuditEventInput): Promise<void> {
    const full: AlertAuditEvent = {
      ...event,
      v: 1,
      category: "alert",
      at: Date.now(),
      subject: scrubSubject(event.subject),
      details: scrubDetails(event.details),
    };
    await this.writeEvent(full);
  }

  private async writeEvent(event: AuditEvent): Promise<void> {
    try {
      await this.ensureTree();
      const path = dailyFilePath(event.category, event.at);
      if (!existsSync(dirname(path))) {
        await mkdir(dirname(path), { recursive: true });
      }
      // Omit the reader-assigned `id` before serializing.
      const { id: _discard, ...rest } = event;
      void _discard;
      const line = `${JSON.stringify(rest)}\n`;
      await appendFile(path, line, "utf-8");
    } catch (err) {
      this.handleWriteError(err);
    }
  }

  private ensureTree(): Promise<void> {
    if (!this.treeReady) this.treeReady = ensureAuditTree();
    return this.treeReady;
  }

  private handleWriteError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as NodeJS.ErrnoException | null)?.code;
    const now = Date.now();
    if (code === "ENOSPC") {
      // Rate-limit disk-full warnings to once per hour.
      if (now - this.lastEnospcLoggedAt > 60 * 60 * 1000) {
        console.error("[audit] Disk full — dropping audit events");
        this.lastEnospcLoggedAt = now;
      }
    } else {
      console.warn("[audit] write failed:", scrubErrorMessage(msg));
    }
    updateMetaLastWriteError(scrubErrorMessage(msg)).catch(() => {});
  }
}

let _instance: AuditWriter | null = null;

export function getAuditWriter(): AuditWriter {
  if (!_instance) _instance = new AuditWriter();
  return _instance;
}

export type { AuditWriter };

/* --------------------------------- meta.json helpers --------------------------------- */

export interface AuditMeta {
  lastPurgeAt: number | null;
  lastPurgeCount: number;
  lastWriteError: string | null;
  lastWriteErrorAt: number | null;
}

const EMPTY_META: AuditMeta = {
  lastPurgeAt: null,
  lastPurgeCount: 0,
  lastWriteError: null,
  lastWriteErrorAt: null,
};

export async function readAuditMeta(): Promise<AuditMeta> {
  if (!existsSync(META_PATH)) return EMPTY_META;
  try {
    const raw = await readFile(META_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AuditMeta>;
    return { ...EMPTY_META, ...parsed };
  } catch {
    return EMPTY_META;
  }
}

export async function writeAuditMeta(meta: AuditMeta): Promise<void> {
  await ensureAuditTree();
  const tmp = `${META_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(meta, null, 2), "utf-8");
  await rename(tmp, META_PATH);
}

async function updateMetaLastWriteError(msg: string): Promise<void> {
  try {
    const meta = await readAuditMeta();
    meta.lastWriteError = msg;
    meta.lastWriteErrorAt = Date.now();
    await writeAuditMeta(meta);
  } catch {
    /* never block on meta write */
  }
}

/** Helper used by the categories drop-down and stats endpoint. */
export function allCategories(): AuditCategory[] {
  return [...AUDIT_CATEGORIES];
}
