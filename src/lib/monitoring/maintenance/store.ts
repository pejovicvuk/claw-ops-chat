import { existsSync } from "fs";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname } from "path";
import type { MaintenanceWindow } from "../types";

const STORE_PATH = "/root/.monitoring/maintenance.json";

interface StoreFile {
  v: 1;
  windows: MaintenanceWindow[];
}

async function ensureDir(): Promise<void> {
  const dir = dirname(STORE_PATH);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function readStore(): Promise<StoreFile> {
  if (!existsSync(STORE_PATH)) return { v: 1, windows: [] };
  try {
    const raw = await readFile(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as StoreFile;
    if (parsed.v !== 1 || !Array.isArray(parsed.windows)) return { v: 1, windows: [] };
    return parsed;
  } catch {
    return { v: 1, windows: [] };
  }
}

async function writeStore(file: StoreFile): Promise<void> {
  await ensureDir();
  const tmp = `${STORE_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), "utf-8");
  await rename(tmp, STORE_PATH);
}

export async function listWindows(): Promise<MaintenanceWindow[]> {
  return (await readStore()).windows;
}

export async function getWindow(id: string): Promise<MaintenanceWindow | null> {
  return (await readStore()).windows.find((w) => w.id === id) ?? null;
}

export async function createWindow(
  input: Omit<MaintenanceWindow, "id" | "createdAt" | "updatedAt">,
): Promise<MaintenanceWindow> {
  const store = await readStore();
  const now = Date.now();
  const window: MaintenanceWindow = {
    ...input,
    id: `mw_${now}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
  };
  store.windows.push(window);
  await writeStore(store);
  return window;
}

export async function updateWindow(
  id: string,
  patch: Partial<Omit<MaintenanceWindow, "id" | "createdAt">>,
): Promise<MaintenanceWindow | null> {
  const store = await readStore();
  const idx = store.windows.findIndex((w) => w.id === id);
  if (idx === -1) return null;
  store.windows[idx] = {
    ...store.windows[idx],
    ...patch,
    id: store.windows[idx].id,
    createdAt: store.windows[idx].createdAt,
    updatedAt: Date.now(),
  };
  await writeStore(store);
  return store.windows[idx];
}

export async function deleteWindow(id: string): Promise<boolean> {
  const store = await readStore();
  const before = store.windows.length;
  store.windows = store.windows.filter((w) => w.id !== id);
  if (store.windows.length === before) return false;
  await writeStore(store);
  return true;
}

/**
 * Returns the active maintenance window covering `ruleId` right now (or
 * a global window with no rule scope). Used by the alert engine to
 * suppress evaluation during scheduled maintenance.
 */
export async function isInMaintenanceWindow(
  ruleId: string,
  at: number = Date.now(),
): Promise<MaintenanceWindow | null> {
  const windows = await listWindows();
  for (const w of windows) {
    if (w.startsAt <= at && at <= w.endsAt) {
      if (!w.ruleIds || w.ruleIds.length === 0) return w;
      if (w.ruleIds.includes(ruleId)) return w;
    }
  }
  return null;
}
