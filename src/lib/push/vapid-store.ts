import { chmodSync, existsSync, mkdirSync } from "fs";
import { readFile, rename, writeFile } from "fs/promises";
import { dirname } from "path";

/**
 * File-backed VAPID keypair persistence.
 *
 * Previously, in production, `getVapidKeys()` only kept generated keys
 * in `process.env`. Every container restart produced a fresh keypair,
 * invalidating every existing browser subscription on the upstream
 * push service (FCM/autopush returned 401/403 → web-push surfaced
 * "Received unexpected response code"). Persisting to disk on the
 * bind-mounted /root volume keeps the keypair stable across restarts
 * so subscriptions stay deliverable.
 *
 * Atomic write (temp + rename) mirrors `store.ts`'s `persist()`. File
 * is chmod 0600 because it carries a private key.
 */

const DEFAULT_PATH = "/root/.config/vapid-keys.json";

export interface PersistedVapidKeys {
  publicKey: string;
  privateKey: string;
  /** Wall-clock millis when the file was first created; useful for diagnostics. */
  createdAt: number;
}

export interface VapidStoreOptions {
  path?: string;
}

export interface VapidStore {
  /** Returns null when the file doesn't exist or is unreadable / malformed. */
  load(): Promise<PersistedVapidKeys | null>;
  /** Atomic write through a temp file; chmod 0600 on the result. */
  save(keys: { publicKey: string; privateKey: string }): Promise<PersistedVapidKeys>;
  /** Path the store reads/writes (test helper). */
  getPath(): string;
}

function isValidShape(v: unknown): v is PersistedVapidKeys {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.publicKey === "string" &&
    o.publicKey.length > 0 &&
    typeof o.privateKey === "string" &&
    o.privateKey.length > 0 &&
    typeof o.createdAt === "number"
  );
}

export function createVapidStore(opts: VapidStoreOptions = {}): VapidStore {
  const path = opts.path ?? DEFAULT_PATH;
  return {
    async load() {
      if (!existsSync(path)) return null;
      try {
        const raw = await readFile(path, "utf-8");
        const parsed = JSON.parse(raw);
        return isValidShape(parsed) ? parsed : null;
      } catch (err) {
        // Corrupt or unreadable — caller decides whether to regenerate.
        // Don't throw; we'd rather generate fresh keys than crash boot.
        console.warn("[push] failed to load VAPID keys file:", err);
        return null;
      }
    },

    async save(keys) {
      const dir = dirname(path);
      if (!existsSync(dir)) {
        try {
          mkdirSync(dir, { recursive: true });
        } catch (err) {
          console.warn("[push] failed to create VAPID dir:", err);
        }
      }
      const payload: PersistedVapidKeys = {
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        createdAt: Date.now(),
      };
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(payload, null, 2), "utf-8");
      await rename(tmp, path);
      try {
        // Best-effort: 0600 so the private key isn't world-readable.
        // Some filesystems (Windows bind mounts in dev) reject chmod;
        // log and continue rather than aborting boot.
        chmodSync(path, 0o600);
      } catch (err) {
        console.warn("[push] failed to chmod VAPID keys file:", err);
      }
      return payload;
    },

    getPath() {
      return path;
    },
  };
}

let _instance: VapidStore | null = null;
export function getVapidStore(): VapidStore {
  if (!_instance) _instance = createVapidStore();
  return _instance;
}
