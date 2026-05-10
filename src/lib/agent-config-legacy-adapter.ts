import { existsSync } from "fs";
import { unlink } from "fs/promises";
import { join } from "path";

import { globalMemoryDir } from "./memory/paths";
import { deleteMemoryFile, listMemoryFiles, readMemoryFile, writeMemoryFile } from "./memory/store";
import { MemoryValidationError } from "./memory/validation";

/**
 * Back-compat shim for the legacy `/api/agent-config/{system-prompt,rules}`
 * routes. Phase 2 of the Memory feature absorbed those surfaces into
 * `/root/.memory/global/`, but we kept the old HTTP routes alive for one
 * release window so external callers (the broader ClawOps stack, browser
 * bookmarks, scripted automation) keep working.
 *
 *   System prompt → /root/.memory/global/instructions.md
 *   Rule "<name>" → /root/.memory/global/rules/<name>.md
 *
 * This module preserves the legacy response shapes so the old routes can
 * continue to return the JSON their callers already parse.
 *
 * Slated for removal in the same PR that strips `getCustomAppendForSdk()`
 * (see plan: Phase 2, "Decisions baked in").
 */

const INSTRUCTIONS_REL = "instructions.md";
const RULES_PREFIX = "rules/";
/** Slug shape the legacy rule routes accepted; matched here so memory
 * paths constructed from a name pass MEMORY_PATH_RE. */
const LEGACY_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class LegacyAdapterError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "LegacyAdapterError";
  }
}

export interface LegacySystemPromptRecord {
  prompt: string;
  updatedAt: number | null;
}

export async function loadLegacyInstructions(): Promise<LegacySystemPromptRecord> {
  const path = join(globalMemoryDir(), INSTRUCTIONS_REL);
  if (!existsSync(path)) return { prompt: "", updatedAt: null };
  try {
    const record = await readMemoryFile(globalMemoryDir(), INSTRUCTIONS_REL);
    return { prompt: record.content, updatedAt: record.updatedAt };
  } catch {
    return { prompt: "", updatedAt: null };
  }
}

export async function saveLegacyInstructions(prompt: string): Promise<void> {
  try {
    await writeMemoryFile(globalMemoryDir(), INSTRUCTIONS_REL, prompt);
  } catch (err) {
    if (err instanceof MemoryValidationError) {
      throw new LegacyAdapterError(err.message, err.status);
    }
    throw err;
  }
}

export async function deleteLegacyInstructions(): Promise<void> {
  const path = join(globalMemoryDir(), INSTRUCTIONS_REL);
  if (existsSync(path)) {
    await unlink(path).catch(() => {});
  }
}

export interface LegacyRuleItem {
  name: string;
  preview: string;
  size: number;
  updatedAt: number;
}

export interface LegacyRuleRecord {
  name: string;
  content: string;
  updatedAt: number;
}

function assertLegacyName(name: string): void {
  if (!LEGACY_NAME_RE.test(name)) {
    throw new LegacyAdapterError(
      "Invalid name. Use lowercase letters, digits, or dashes (up to 64 chars).",
      400,
    );
  }
}

function ruleRelPath(name: string): string {
  return `${RULES_PREFIX}${name}.md`;
}

export async function listLegacyRules(): Promise<LegacyRuleItem[]> {
  const files = await listMemoryFiles(globalMemoryDir());
  return files
    .filter(
      (f) => f.path.startsWith(RULES_PREFIX) && !f.path.slice(RULES_PREFIX.length).includes("/"),
    )
    .map((f) => ({
      name: f.path.slice(RULES_PREFIX.length, -".md".length),
      preview: f.preview,
      size: f.size,
      updatedAt: f.updatedAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function readLegacyRule(name: string): Promise<LegacyRuleRecord> {
  assertLegacyName(name);
  try {
    const record = await readMemoryFile(globalMemoryDir(), ruleRelPath(name));
    return { name, content: record.content, updatedAt: record.updatedAt };
  } catch (err) {
    if (err instanceof MemoryValidationError) {
      throw new LegacyAdapterError(err.message, err.status);
    }
    throw err;
  }
}

export async function createLegacyRule(name: string, content: string): Promise<void> {
  assertLegacyName(name);
  const path = join(globalMemoryDir(), ruleRelPath(name));
  if (existsSync(path)) {
    throw new LegacyAdapterError("Already exists", 409);
  }
  try {
    await writeMemoryFile(globalMemoryDir(), ruleRelPath(name), content);
  } catch (err) {
    if (err instanceof MemoryValidationError) {
      throw new LegacyAdapterError(err.message, err.status);
    }
    throw err;
  }
}

export async function updateLegacyRule(name: string, content: string): Promise<void> {
  assertLegacyName(name);
  const path = join(globalMemoryDir(), ruleRelPath(name));
  if (!existsSync(path)) {
    throw new LegacyAdapterError("Not found", 404);
  }
  try {
    await writeMemoryFile(globalMemoryDir(), ruleRelPath(name), content);
  } catch (err) {
    if (err instanceof MemoryValidationError) {
      throw new LegacyAdapterError(err.message, err.status);
    }
    throw err;
  }
}

export async function deleteLegacyRule(name: string): Promise<void> {
  assertLegacyName(name);
  try {
    await deleteMemoryFile(globalMemoryDir(), ruleRelPath(name));
  } catch (err) {
    if (err instanceof MemoryValidationError) {
      throw new LegacyAdapterError(err.message, err.status);
    }
    throw err;
  }
}

/** Header to mark the legacy routes as scheduled for removal. */
export const DEPRECATION_HEADER = {
  Deprecation: "true",
  Link: '</chat/api/memory/global>; rel="successor-version"',
} as const;
