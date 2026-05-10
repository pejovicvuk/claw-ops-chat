import { existsSync } from "fs";
import { mkdir, readFile, rename, stat, writeFile } from "fs/promises";
import { dirname } from "path";

import { AUTO_MEMORY_MAX_BYTES, autoMemoryPath } from "./paths";

/**
 * Storage for the consolidator-written `auto.md` file. Distinct from
 * the curated memory store because (a) it's a single file with a
 * tighter cap, (b) writes come from a model, not from the user, and
 * (c) the diff applier needs to be aware of "facts" as line-delimited
 * units, not arbitrary text blobs.
 */

/**
 * One auto-collected fact. Stored on disk as a single line under a
 * `# Auto-collected memory` header inside `auto.md`. Each line is a
 * complete third-person sentence written by the consolidator.
 */
export type Fact = string;

const HEADER = "# Auto-collected memory";
const MAX_FACT_LEN = 500;
/**
 * Reject facts that *look* like instructions to the AI rather than
 * facts about the user. The consolidator's system prompt forbids these,
 * but defence-in-depth is cheap.
 */
const IMPERATIVE_PREFIX = /^(do|don't|never|always|use|prefer|avoid|please|make sure)\b/i;

export interface AutoMemoryDiff {
  /** New facts to append (deduplicated against existing). */
  add: string[];
  /**
   * Facts to remove. Matches by exact line content (after trim). Lines
   * that don't match are silently ignored — consolidator may suggest
   * removing facts that no longer exist after a previous trim.
   */
  remove: string[];
}

export interface AutoMemoryFile {
  /** Whole-file content (header + facts) as it sits on disk. */
  content: string;
  /** Parsed list of facts in storage order. Excludes header / blanks. */
  facts: Fact[];
  /** UTC ms timestamp of last write, or null if file doesn't exist. */
  updatedAt: number | null;
  /** Byte length on disk, or 0. */
  size: number;
}

/** Parse a stored `auto.md` body back into individual facts. */
export function parseFacts(content: string): Fact[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/** Render a list of facts back into a stored `auto.md` body. */
export function renderFacts(facts: Fact[]): string {
  if (facts.length === 0) return "";
  return [HEADER, "", ...facts, ""].join("\n");
}

export async function readAutoMemory(): Promise<AutoMemoryFile> {
  const path = autoMemoryPath();
  if (!existsSync(path)) {
    return { content: "", facts: [], updatedAt: null, size: 0 };
  }
  try {
    const [content, info] = await Promise.all([readFile(path, "utf-8"), stat(path)]);
    return {
      content,
      facts: parseFacts(content),
      updatedAt: info.mtimeMs,
      size: info.size,
    };
  } catch {
    return { content: "", facts: [], updatedAt: null, size: 0 };
  }
}

export interface ApplyResult {
  facts: Fact[];
  added: number;
  removed: number;
  rejected: { fact: string; reason: string }[];
  /** True when the cap forced us to drop oldest facts. */
  trimmed: boolean;
}

/**
 * Apply a consolidator diff to an existing fact list. Pure function —
 * does NOT touch disk. Validates each candidate fact, dedupes against
 * existing entries, and trims oldest facts when the cap is exceeded.
 */
export function applyDiff(existing: Fact[], diff: AutoMemoryDiff): ApplyResult {
  const rejected: ApplyResult["rejected"] = [];
  let working = [...existing];

  // Removals first — substring-trimmed exact match.
  const toRemove = new Set(diff.remove.map((s) => s.trim()).filter(Boolean));
  if (toRemove.size > 0) {
    working = working.filter((f) => !toRemove.has(f.trim()));
  }
  const removed = existing.length - working.length;

  // Additions — validate, dedupe, append.
  let added = 0;
  for (const candidateRaw of diff.add) {
    if (typeof candidateRaw !== "string") {
      rejected.push({ fact: String(candidateRaw), reason: "not a string" });
      continue;
    }
    const candidate = candidateRaw.trim();
    if (candidate.length === 0) {
      rejected.push({ fact: candidateRaw, reason: "empty" });
      continue;
    }
    if (candidate.length > MAX_FACT_LEN) {
      rejected.push({ fact: candidate, reason: `exceeds ${MAX_FACT_LEN} chars` });
      continue;
    }
    if (/[\r\n]/.test(candidate)) {
      rejected.push({ fact: candidate, reason: "contains newline" });
      continue;
    }
    if (IMPERATIVE_PREFIX.test(candidate)) {
      rejected.push({ fact: candidate, reason: "looks like an instruction, not a fact" });
      continue;
    }
    if (working.some((f) => f.trim().toLowerCase() === candidate.toLowerCase())) {
      rejected.push({ fact: candidate, reason: "duplicate" });
      continue;
    }
    working.push(candidate);
    added += 1;
  }

  // Cap enforcement — drop oldest until rendered size fits.
  let trimmed = false;
  while (Buffer.byteLength(renderFacts(working), "utf8") > AUTO_MEMORY_MAX_BYTES) {
    if (working.length === 0) break;
    working.shift();
    trimmed = true;
  }

  return { facts: working, added, removed, rejected, trimmed };
}

/**
 * Atomic write of the rendered fact list to `auto.md`. Empty fact list
 * deletes the file (clean state when nothing to remember).
 */
export async function writeAutoMemory(facts: Fact[]): Promise<void> {
  const path = autoMemoryPath();
  await mkdir(dirname(path), { recursive: true });
  if (facts.length === 0) {
    // Empty state: write empty file rather than leaving stale content.
    const tmp = `${path}.tmp`;
    await writeFile(tmp, "", "utf-8");
    await rename(tmp, path);
    return;
  }
  const tmp = `${path}.tmp`;
  await writeFile(tmp, renderFacts(facts), "utf-8");
  await rename(tmp, path);
}
