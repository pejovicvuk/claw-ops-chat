import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safePath, safeFilename } from "@/lib/safe-path";

/**
 * Phase 3c (#128): drag-in file uploads to the previewed page.
 *
 * This module owns the per-WS state for in-flight uploads + the pure
 * helpers (validators, the page-side injected JS, temp-path math).
 * Wiring lives in:
 *   - `handler.ts` adds WS message types `file_drop_start` /
 *     `file_drop_end` and a binary-tag `0x10` chunk handler that
 *     drives `openDrop` / `appendChunk` / `closeDrop` here.
 *   - `chromium-pool.ts`'s `beforeNavigate` hook (Phase 3b) gains
 *     two more bindings (`__clawFetchDropBytes`, `__clawDispatchDrop`)
 *     and another `addInitScript` carrying `buildInjectedFileDropScript()`.
 *   - `use-preview-stream.ts` adds the client-side drag listeners
 *     and the chunked WS sender.
 *
 * Security boundary: previewed apps are treated as untrusted. The
 * server validates every payload (filename safety, size cap, dropId
 * shape) before touching disk. Temp files live under a fixed dir;
 * filenames are sanitised through `safeFilename` plus a `safePath`
 * realpath check on the joined absolute path.
 */

/** 50 MB hard cap per file, per issue spec. Validated both at
 *  `file_drop_start.size` (header) AND at running byte counter
 *  (so a lying header can't get more bytes through). */
export const MAX_DROP_BYTES = 50 * 1024 * 1024;

/** 64 KB chunks. Matches Phase 2's WS frame sizing. Small enough
 *  that a single chunk's worth of buffering between writes never
 *  bloats peak RAM. */
export const DROP_CHUNK_SIZE = 64 * 1024;

/** Temp-file TTL after `file_drop_end`. Long enough to allow CDP
 *  delivery + retry; short enough that orphaned files from crashed
 *  uploads age out fast. */
export const DROP_TTL_MS = 60_000;

/** Where the per-drop temp files land. Aligned with
 *  `/root/.cache/{images,unfurls}` convention. */
export const TEMP_UPLOAD_DIR = "/root/.cache/preview-uploads";

/** Page-side global function name the injected script defines. The
 *  server invokes it via `Runtime.callFunctionOn` to dispatch a
 *  synthetic drop on a non-input target. */
export const DROP_DISPATCH_BINDING = "__clawDispatchDrop";

/** Page-side global the injected script calls back into to fetch the
 *  raw bytes for a drop by its id. Implemented server-side via
 *  `exposeBinding`. */
export const DROP_FETCH_BYTES_BINDING = "__clawFetchDropBytes";

export type DropRejectReason =
  | "wrong_type"
  | "missing_field"
  | "size_too_large"
  | "size_invalid"
  | "filename_invalid"
  | "dropid_invalid"
  | "coords_invalid";

export interface DropValidationResult {
  ok: boolean;
  reason?: DropRejectReason;
  start?: ValidatedDropStart;
}

export interface ValidatedDropStart {
  dropId: string;
  filename: string;
  mimeType: string;
  size: number;
  x: number;
  y: number;
}

/**
 * Loose UUID-v4 shape check. We don't enforce the version nibble
 * because clients may send v1 / v7; what we DO enforce is "no slashes,
 * no nulls, plausible length" so a `dropId` like
 * `../../../etc/passwd` can't escape `TEMP_UPLOAD_DIR`. The id is
 * never trusted as a path component without joining + safePath.
 */
export function validateUuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < 16 || value.length > 64) return false;
  // Hex + dashes only. Rejects path-traversal payloads as a side effect.
  return /^[0-9a-fA-F-]+$/.test(value);
}

/**
 * Validate the JSON header that opens a drop. Coords are clamped
 * caller-side via the existing input forwarding's bounds check; here
 * we only insist they're finite numbers.
 */
export function validateFileDropStart(value: unknown): DropValidationResult {
  if (!value || typeof value !== "object") return { ok: false, reason: "wrong_type" };
  const v = value as Record<string, unknown>;
  if (!validateUuid(v.dropId)) return { ok: false, reason: "dropid_invalid" };
  if (typeof v.filename !== "string" || v.filename.length === 0) {
    return { ok: false, reason: "filename_invalid" };
  }
  if (typeof v.mimeType !== "string") return { ok: false, reason: "missing_field" };
  if (typeof v.size !== "number" || !Number.isFinite(v.size) || v.size < 0) {
    return { ok: false, reason: "size_invalid" };
  }
  if (v.size > MAX_DROP_BYTES) return { ok: false, reason: "size_too_large" };
  if (
    typeof v.x !== "number" ||
    typeof v.y !== "number" ||
    !Number.isFinite(v.x) ||
    !Number.isFinite(v.y)
  ) {
    return { ok: false, reason: "coords_invalid" };
  }
  return {
    ok: true,
    start: {
      dropId: v.dropId,
      filename: v.filename,
      mimeType: v.mimeType,
      size: v.size,
      x: v.x,
      y: v.y,
    },
  };
}

/**
 * Resolve the absolute on-disk path for a drop. The filename component
 * is sanitised via `safeFilename` (strips dir separators) before being
 * joined to `TEMP_UPLOAD_DIR`. The joined path is then realpath-checked
 * via `safePath` so symlink shenanigans inside the cache dir can't
 * escape. Returns the final absolute path or throws on rejection.
 */
export async function resolveDropPath(dropId: string, filename: string): Promise<string> {
  if (!validateUuid(dropId)) {
    throw new Error(`invalid dropId`);
  }
  const cleanName = safeFilename(filename);
  const joined = join(TEMP_UPLOAD_DIR, `${dropId}-${cleanName}`);
  // safePath asserts the resolved path stays under BASE_DIR (default
  // `/root` in prod). TEMP_UPLOAD_DIR is under that base, so the
  // happy path resolves cleanly. realpath also collapses any
  // symlink in the cache hierarchy.
  return safePath(joined);
}

export interface DropEntry {
  start: ValidatedDropStart;
  path: string;
  stream: WriteStream;
  bytesWritten: number;
  ttlTimer: NodeJS.Timeout | null;
}

/**
 * Lifecycle helpers for the per-WS drop state Map. Callers (handler.ts)
 * own the Map and pass it in — keeps this module pure-ish and easy to
 * test without spinning up a real server.
 */
export async function openDrop(
  drops: Map<string, DropEntry>,
  start: ValidatedDropStart,
): Promise<DropEntry> {
  if (drops.has(start.dropId)) {
    throw new Error(`drop ${start.dropId} already open`);
  }
  const path = await resolveDropPath(start.dropId, start.filename);
  await mkdir(dirname(path), { recursive: true });
  const stream = createWriteStream(path, { flags: "w" });
  const entry: DropEntry = { start, path, stream, bytesWritten: 0, ttlTimer: null };
  drops.set(start.dropId, entry);
  return entry;
}

/**
 * Append a chunk to an open drop. Returns false (and tears the drop
 * down) when the running byte counter would exceed the cap — covers
 * the case where the header lied about `size`.
 */
export function appendChunk(entry: DropEntry, chunk: Buffer): boolean {
  if (entry.bytesWritten + chunk.length > MAX_DROP_BYTES) {
    return false;
  }
  entry.bytesWritten += chunk.length;
  entry.stream.write(chunk);
  return true;
}

/**
 * Close the write stream. Caller decides what to do with the file
 * (CDP delivery) before scheduling cleanup via `scheduleCleanup`.
 */
export async function closeDrop(entry: DropEntry): Promise<void> {
  await new Promise<void>((resolve) => {
    entry.stream.end(() => resolve());
  });
}

/**
 * Schedule the temp file for deletion DROP_TTL_MS from now. Idempotent
 * — replaces any prior timer for the same entry. Safe to call after
 * either successful CDP delivery or a failure.
 */
export function scheduleCleanup(
  drops: Map<string, DropEntry>,
  entry: DropEntry,
): void {
  if (entry.ttlTimer) clearTimeout(entry.ttlTimer);
  entry.ttlTimer = setTimeout(() => {
    drops.delete(entry.start.dropId);
    void unlink(entry.path).catch(() => {
      /* file may already be gone; sweeper covers this case anyway */
    });
  }, DROP_TTL_MS);
}

/**
 * Tear down a drop unconditionally — close the stream, drop the entry,
 * delete the file. Called on WS close while uploads are mid-flight,
 * size-cap violations, etc.
 */
export async function cancelDrop(
  drops: Map<string, DropEntry>,
  dropId: string,
): Promise<void> {
  const entry = drops.get(dropId);
  if (!entry) return;
  drops.delete(dropId);
  if (entry.ttlTimer) clearTimeout(entry.ttlTimer);
  try {
    entry.stream.destroy();
  } catch {
    /* ignore */
  }
  try {
    await unlink(entry.path);
  } catch {
    /* may already be gone */
  }
}

/**
 * Boot-time + recurring safety net: scan TEMP_UPLOAD_DIR and unlink
 * any file whose mtime is older than DROP_TTL_MS. Primary cleanup is
 * the per-drop setTimeout in `scheduleCleanup`; this catches files
 * orphaned by crashed processes / hard kills. Idempotent — safe to
 * call before the directory exists (returns silently).
 */
export async function sweepStaleDrops(): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(TEMP_UPLOAD_DIR);
  } catch {
    return; // dir doesn't exist yet — nothing to sweep
  }
  const cutoff = Date.now() - DROP_TTL_MS;
  await Promise.all(
    entries.map(async (name) => {
      const p = join(TEMP_UPLOAD_DIR, name);
      try {
        const s = await stat(p);
        if (s.mtimeMs < cutoff) {
          await unlink(p).catch(() => {
            /* race with the per-drop timer is fine */
          });
        }
      } catch {
        /* file may have been removed mid-iteration */
      }
    }),
  );
}

/**
 * Build the JS injected via Playwright's `addInitScript` alongside the
 * Phase 3b clipboard hook. Defines `window.__clawDispatchDrop({dropId,
 * filename, mimeType, x, y})`. Server invokes this when the drop
 * target is NOT an `<input type=file>` (those go through CDP
 * `DOM.setFileInputFiles` which gives `isTrusted=true` semantics).
 *
 * `deepElementFromPoint` recursively pierces same-origin iframes by
 * translating coords into each iframe's local rect. Cross-origin
 * iframes return the iframe element itself — caller treats this as
 * "drop-zone" or rejects upstream.
 *
 * Exported as a builder so binding names + cap can vary in tests
 * without rebuilding the whole script string by hand.
 */
export function buildInjectedFileDropScript(
  dispatchBinding: string = DROP_DISPATCH_BINDING,
  fetchBytesBinding: string = DROP_FETCH_BYTES_BINDING,
): string {
  return `
(() => {
  const DISPATCH = ${JSON.stringify(dispatchBinding)};
  const FETCH = ${JSON.stringify(fetchBytesBinding)};
  function deepElementFromPoint(x, y, win) {
    win = win || window;
    let el = win.document.elementFromPoint(x, y);
    while (el && el.tagName === "IFRAME") {
      const rect = el.getBoundingClientRect();
      let inner;
      try { inner = el.contentWindow; } catch (_) { return el; }
      if (!inner || !inner.document) return el;
      x -= rect.left; y -= rect.top;
      el = inner.document.elementFromPoint(x, y);
      win = inner;
    }
    return el;
  }
  // Climb to the nearest enclosing <input type=file> if the click
  // landed on a child (label, icon span, etc.). Mirrors what the
  // browser's native file picker does on click.
  function nearestFileInput(el) {
    let cur = el;
    while (cur && cur !== cur.ownerDocument.documentElement) {
      if (cur.tagName === "INPUT" && cur.type === "file") return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  window[DISPATCH] = async (req) => {
    if (!req || typeof req !== "object") return { ok: false, reason: "bad_req" };
    const dropId = req.dropId;
    const filename = req.filename;
    const mimeType = req.mimeType;
    const x = Number(req.x);
    const y = Number(req.y);
    if (typeof dropId !== "string") return { ok: false, reason: "bad_dropid" };
    const target = deepElementFromPoint(x, y);
    if (!target) return { ok: false, reason: "no_target" };
    // Pull the bytes via the exposed binding. Returns a base64 string
    // because Playwright's exposeBinding only round-trips JSON-friendly
    // values; raw Uint8Array would be coerced to an empty object.
    let b64;
    try {
      const fetcher = window[FETCH];
      if (typeof fetcher !== "function") return { ok: false, reason: "no_binding" };
      b64 = await fetcher(dropId);
    } catch (_) { return { ok: false, reason: "fetch_failed" }; }
    if (typeof b64 !== "string" || b64.length === 0) {
      return { ok: false, reason: "no_bytes" };
    }
    let u8;
    try {
      const bin = atob(b64);
      u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    } catch (_) { return { ok: false, reason: "decode_failed" }; }
    if (u8.length === 0) return { ok: false, reason: "empty_bytes" };
    const file = new File([u8], String(filename || "file"), {
      type: String(mimeType || "application/octet-stream"),
    });
    // Two delivery modes — file input vs drop-zone. We detect by
    // walking up from the target; this gracefully handles labels +
    // styled wrappers around the actual <input type=file>.
    const fileInput = nearestFileInput(target);
    if (fileInput) {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        // Direct .files = ... assignment is spec'd as readonly but
        // Chromium / Firefox both honor it from a DataTransfer source.
        // This is the canonical workaround used by every JS-driven
        // file-input testing harness (Playwright, Puppeteer, Cypress).
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event("input", { bubbles: true }));
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (_) {
        return { ok: false, reason: "input_assign_failed" };
      }
      return { ok: true, target: "input" };
    }
    // Drop-zone path — synthesize the dragenter → dragover → drop
    // sequence apps depend on. isTrusted=false; rare apps that
    // explicitly check it will reject.
    const dt = new DataTransfer();
    dt.items.add(file);
    const init = {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      clientX: x,
      clientY: y,
    };
    try {
      target.dispatchEvent(new DragEvent("dragenter", init));
      target.dispatchEvent(new DragEvent("dragover", init));
      target.dispatchEvent(new DragEvent("drop", init));
    } catch (_) {
      return { ok: false, reason: "dispatch_failed" };
    }
    return { ok: true, target: "dropzone" };
  };
})();
`.trim();
}
