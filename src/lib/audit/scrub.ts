/**
 * Safety net that runs on every event before it's serialized. Strips
 * known-sensitive patterns (tokens, bearer creds, credentials-file paths)
 * and caps depth / size so a misbehaving caller can't dump megabytes or
 * recursive objects into the audit log.
 *
 * Defense in depth: producers are also careful not to pass secrets in,
 * but this is the last line before disk.
 */

const MAX_DEPTH = 3;
const MAX_SERIALIZED_BYTES = 4 * 1024;
const MAX_STRING_LEN = 500;
const MAX_SUBJECT_LEN = 200;

const SECRET_KEY_RE =
  /^(authorization|cookie|password|passwd|secret|token|api[_-]?key|refresh[_-]?token|access[_-]?token|bearer|session[_-]?secret|client[_-]?secret)$/i;

const SECRET_VALUE_PATTERNS: ReadonlyArray<RegExp> = [
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /sk-ant-api\S+/gi,
  /sk-[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /ya29\.[A-Za-z0-9._\-]+/g,
  /[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}/g,
];

const CREDS_PATH_RE = /\/root\/\.claude\/\.credentials\.json/g;

const REDACTED = "<redacted>";

/**
 * Recursively walk an object, returning a scrubbed copy safe to persist.
 * - Keys matching SECRET_KEY_RE have their values replaced with "<redacted>".
 * - Strings have SECRET_VALUE_PATTERNS + credentials paths regex-scrubbed.
 * - Strings are truncated to MAX_STRING_LEN.
 * - Depth is capped at MAX_DEPTH; deeper nested objects become "<depth-capped>".
 * - The final JSON serialization is capped at MAX_SERIALIZED_BYTES;
 *   over-limit objects are replaced wholesale with { truncated: true }.
 */
export function scrubDetails(input: unknown): Record<string, unknown> {
  const scrubbed = walk(input, 0);
  const obj: Record<string, unknown> =
    scrubbed && typeof scrubbed === "object" && !Array.isArray(scrubbed)
      ? (scrubbed as Record<string, unknown>)
      : { value: scrubbed };
  const serialized = safeStringify(obj);
  if (serialized.length <= MAX_SERIALIZED_BYTES) return obj;
  return { truncated: true, approxBytes: serialized.length };
}

export function scrubString(input: string): string {
  let out = input;
  for (const re of SECRET_VALUE_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  out = out.replace(CREDS_PATH_RE, "<claude-creds>");
  if (out.length > MAX_STRING_LEN) {
    out = `${out.slice(0, MAX_STRING_LEN)}…<truncated>`;
  }
  return out;
}

export function scrubSubject(input: string): string {
  const cleaned = scrubString(input);
  if (cleaned.length > MAX_SUBJECT_LEN) {
    return `${cleaned.slice(0, MAX_SUBJECT_LEN - 1)}…`;
  }
  return cleaned;
}

export function scrubErrorMessage(input: string | undefined | null): string {
  if (!input) return "";
  return scrubString(input);
}

const BASH_ALLOWLIST =
  /^(git|ls|cat|pwd|cd|npm|node|python|python3|pip|docker|echo|mkdir|rm|mv|cp|touch|head|tail|wc|find|grep|rg|which|curl|wget)\b/;

/**
 * Never log a full bash command — values can contain secrets (`curl -H
 * "Authorization: Bearer xxx"`). Return at most 30 chars of a whitelisted
 * prefix, or "<redacted>" for anything that doesn't start with a known
 * benign command.
 */
export function scrubBashCommand(cmd: string | undefined | null): string {
  if (!cmd) return "";
  const trimmed = cmd.trim();
  if (!BASH_ALLOWLIST.test(trimmed)) return REDACTED;
  return trimmed.slice(0, 30);
}

function walk(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return "<depth-capped>";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => walk(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) {
        out[k] = REDACTED;
        continue;
      }
      out[k] = walk(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return "";
  }
}

export const __INTERNAL = {
  SECRET_KEY_RE,
  SECRET_VALUE_PATTERNS,
  MAX_STRING_LEN,
  MAX_SERIALIZED_BYTES,
};
