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

/* ------------------------------------------------------------------ */
/*  Pretty labels + byte formatting for FileCard                       */
/* ------------------------------------------------------------------ */

const PRETTY_LABEL: Record<string, string> = {
  png: "PNG image",
  jpg: "JPEG image",
  jpeg: "JPEG image",
  gif: "GIF image",
  webp: "WebP image",
  svg: "SVG image",
  avif: "AVIF image",
  bmp: "Bitmap",
  ico: "Icon",
  heic: "HEIC image",
  heif: "HEIF image",
  pdf: "PDF",
  pptx: "PowerPoint",
  ppt: "PowerPoint (legacy)",
  docx: "Word document",
  doc: "Word (legacy)",
  xlsx: "Excel",
  xls: "Excel (legacy)",
  odt: "OpenDocument Text",
  ods: "OpenDocument Sheet",
  odp: "OpenDocument Presentation",
  rtf: "Rich text",
  zip: "ZIP archive",
  tar: "TAR archive",
  gz: "gzip archive",
  tgz: "gzipped TAR",
  "7z": "7-Zip archive",
  rar: "RAR archive",
  bz2: "bzip2 archive",
  xz: "xz archive",
  mp4: "Video",
  mov: "QuickTime video",
  webm: "WebM video",
  mkv: "MKV video",
  m4v: "Video (M4V)",
  mp3: "Audio",
  wav: "WAV audio",
  ogg: "Ogg audio",
  m4a: "AAC audio",
  flac: "FLAC audio",
  aac: "AAC audio",
  md: "Markdown",
  mdx: "MDX",
  txt: "Text",
  log: "Log",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  csv: "CSV",
  html: "HTML document",
  htm: "HTML document",
  xml: "XML",
  ts: "TypeScript",
  tsx: "TypeScript (JSX)",
  js: "JavaScript",
  jsx: "JavaScript (JSX)",
  mjs: "JavaScript (ES module)",
  cjs: "JavaScript (CommonJS)",
  py: "Python",
  rs: "Rust",
  go: "Go",
  sh: "Shell script",
  bash: "Bash script",
  zsh: "Zsh script",
  rb: "Ruby",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  c: "C source",
  cpp: "C++ source",
  h: "C header",
  hpp: "C++ header",
  cs: "C# source",
  sql: "SQL",
  toml: "TOML",
  env: "Env file",
  conf: "Config",
  ini: "INI",
};

/** Human-readable file-type label for attachment cards. */
export function prettyMimeLabel(path: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(path);
  if (!match) return "File";
  const ext = match[1].toLowerCase();
  return PRETTY_LABEL[ext] ?? ext.toUpperCase();
}

/** `1536` → `"1.5 KB"`, `2_400_000` → `"2.4 MB"`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
