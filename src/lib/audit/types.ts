/**
 * Audit log event schema. Single discriminated union so the reader + UI
 * can narrow on `category` + `type` and see the right extra fields.
 *
 * Every event is persisted as a JSONL line under /root/.audit/<category>/YYYY-MM-DD.jsonl.
 * See src/lib/audit/paths.ts for the on-disk layout.
 */

export type AuditCategory = "api" | "cron" | "session" | "alert";

export type AuditSeverity = "info" | "warn" | "error";

export interface AuditTokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

interface AuditBase {
  /** Schema version. Bump when fields change; reader tolerates multiple v values. */
  v: 1;
  /** Wall-clock ms epoch (UTC). */
  at: number;
  /** Assigned by the reader as "YYYY-MM-DD:<byteOffset>". Never written to disk. */
  id?: string;
  category: AuditCategory;
  severity: AuditSeverity;
  /** Authenticated user email, or "anonymous" for pre-auth events. */
  actor: string;
  /** Human-readable one-liner, ≤ 200 chars, scrubbed. */
  subject: string;
  /** Wall-clock duration if meaningful, else null. */
  durationMs: number | null;
  /** Scrubbed free-form blob, ≤ 4 KB serialized, depth ≤ 3. */
  details: Record<string, unknown>;
}

export type ApiAuditEventType = "request_complete" | "request_error" | "ws_upgrade";

export type ApiAuditEvent = AuditBase & {
  category: "api";
  type: ApiAuditEventType;
  route: string;
  method: string;
  statusCode: number;
  /** Caller-supplied subject — e.g. filepath being edited, slug being deleted. Never a token. */
  target?: string;
};

export type CronAuditEventType =
  | "job_registered"
  | "job_unregistered"
  | "tick"
  | "tick_skipped"
  | "tick_cancelled_previous"
  | "tick_queued"
  | "run_start"
  | "run_complete"
  | "tool_use"
  | "permission_denied";

export type CronAuditEvent = AuditBase & {
  category: "cron";
  type: CronAuditEventType;
  slug: string;
  runId?: string;
  status?: "success" | "error" | "timeout" | "aborted" | "running";
  tokenUsage?: AuditTokenUsage;
  turnsUsed?: number;
  toolName?: string;
};

export type SessionAuditEventType =
  | "connected"
  | "disconnected"
  | "sdk_init"
  | "user_message"
  | "tool_use_start"
  | "tool_use_complete"
  | "permission_requested"
  | "permission_granted"
  | "permission_denied"
  | "turn_complete"
  | "error";

export type SessionAuditEvent = AuditBase & {
  category: "session";
  type: SessionAuditEventType;
  sessionId: string;
  claudeSessionId?: string | null;
  toolName?: string;
  turnId?: string;
  isError?: boolean;
};

export type AlertAuditEventType =
  | "rule_created"
  | "rule_updated"
  | "rule_deleted"
  | "alert_fired"
  | "alert_resolved"
  | "alert_acked"
  | "alert_snoozed"
  | "notify_failed";

export type AlertAuditEvent = AuditBase & {
  category: "alert";
  type: AlertAuditEventType;
  ruleId: string;
  ruleName?: string;
  metric?: string;
  thresholdValue?: number;
  observedValue?: number;
};

export type AuditEvent = ApiAuditEvent | CronAuditEvent | SessionAuditEvent | AlertAuditEvent;

/** Input to the writer — `v`, `category`, and `at` are filled in automatically. */
export type ApiAuditEventInput = Omit<ApiAuditEvent, "v" | "category" | "at">;
export type CronAuditEventInput = Omit<CronAuditEvent, "v" | "category" | "at">;
export type SessionAuditEventInput = Omit<SessionAuditEvent, "v" | "category" | "at">;
export type AlertAuditEventInput = Omit<AlertAuditEvent, "v" | "category" | "at">;

/* --------------------------------- Reader types --------------------------------- */

export interface AuditFilter {
  category?: AuditCategory[];
  severity?: AuditSeverity[];
  /** ms epoch, inclusive. */
  from?: number;
  /** ms epoch, inclusive. */
  to?: number;
  /** Substring search against subject + actor + route (case-insensitive). */
  q?: string;
  /** Max events in one page. Default 100, hard max 500. */
  limit?: number;
}

export interface AuditEventPage {
  events: AuditEvent[];
  /** Opaque cursor for the next page, or null if no more. */
  nextCursor: string | null;
}

export interface AuditStats {
  totalCount: number;
  byCategory: Partial<Record<AuditCategory, number>>;
  bySeverity: Record<AuditSeverity, number>;
  firstEventAt: number | null;
  lastEventAt: number | null;
  diskUsageBytes: number;
  oldestFileDate: string | null;
  newestFileDate: string | null;
  /** Fixed 30 days; surfaced so UI can show "auto-purged after N days". */
  retentionDays: number;
  /** Human-readable error string from writer if the last append failed. */
  lastWriteError: string | null;
  lastPurgeAt: number | null;
}
