/**
 * Small extension → MIME map used by /api/files/serve and /api/proxy/image
 * so browsers render inline (<img>, <video>, <iframe src=pdf>) instead of
 * triggering a download. Kept intentionally small — unknown extensions
 * fall back to application/octet-stream, matching the pre-existing
 * /api/files/download behavior.
 */

const MIME_BY_EXT: Record<string, string> = {
  // images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  // documents
  pdf: "application/pdf",
  // video
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  // audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  // text
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  log: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  yaml: "text/yaml; charset=utf-8",
  yml: "text/yaml; charset=utf-8",
};

/** Look up MIME type by file path. Case-insensitive extension match. */
export function mimeFor(path: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(path);
  if (!match) return "application/octet-stream";
  const ext = match[1].toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** Fast "is this an image extension?" check used by preview components. */
export function isImageExt(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(path);
}

/** Extension guess for caching external images where the URL may not have one. */
export function extFromMime(mime: string): string {
  const pair = Object.entries(MIME_BY_EXT).find(
    ([, m]) => m.split(";")[0].trim() === mime.split(";")[0].trim(),
  );
  return pair ? pair[0] : "bin";
}
