import { createHash } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { readFile, rename, writeFile } from "fs/promises";
import { dirname } from "path";
import {
  DEFAULT_BEHAVIOR,
  DEFAULT_PREFERENCES,
  type BehaviorPreferences,
  type DeviceRecord,
  type DeviceSummary,
  type EventPreferences,
  type PushSubscriptionInput,
} from "./types";

/**
 * One-file JSON store for Web Push subscriptions, keyed by user email.
 * In-memory cache + write-through (atomic temp-file + rename) — same
 * pattern the audit writer uses for its meta.json.
 */

const DEFAULT_STORE_PATH = "/root/.config/push-subscriptions.json";

type StoredShape = Record<string, DeviceRecord[]>;

interface StoreState {
  byEmail: Map<string, DeviceRecord[]>;
  loaded: boolean;
  loadingPromise: Promise<void> | null;
}

interface PushStore {
  list(email: string): Promise<DeviceRecord[]>;
  listSummary(email: string, currentEndpoint?: string): Promise<DeviceSummary[]>;
  getById(email: string, id: string): Promise<DeviceRecord | null>;
  upsert(
    email: string,
    sub: PushSubscriptionInput,
    label: string,
    events?: Partial<EventPreferences>,
    behavior?: Partial<BehaviorPreferences>,
  ): Promise<DeviceRecord>;
  updatePreferences(
    email: string,
    id: string,
    patch: {
      label?: string;
      events?: Partial<EventPreferences>;
      behavior?: Partial<BehaviorPreferences>;
    },
  ): Promise<DeviceRecord | null>;
  remove(email: string, id: string): Promise<boolean>;
  removeByEndpoint(endpoint: string): Promise<void>;
  clear(email: string): Promise<number>;
  /**
   * Drop every subscription for every user. Used as a one-shot recovery
   * step when the VAPID keypair changes (otherwise existing subscriptions
   * point at a public key the server can no longer sign for, and every
   * push fails with 401/403). Returns the count of records removed.
   */
  clearAllAcrossUsers(): Promise<number>;
  /** Iterate all subscriptions whose `events[kind]` is true. Server-side only. */
  forEachWithEvent(
    kind: keyof EventPreferences,
    fn: (email: string, device: DeviceRecord) => void,
  ): Promise<void>;
  /** For a specific user, iterate devices subscribed to `kind`. */
  forUserWithEvent(
    email: string,
    kind: keyof EventPreferences,
    fn: (device: DeviceRecord) => void,
  ): Promise<void>;
  /** Force-load (test helper). */
  reloadFromDisk(): Promise<void>;
  /** Path the store writes to (test helper). */
  getPath(): string;
}

interface PushStoreOptions {
  path?: string;
}

/**
 * Strip a `DeviceRecord` down to the public projection that's safe to
 * send over the network. `endpoint` and `keys` would let anyone
 * impersonate the device with the upstream push service.
 */
export function toSummary(record: DeviceRecord, currentEndpoint?: string): DeviceSummary {
  return {
    id: record.id,
    label: record.label,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
    events: record.events,
    behavior: record.behavior,
    isThisDevice: currentEndpoint ? record.endpoint === currentEndpoint : undefined,
  };
}

function deviceIdFor(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 16);
}

export function createPushStore(opts: PushStoreOptions = {}): PushStore {
  const path = opts.path ?? DEFAULT_STORE_PATH;
  const state: StoreState = {
    byEmail: new Map(),
    loaded: false,
    loadingPromise: null,
  };

  async function ensureLoaded(): Promise<void> {
    if (state.loaded) return;
    if (state.loadingPromise) return state.loadingPromise;
    state.loadingPromise = (async () => {
      let needsPersist = false;
      try {
        if (!existsSync(path)) {
          state.loaded = true;
          return;
        }
        const raw = await readFile(path, "utf-8");
        const parsed = JSON.parse(raw) as StoredShape;
        for (const [email, devices] of Object.entries(parsed)) {
          // Backfill `behavior` on devices written before the field
          // existed so the in-memory shape matches `DeviceRecord`. Track
          // whether anything changed so we can converge the JSON file
          // once instead of re-applying defaults on every load.
          const filled = devices.map((d) => {
            if (d.behavior) return d;
            needsPersist = true;
            return { ...d, behavior: { ...DEFAULT_BEHAVIOR } };
          });
          state.byEmail.set(email, filled);
        }
      } catch (err) {
        console.warn("[push] failed to load subscriptions, starting empty:", err);
      } finally {
        state.loaded = true;
        state.loadingPromise = null;
      }
      if (needsPersist) {
        try {
          await persist();
        } catch (err) {
          console.warn("[push] failed to persist behavior backfill:", err);
        }
      }
    })();
    return state.loadingPromise;
  }

  async function persist(): Promise<void> {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch (err) {
        console.warn("[push] failed to create store dir:", err);
      }
    }
    const obj: StoredShape = {};
    for (const [email, devices] of state.byEmail) {
      if (devices.length > 0) obj[email] = devices;
    }
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(obj, null, 2), "utf-8");
    await rename(tmp, path);
  }

  return {
    async list(email) {
      await ensureLoaded();
      return state.byEmail.get(email) ?? [];
    },

    async listSummary(email, currentEndpoint) {
      const devices = await this.list(email);
      return devices.map((d) => toSummary(d, currentEndpoint));
    },

    async getById(email, id) {
      const devices = await this.list(email);
      return devices.find((d) => d.id === id) ?? null;
    },

    async upsert(email, sub, label, events, behavior) {
      await ensureLoaded();
      const id = deviceIdFor(sub.endpoint);
      const now = Date.now();
      const existing = state.byEmail.get(email) ?? [];
      const idx = existing.findIndex((d) => d.id === id);
      const merged: DeviceRecord = {
        id,
        endpoint: sub.endpoint,
        keys: sub.keys,
        label,
        createdAt: idx >= 0 ? existing[idx].createdAt : now,
        lastSeenAt: now,
        events: {
          ...DEFAULT_PREFERENCES,
          ...(idx >= 0 ? existing[idx].events : {}),
          ...(events ?? {}),
        },
        behavior: {
          ...DEFAULT_BEHAVIOR,
          ...(idx >= 0 ? existing[idx].behavior : {}),
          ...(behavior ?? {}),
        },
      };
      if (idx >= 0) existing[idx] = merged;
      else existing.push(merged);
      state.byEmail.set(email, existing);
      await persist();
      return merged;
    },

    async updatePreferences(email, id, patch) {
      await ensureLoaded();
      const devices = state.byEmail.get(email);
      if (!devices) return null;
      const idx = devices.findIndex((d) => d.id === id);
      if (idx < 0) return null;
      const updated: DeviceRecord = {
        ...devices[idx],
        label: patch.label ?? devices[idx].label,
        events: { ...devices[idx].events, ...(patch.events ?? {}) },
        behavior: { ...devices[idx].behavior, ...(patch.behavior ?? {}) },
        lastSeenAt: Date.now(),
      };
      devices[idx] = updated;
      state.byEmail.set(email, devices);
      await persist();
      return updated;
    },

    async remove(email, id) {
      await ensureLoaded();
      const devices = state.byEmail.get(email);
      if (!devices) return false;
      const next = devices.filter((d) => d.id !== id);
      if (next.length === devices.length) return false;
      if (next.length === 0) state.byEmail.delete(email);
      else state.byEmail.set(email, next);
      await persist();
      return true;
    },

    async removeByEndpoint(endpoint) {
      await ensureLoaded();
      let touched = false;
      for (const [email, devices] of state.byEmail) {
        const next = devices.filter((d) => d.endpoint !== endpoint);
        if (next.length !== devices.length) {
          touched = true;
          if (next.length === 0) state.byEmail.delete(email);
          else state.byEmail.set(email, next);
        }
      }
      if (touched) await persist();
    },

    async clear(email) {
      await ensureLoaded();
      const devices = state.byEmail.get(email);
      if (!devices) return 0;
      const count = devices.length;
      state.byEmail.delete(email);
      await persist();
      return count;
    },

    async clearAllAcrossUsers() {
      await ensureLoaded();
      let count = 0;
      for (const devices of state.byEmail.values()) count += devices.length;
      if (count === 0) return 0;
      state.byEmail.clear();
      await persist();
      return count;
    },

    async forEachWithEvent(kind, fn) {
      await ensureLoaded();
      for (const [email, devices] of state.byEmail) {
        for (const d of devices) {
          if (d.events[kind]) fn(email, d);
        }
      }
    },

    async forUserWithEvent(email, kind, fn) {
      const devices = await this.list(email);
      for (const d of devices) {
        if (d.events[kind]) fn(d);
      }
    },

    async reloadFromDisk() {
      state.byEmail.clear();
      state.loaded = false;
      state.loadingPromise = null;
      await ensureLoaded();
    },

    getPath() {
      return path;
    },
  };
}

let _instance: PushStore | null = null;
export function getPushStore(): PushStore {
  if (!_instance) _instance = createPushStore();
  return _instance;
}
