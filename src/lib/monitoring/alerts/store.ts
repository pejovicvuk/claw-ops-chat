import { existsSync } from "fs";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname } from "path";
import type { AlertRule } from "../types";

const STORE_PATH = "/root/.monitoring/alerts.json";

interface StoreFile {
  v: 1;
  rules: AlertRule[];
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

export async function listRules(): Promise<AlertRule[]> {
  return (await readStore()).rules;
}

export async function getRule(id: string): Promise<AlertRule | null> {
  const store = await readStore();
  return store.rules.find((r) => r.id === id) ?? null;
}

export async function createRule(
  input: Omit<AlertRule, "id" | "createdAt" | "updatedAt">,
): Promise<AlertRule> {
  const store = await readStore();
  const now = Date.now();
  const rule: AlertRule = {
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
  patch: Partial<Omit<AlertRule, "id" | "createdAt">>,
): Promise<AlertRule | null> {
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
