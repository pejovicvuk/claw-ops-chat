"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toSummary = toSummary;
exports.createPushStore = createPushStore;
exports.getPushStore = getPushStore;
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const types_1 = require("./types");
/**
 * One-file JSON store for Web Push subscriptions, keyed by user email.
 * In-memory cache + write-through (atomic temp-file + rename) — same
 * pattern the audit writer uses for its meta.json.
 */
const DEFAULT_STORE_PATH = "/root/.config/push-subscriptions.json";
/**
 * Strip a `DeviceRecord` down to the public projection that's safe to
 * send over the network. `endpoint` and `keys` would let anyone
 * impersonate the device with the upstream push service.
 */
function toSummary(record, currentEndpoint) {
    return {
        id: record.id,
        label: record.label,
        createdAt: record.createdAt,
        lastSeenAt: record.lastSeenAt,
        events: record.events,
        isThisDevice: currentEndpoint ? record.endpoint === currentEndpoint : undefined,
    };
}
function deviceIdFor(endpoint) {
    return (0, crypto_1.createHash)("sha256").update(endpoint).digest("hex").slice(0, 16);
}
function createPushStore(opts = {}) {
    const path = opts.path ?? DEFAULT_STORE_PATH;
    const state = {
        byEmail: new Map(),
        loaded: false,
        loadingPromise: null,
    };
    async function ensureLoaded() {
        if (state.loaded)
            return;
        if (state.loadingPromise)
            return state.loadingPromise;
        state.loadingPromise = (async () => {
            try {
                if (!(0, fs_1.existsSync)(path)) {
                    state.loaded = true;
                    return;
                }
                const raw = await (0, promises_1.readFile)(path, "utf-8");
                const parsed = JSON.parse(raw);
                for (const [email, devices] of Object.entries(parsed)) {
                    state.byEmail.set(email, devices);
                }
            }
            catch (err) {
                console.warn("[push] failed to load subscriptions, starting empty:", err);
            }
            finally {
                state.loaded = true;
                state.loadingPromise = null;
            }
        })();
        return state.loadingPromise;
    }
    async function persist() {
        const dir = (0, path_1.dirname)(path);
        if (!(0, fs_1.existsSync)(dir)) {
            try {
                (0, fs_1.mkdirSync)(dir, { recursive: true });
            }
            catch (err) {
                console.warn("[push] failed to create store dir:", err);
            }
        }
        const obj = {};
        for (const [email, devices] of state.byEmail) {
            if (devices.length > 0)
                obj[email] = devices;
        }
        const tmp = `${path}.tmp`;
        await (0, promises_1.writeFile)(tmp, JSON.stringify(obj, null, 2), "utf-8");
        await (0, promises_1.rename)(tmp, path);
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
        async upsert(email, sub, label, events) {
            await ensureLoaded();
            const id = deviceIdFor(sub.endpoint);
            const now = Date.now();
            const existing = state.byEmail.get(email) ?? [];
            const idx = existing.findIndex((d) => d.id === id);
            const merged = {
                id,
                endpoint: sub.endpoint,
                keys: sub.keys,
                label,
                createdAt: idx >= 0 ? existing[idx].createdAt : now,
                lastSeenAt: now,
                events: {
                    ...types_1.DEFAULT_PREFERENCES,
                    ...(idx >= 0 ? existing[idx].events : {}),
                    ...(events ?? {}),
                },
            };
            if (idx >= 0)
                existing[idx] = merged;
            else
                existing.push(merged);
            state.byEmail.set(email, existing);
            await persist();
            return merged;
        },
        async updatePreferences(email, id, patch) {
            await ensureLoaded();
            const devices = state.byEmail.get(email);
            if (!devices)
                return null;
            const idx = devices.findIndex((d) => d.id === id);
            if (idx < 0)
                return null;
            const updated = {
                ...devices[idx],
                label: patch.label ?? devices[idx].label,
                events: { ...devices[idx].events, ...(patch.events ?? {}) },
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
            if (!devices)
                return false;
            const next = devices.filter((d) => d.id !== id);
            if (next.length === devices.length)
                return false;
            if (next.length === 0)
                state.byEmail.delete(email);
            else
                state.byEmail.set(email, next);
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
                    if (next.length === 0)
                        state.byEmail.delete(email);
                    else
                        state.byEmail.set(email, next);
                }
            }
            if (touched)
                await persist();
        },
        async clear(email) {
            await ensureLoaded();
            const devices = state.byEmail.get(email);
            if (!devices)
                return 0;
            const count = devices.length;
            state.byEmail.delete(email);
            await persist();
            return count;
        },
        async forEachWithEvent(kind, fn) {
            await ensureLoaded();
            for (const [email, devices] of state.byEmail) {
                for (const d of devices) {
                    if (d.events[kind])
                        fn(email, d);
                }
            }
        },
        async forUserWithEvent(email, kind, fn) {
            const devices = await this.list(email);
            for (const d of devices) {
                if (d.events[kind])
                    fn(d);
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
let _instance = null;
function getPushStore() {
    if (!_instance)
        _instance = createPushStore();
    return _instance;
}
