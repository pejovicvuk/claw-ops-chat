import { existsSync } from "fs";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "fs/promises";
import { join, resolve, sep } from "path";
import { homedir } from "os";

/**
 * Disk persistence for the "Agent behavior" settings — a custom system
 * prompt append, plus CRUD over rules / skills / subagents that the
 * Claude Agent SDK will pick up when it runs.
 *
 * Storage lives under `$CLAUDE_CWD/.claude/` (defaults to `~/.claude/`):
 *
 *   custom-system-prompt.md        — whole file is the append text
 *   rules/<name>.md                — free-form rule markdown
 *   agents/<name>.md               — subagent markdown + frontmatter
 *   skills/<name>/SKILL.md         — skill recipe + frontmatter
 *
 * The SDK loads agents + skills natively when `settingSources: ['project']`
 * is set. Rules aren't a first-class SDK concept, so server.ts concatenates
 * their contents into the system prompt `append` string via
 * getCustomAppendForSdk().
 */

export type AgentConfigKind = "rules" | "skills" | "subagents";

/** Per-file content cap. Keeps UI payloads bounded. */
export const MAX_CONTENT_BYTES = 64 * 1024;

/** Filename policy: lowercase kebab, digits, no leading dash / dot. */
const NAME_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The on-disk directory for a given resource kind. */
const KIND_DIR: Record<AgentConfigKind, string> = {
  rules: "rules",
  skills: "skills",
  subagents: "agents",
};

function baseDir(): string {
  return process.env.CLAUDE_CWD || homedir();
}

function claudeDir(): string {
  return join(baseDir(), ".claude");
}

function kindDir(kind: AgentConfigKind): string {
  return join(claudeDir(), KIND_DIR[kind]);
}

const PROMPT_FILE = () => join(claudeDir(), "custom-system-prompt.md");

export class AgentConfigError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AgentConfigError";
    this.status = status;
  }
}

function assertValidName(name: string): void {
  if (typeof name !== "string" || !NAME_REGEX.test(name)) {
    throw new AgentConfigError(
      "Invalid name. Use lowercase letters, digits, or dashes (up to 64 chars, no leading dash).",
    );
  }
}

/**
 * Resolve the absolute filesystem path for a kind + optional name, with
 * path-traversal + symlink-escape defense. Even though NAME_REGEX already
 * rejects `/` and `..`, we also compare the resolved absolute path against
 * the expected directory prefix so a future bug in the regex can't
 * silently leak writes outside the intended tree.
 */
function resolveKindPath(kind: AgentConfigKind, name?: string): string {
  const root = kindDir(kind);
  if (name === undefined) return root;
  assertValidName(name);
  const leaf = kind === "skills" ? join(name, "SKILL.md") : `${name}.md`;
  const abs = resolve(root, leaf);
  const expectedPrefix = resolve(root) + sep;
  if (!abs.startsWith(expectedPrefix)) {
    throw new AgentConfigError("Resolved path escapes the allowed directory", 400);
  }
  return abs;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, path);
  try {
    await chmod(path, 0o600);
  } catch {
    /* ignore — non-POSIX or already correct */
  }
}

function enforceSize(content: string): void {
  const bytes = Buffer.byteLength(content, "utf-8");
  if (bytes > MAX_CONTENT_BYTES) {
    throw new AgentConfigError(`Content exceeds ${MAX_CONTENT_BYTES} bytes (got ${bytes})`, 413);
  }
}

/* ---------------------------------------------------------------- */
/*  Custom system prompt (append)                                    */
/* ---------------------------------------------------------------- */

export interface SystemPromptRecord {
  prompt: string;
  updatedAt: number | null;
}

export async function loadSystemPromptAppend(): Promise<SystemPromptRecord> {
  const path = PROMPT_FILE();
  if (!existsSync(path)) return { prompt: "", updatedAt: null };
  try {
    const [content, info] = await Promise.all([readFile(path, "utf-8"), stat(path)]);
    return { prompt: content, updatedAt: info.mtimeMs };
  } catch {
    return { prompt: "", updatedAt: null };
  }
}

export async function saveSystemPromptAppend(prompt: string): Promise<void> {
  enforceSize(prompt);
  await atomicWrite(PROMPT_FILE(), prompt);
}

export async function deleteSystemPromptAppend(): Promise<void> {
  const path = PROMPT_FILE();
  if (existsSync(path)) {
    await unlink(path).catch(() => {});
  }
}

/* ---------------------------------------------------------------- */
/*  Rules / Subagents (flat <name>.md files)                         */
/* ---------------------------------------------------------------- */

export interface FileItem {
  name: string;
  /** First 200 chars, whitespace-collapsed, for preview rows. */
  preview: string;
  size: number;
  updatedAt: number;
  /** Optional, parsed from frontmatter for skills/subagents. */
  description?: string;
}

async function readFlatList(kind: "rules" | "subagents"): Promise<FileItem[]> {
  const dir = kindDir(kind);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out: FileItem[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;
    const bare = entry.name.slice(0, -3);
    if (!NAME_REGEX.test(bare)) continue;
    try {
      const path = join(dir, entry.name);
      const [content, info] = await Promise.all([readFile(path, "utf-8"), stat(path)]);
      out.push({
        name: bare,
        preview: makePreview(content),
        size: info.size,
        updatedAt: info.mtimeMs,
        description:
          kind === "subagents" ? parseFrontmatterField(content, "description") : undefined,
      });
    } catch {
      /* skip unreadable files */
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export interface FileRecord {
  name: string;
  content: string;
  updatedAt: number;
}

async function readFlatFile(kind: "rules" | "subagents", name: string): Promise<FileRecord> {
  const path = resolveKindPath(kind, name);
  if (!existsSync(path)) {
    throw new AgentConfigError("Not found", 404);
  }
  const [content, info] = await Promise.all([readFile(path, "utf-8"), stat(path)]);
  return { name, content, updatedAt: info.mtimeMs };
}

async function writeFlatFile(
  kind: "rules" | "subagents",
  name: string,
  content: string,
  { create }: { create: boolean },
): Promise<void> {
  enforceSize(content);
  const path = resolveKindPath(kind, name);
  if (create && existsSync(path)) {
    throw new AgentConfigError("Already exists", 409);
  }
  if (!create && !existsSync(path)) {
    throw new AgentConfigError("Not found", 404);
  }
  await atomicWrite(path, content);
}

async function deleteFlatFile(kind: "rules" | "subagents", name: string): Promise<void> {
  const path = resolveKindPath(kind, name);
  if (existsSync(path)) {
    await unlink(path).catch(() => {});
  }
}

export const listRules = () => readFlatList("rules");
export const readRule = (name: string) => readFlatFile("rules", name);
export const createRule = (name: string, content: string) =>
  writeFlatFile("rules", name, content, { create: true });
export const updateRule = (name: string, content: string) =>
  writeFlatFile("rules", name, content, { create: false });
export const deleteRule = (name: string) => deleteFlatFile("rules", name);

export const listSubagents = () => readFlatList("subagents");
export const readSubagent = (name: string) => readFlatFile("subagents", name);
export const createSubagent = (name: string, content: string) =>
  writeFlatFile("subagents", name, content, { create: true });
export const updateSubagent = (name: string, content: string) =>
  writeFlatFile("subagents", name, content, { create: false });
export const deleteSubagent = (name: string) => deleteFlatFile("subagents", name);

/* ---------------------------------------------------------------- */
/*  Skills (<name>/SKILL.md directories)                             */
/* ---------------------------------------------------------------- */

export async function listSkills(): Promise<FileItem[]> {
  const dir = kindDir("skills");
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out: FileItem[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!NAME_REGEX.test(entry.name)) continue;
    const file = join(dir, entry.name, "SKILL.md");
    if (!existsSync(file)) continue;
    try {
      const [content, info] = await Promise.all([readFile(file, "utf-8"), stat(file)]);
      out.push({
        name: entry.name,
        preview: makePreview(content),
        size: info.size,
        updatedAt: info.mtimeMs,
        description: parseFrontmatterField(content, "description"),
      });
    } catch {
      /* skip */
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function readSkill(name: string): Promise<FileRecord> {
  const path = resolveKindPath("skills", name);
  if (!existsSync(path)) {
    throw new AgentConfigError("Not found", 404);
  }
  const [content, info] = await Promise.all([readFile(path, "utf-8"), stat(path)]);
  return { name, content, updatedAt: info.mtimeMs };
}

export async function createSkill(name: string, content: string): Promise<void> {
  enforceSize(content);
  const path = resolveKindPath("skills", name);
  if (existsSync(path)) {
    throw new AgentConfigError("Already exists", 409);
  }
  await atomicWrite(path, content);
}

export async function updateSkill(name: string, content: string): Promise<void> {
  enforceSize(content);
  const path = resolveKindPath("skills", name);
  if (!existsSync(path)) {
    throw new AgentConfigError("Not found", 404);
  }
  await atomicWrite(path, content);
}

export async function deleteSkill(name: string): Promise<void> {
  assertValidName(name);
  const skillDir = join(kindDir("skills"), name);
  const expectedPrefix = resolve(kindDir("skills")) + sep;
  if (!resolve(skillDir).startsWith(expectedPrefix)) {
    throw new AgentConfigError("Resolved path escapes the allowed directory", 400);
  }
  if (existsSync(skillDir)) {
    await rm(skillDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ---------------------------------------------------------------- */
/*  Server-side append assembly (system prompt + rules)              */
/* ---------------------------------------------------------------- */

/**
 * Build the string that server.ts hands the SDK as the system-prompt
 * `append`. Used to combine the legacy custom prompt + rule files; as
 * of Phase 2 of the Memory feature, both have been absorbed into
 * `/root/.memory/global/` and surfaced by `getGlobalMemoryAppend()` in
 * `src/lib/memory/global-injector.ts`.
 *
 * Kept as a no-op so the call site in `server.ts:1223` doesn't churn
 * during the transition. Slated for removal alongside the legacy
 * `/api/agent-config/{system-prompt,rules}` routes in a follow-up PR.
 */
export async function getCustomAppendForSdk(): Promise<string> {
  return "";
}

/* ---------------------------------------------------------------- */
/*  Small helpers (exported for tests)                               */
/* ---------------------------------------------------------------- */

export function makePreview(content: string, limit = 200): string {
  let body = content;
  if (body.startsWith("---\n")) {
    const end = body.indexOf("\n---", 4);
    if (end !== -1) body = body.slice(end + 4);
  }
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  return collapsed.slice(0, limit - 1) + "…";
}

export function parseFrontmatterField(content: string, field: string): string | undefined {
  if (!content.startsWith("---\n")) return undefined;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return undefined;
  const header = content.slice(4, end);
  const needle = new RegExp(`^${field}\\s*:\\s*(.*)$`, "mi");
  const match = header.match(needle);
  if (!match) return undefined;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

export const __test__ = {
  NAME_REGEX,
  assertValidName,
};
