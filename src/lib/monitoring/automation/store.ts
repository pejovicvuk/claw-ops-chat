import { existsSync } from "fs";
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "fs/promises";
import { dirname } from "path";
import { DEFAULT_RULES, instantiateDefault } from "./defaults";
import type { AutomationRule, AutomationRun } from "./types";

const STORE_PATH = "/root/.monitoring/automation.json";
const RUNS_PATH = "/root/.monitoring/automation-runs.jsonl";
const MAX_RUNS_BYTES = 10 * 1024 * 1024; // 10 MB cap on the run history JSONL

interface StoreFile {
  v: 1;
  rules: AutomationRule[];
}

async function ensureDir(): Promise<void> {
  const dir = dirname(STORE_PATH);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function readStore(): Promise<StoreFile> {
  if (!existsSync(STORE_PATH)) return { v: 1, rules: [] };
  try {
    const raw = await readFile(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as StoreFile;
    if (parsed.v !== 1 || !Array.isArray(parsed.rules)) return { v: 1, rules: [] };
    return parsed;
  } catch {
    return { v: 1, rules: [] };
  }
}

async function writeStore(file: StoreFile): Promise<void> {
  await ensureDir();
  const tmp = `${STORE_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), "utf-8");
  await rename(tmp, STORE_PATH);
}

export async function listRules(): Promise<AutomationRule[]> {
  return (await readStore()).rules;
}

export async function getRule(id: string): Promise<AutomationRule | null> {
  return (await readStore()).rules.find((r) => r.id === id) ?? null;
}

export async function createRule(
  input: Omit<AutomationRule, "id" | "createdAt" | "updatedAt">,
): Promise<AutomationRule> {
  const store = await readStore();
  const now = Date.now();
  const rule: AutomationRule = {
    ...input,
    id: `rule_${now}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
  };
  store.rules.push(rule);
  await writeStore(store);
  return rule;
}

export async function updateRule(
  id: string,
  patch: Partial<Omit<AutomationRule, "id" | "createdAt">>,
): Promise<AutomationRule | null> {
  const store = await readStore();
  const idx = store.rules.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  store.rules[idx] = {
    ...store.rules[idx],
    ...patch,
    id: store.rules[idx].id,
    createdAt: store.rules[idx].createdAt,
    updatedAt: Date.now(),
  };
  await writeStore(store);
  return store.rules[idx];
}

export async function deleteRule(id: string): Promise<boolean> {
  const store = await readStore();
  const before = store.rules.length;
  store.rules = store.rules.filter((r) => r.id !== id);
  if (store.rules.length === before) return false;
  await writeStore(store);
  return true;
}

/**
 * Idempotent default-rule installer. Only inserts rules whose `id` is
 * missing from the current store. Existing user-modified rules are
 * untouched. Triggered at boot if the store is empty, and from the
 * "Restore defaults" admin action.
 */
export async function ensureDefaults(): Promise<{ added: number }> {
  const store = await readStore();
  const existingIds = new Set(store.rules.map((r) => r.id));
  const now = Date.now();
  let added = 0;
  for (const seed of DEFAULT_RULES) {
    const rule = instantiateDefault(seed, now);
    if (existingIds.has(rule.id)) continue;
    store.rules.push(rule);
    added += 1;
  }
  if (added > 0) await writeStore(store);
  return { added };
}

/* ----------------------------- Run history ----------------------------- */

export async function appendRun(run: AutomationRun): Promise<void> {
  await ensureDir();
  await rotateIfTooLarge();
  await appendFile(RUNS_PATH, `${JSON.stringify(run)}\n`, "utf-8");
}

export async function listRecentRuns(limit = 50): Promise<AutomationRun[]> {
  if (!existsSync(RUNS_PATH)) return [];
  const raw = await readFile(RUNS_PATH, "utf-8").catch(() => "");
  if (!raw) return [];
  const lines = raw.split("\n").filter((l) => l.length > 0);
  // Keep newest first.
  const out: AutomationRun[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
    try {
      out.push(JSON.parse(lines[i]) as AutomationRun);
    } catch {
      /* skip malformed lines */
    }
  }
  return out;
}

async function rotateIfTooLarge(): Promise<void> {
  try {
    const s = await stat(RUNS_PATH);
    if (s.size > MAX_RUNS_BYTES) {
      // Truncate to last half by reading + rewriting.
      const raw = await readFile(RUNS_PATH, "utf-8");
      const lines = raw.split("\n").filter((l) => l.length > 0);
      const keep = lines.slice(Math.floor(lines.length / 2));
      const tmp = `${RUNS_PATH}.tmp`;
      await writeFile(tmp, keep.length > 0 ? `${keep.join("\n")}\n` : "", "utf-8");
      await rename(tmp, RUNS_PATH);
    }
  } catch {
    /* file may not exist yet or stat failed — ignore */
  }
}
