/**
 * Phase 3b (#127): two-way clipboard sync between the previewed
 * Chromium tab and the user's browser.
 *
 * This module is a pure helpers + injected-script bundle. The actual
 * wiring lives in:
 *   - `chromium-pool.ts` registers the `exposeBinding` and runs
 *     `addInitScript(buildInjectedClipboardScript())` BEFORE
 *     `page.goto`, so the script lands in every document.
 *   - `handler.ts` accepts `clipboard_paste` WS messages from the
 *     client and dispatches them via `page.keyboard.insertText`,
 *     plus forwards `clipboard_copy` JSON when the binding fires.
 *   - `use-preview-stream.ts` attaches `paste` listeners on the
 *     active preview element + receives `clipboard_copy` and writes
 *     to `navigator.clipboard.writeText`.
 *
 * Security boundary: a previewed app is treated as untrusted code.
 * The injected script only forwards copy/cut events whose
 * `isTrusted === true` flag is set — that flag cannot be forged by
 * page JS, so a malicious page can't synthesize `document.execCommand
 * ("copy")` to exfiltrate the user's selection.
 */

export const CLIPBOARD_BINDING_NAME = "__clawClipboardCopy";

/**
 * 1 MB hard cap on a single clipboard payload. Realistic copy/paste
 * is well below this; anything bigger looks like an attempt to
 * abuse the bridge or a runaway script. Enforced on BOTH sides:
 *   - server-side (handler) drops oversized binding callbacks
 *   - client-side drops oversized paste sends before WS roundtrip
 */
export const MAX_CLIPBOARD_BYTES = 1024 * 1024;

export type ClipboardRejectReason = "wrong_type" | "empty" | "too_large";

export interface ClipboardValidationResult {
  ok: boolean;
  reason?: ClipboardRejectReason;
  text?: string;
}

/**
 * Validate a payload arriving on the wire (from page → server via
 * binding, or from client → server via WS message). Strict: only
 * non-empty strings under the byte cap are accepted. UTF-8 byte
 * count is computed via `TextEncoder`, not naive char length, so
 * emoji-heavy payloads can't slip past the cap by counting low.
 */
export function validateClipboardPayload(value: unknown): ClipboardValidationResult {
  if (typeof value !== "string") return { ok: false, reason: "wrong_type" };
  if (value.length === 0) return { ok: false, reason: "empty" };
  const byteLen = new TextEncoder().encode(value).length;
  if (byteLen > MAX_CLIPBOARD_BYTES) return { ok: false, reason: "too_large" };
  return { ok: true, text: value };
}

/**
 * Build the JS string injected into every previewed page (and
 * iframe) via Playwright's `addInitScript`. Runs BEFORE any page
 * script on every fresh document — guaranteed by Chromium when the
 * init script is registered ahead of `page.goto`.
 *
 * Exported as a builder function so callers can override the binding
 * name (useful for tests / future per-session isolation) without
 * editing string literals. Returned content is wrapped in an IIFE
 * so it leaves no globals in the page.
 *
 * The body deliberately avoids modern syntax beyond what every
 * Chromium ≥ 110 supports without transpilation — we don't get a
 * build step inside the previewed tab.
 */
export function buildInjectedClipboardScript(
  bindingName: string = CLIPBOARD_BINDING_NAME,
  maxBytes: number = MAX_CLIPBOARD_BYTES,
): string {
  return `
(() => {
  const BINDING = ${JSON.stringify(bindingName)};
  const MAX_BYTES = ${maxBytes};
  const onCopyOrCut = (e) => {
    // SECURITY: isTrusted is true only for events synthesized by the
    // browser from a real user gesture. document.execCommand("copy")
    // produces an event with isTrusted === false. Without this guard
    // a malicious previewed page could exfiltrate text it crafted
    // by faking copy events. This single check is the boundary.
    if (!e || !e.isTrusted) return;
    const cd = e.clipboardData;
    if (!cd) return;
    let text;
    try { text = cd.getData("text/plain"); } catch (_) { return; }
    if (typeof text !== "string" || text.length === 0) return;
    // Cheap pre-filter — actual UTF-8 byte count is computed Node-side
    // via validateClipboardPayload. char.length is always <= byte count
    // for ASCII (most clipboard text), so dropping anything over MAX_BYTES
    // chars is a safe upper bound.
    if (text.length > MAX_BYTES) return;
    const fn = window[BINDING];
    if (typeof fn !== "function") return;
    try { fn(text); } catch (_) { /* binding torn down — ignore */ }
  };
  // useCapture=true so we catch the event before any page handler can
  // call stopPropagation. We don't preventDefault — the page's own
  // copy logic still runs (e.g. visual feedback in rich editors).
  document.addEventListener("copy", onCopyOrCut, true);
  document.addEventListener("cut", onCopyOrCut, true);
})();
`.trim();
}
