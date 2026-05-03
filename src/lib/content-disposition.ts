/**
 * Build a `Content-Disposition: attachment` header value with both an
 * ASCII fallback (`filename="…"`) and a UTF-8 encoded form
 * (`filename*=UTF-8''…`) per RFC 5987. Browsers prefer the latter when
 * present; the ASCII fallback is for archaic clients that don't parse
 * RFC 5987.
 *
 * Used by:
 *   - `/api/files/download` (chat file browser downloads)
 *   - `/api/preview-download/[id]` (Phase 3d preview download relay)
 */
export function contentDisposition(name: string): string {
  // Strip control characters and quotes for the ASCII fallback so the
  // quoted-string form parses correctly.
  const asciiSafe = name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, '\\"');
  // RFC 5987 percent-encode for filename*. encodeURIComponent already
  // covers most cases; we additionally escape the apostrophe because
  // it's the RFC 5987 delimiter inside the value.
  const encoded = encodeURIComponent(name).replace(/'/g, "%27");
  return `attachment; filename="${asciiSafe}"; filename*=UTF-8''${encoded}`;
}
