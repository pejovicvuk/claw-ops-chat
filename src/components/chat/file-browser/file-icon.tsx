"use client";

import {
  FiArchive,
  FiCode,
  FiFile,
  FiFileText,
  FiFilm,
  FiFolder,
  FiImage,
  FiMusic,
} from "react-icons/fi";
import type { IconType } from "react-icons";
import type { FileEntry } from "@/lib/types";

interface FileIconProps {
  entry: FileEntry;
  size?: number;
}

interface IconSpec {
  icon: IconType;
  cls: string;
}

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "avif"]);
const AUDIO = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"]);
const VIDEO = new Set(["mp4", "webm", "mov", "avi", "mkv", "m4v"]);
const ARCHIVE = new Set(["zip", "tar", "gz", "tgz", "7z", "rar", "bz2", "xz"]);
const CODE = new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "json",
  "html",
  "css",
  "scss",
  "less",
  "py",
  "rs",
  "go",
  "java",
  "kt",
  "swift",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "sh",
  "bash",
  "zsh",
  "yml",
  "yaml",
  "toml",
  "xml",
  "sql",
  "rb",
  "php",
]);
const DOC = new Set(["md", "mdx", "txt", "pdf", "doc", "docx", "rtf", "odt", "csv"]);

function iconFor(ext: string): IconSpec {
  if (IMAGE.has(ext)) return { icon: FiImage, cls: "text-pink-400" };
  if (AUDIO.has(ext)) return { icon: FiMusic, cls: "text-purple-400" };
  if (VIDEO.has(ext)) return { icon: FiFilm, cls: "text-red-400" };
  if (ARCHIVE.has(ext)) return { icon: FiArchive, cls: "text-yellow-500" };
  if (CODE.has(ext)) return { icon: FiCode, cls: "text-green-400" };
  if (DOC.has(ext)) return { icon: FiFileText, cls: "text-cyan-400" };
  return { icon: FiFile, cls: "text-canvas-muted" };
}

export function FileIcon({ entry, size = 14 }: FileIconProps) {
  if (entry.directory) {
    return <FiFolder size={size} className="shrink-0 text-blue-400" aria-hidden />;
  }
  const ext = entry.name.includes(".") ? (entry.name.split(".").pop() ?? "").toLowerCase() : "";
  const { icon: Icon, cls } = iconFor(ext);
  return <Icon size={size} className={`shrink-0 ${cls}`} aria-hidden />;
}
